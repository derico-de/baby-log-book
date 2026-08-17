/* Push and pull. Spec §5, ADR-0003 and ADR-0004.

   Sync is insert-only, and that single property collapses most of the problem:
   two inserts cannot conflict, so push is idempotent *by construction* rather
   than by implementation, replay is a no-op, every replica converges regardless
   of arrival order, and a stale client physically cannot clobber a field it has
   never heard of.

   What is left for this file is the part no engine would have sold us: the
   duplicate-open-session merge, which is cross-document business logic, and it
   lives inside the push transaction in a few dozen lines. */

import { validateFields } from '$domain/entries';
import { mergeRevision, planSessionMerges, redirectRevision } from '$domain/session-merge';
import { PROTOCOL_VERSION, REVISION_KINDS, type PendingRevision, type Revision, type RevisionKind, type Role } from '$domain/types';
import type { Db } from './db';
import {
	countActiveOwners,
	currentCursor,
	getEntry,
	getMember,
	insertRevision,
	materialise,
	mergedIntoMap,
	liveSessions,
	pullRevisions,
	revisionExists
} from './store';

/** Batches of up to ~200 revisions, applied in one all-or-nothing transaction. */
export const MAX_BATCH = 200;
export const PULL_PAGE = 500;
/** One-sided: past timestamps are always legitimate. More than five minutes in
    the future after correction is clamped and flagged — never rejected, because
    refusing to record a night feed is worse than recording it slightly late. */
export const SKEW_TOLERANCE_MS = 5 * 60_000;

export class SyncError extends Error {
	constructor(
		readonly code: 'batch_too_large' | 'malformed' | 'protocol',
		message: string
	) {
		super(message);
	}
}

export interface PushInput {
	householdId: string;
	memberId: string;
	role: Role;
	deviceId: string;
	revisions: unknown;
	now: number;
	/** The protocol version the pushing client speaks. */
	protocolVersion?: number;
}

export interface PushResult {
	cursor: number;
	/** The server's own time, so the client can update its offset. */
	serverTime: number;
	accepted: string[];
	/** Refused, with a reason, and dropped from the client's outbox. Refusing the
	    whole batch instead would leave a Member's Entries stuck behind one bad
	    row forever. */
	rejected: Array<{ id: string; reason: string }>;
	merged: Array<{ survivor_id: string; loser_id: string }>;
	protocolVersion: number;
}

const isKind = (v: unknown): v is RevisionKind => REVISION_KINDS.includes(v as RevisionKind);

function asIncoming(raw: unknown): PendingRevision | null {
	if (raw == null || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null;
	if (!isKind(r.kind)) return null;
	if (typeof r.entity_id !== 'string' || r.entity_id.length === 0 || r.entity_id.length > 64) return null;
	if (typeof r.merge_at !== 'number' || !Number.isFinite(r.merge_at)) return null;
	if (typeof r.device_id !== 'string' || r.device_id.length === 0 || r.device_id.length > 64) return null;
	if (r.fields == null || typeof r.fields !== 'object' || Array.isArray(r.fields)) return null;
	return {
		id: r.id,
		household_id: '',
		kind: r.kind,
		entity_id: r.entity_id,
		fields: r.fields as Record<string, unknown>,
		merge_at: r.merge_at,
		device_id: r.device_id,
		author_id: null
	};
}

/** How long after logging a Member may take their own row back.

    Roles say deleting Entries is the Owner's (spec §6.3), and the logging design
    says the FAB fan has no confirm step because *undo* covers a mistake — a rule
    written about nappies, which every Member logs (spec §8.5). Both hold if a
    Member may tombstone their own Entry for as long as the toast could plausibly
    still be on screen, and nothing older. Any other reading breaks one of them:
    a Caregiver whose undo silently fails would tap twice at 3am. */
export const UNDO_WINDOW_MS = 5 * 60_000;

/** Roles gate writes and management, never reads (spec §6.3). */
function refuseByRole(kind: RevisionKind, fields: Record<string, unknown>, role: Role): string | null {
	if (role === 'owner') return null;
	switch (kind) {
		case 'entry':
			/* Any Member may log and may correct anyone's Entry. Deleting is the
			   Owner's — except the undo window, which is checked separately because
			   it needs the Entry itself. */
			return 'deleted_at' in fields ? 'only an Owner may delete an Entry' : null;
		case 'food':
			/* A Caregiver logging a Meal grows the catalogue; removing from it is
			   management. */
			return 'deleted_at' in fields ? 'only an Owner may remove a Food' : null;
		case 'member':
			return 'only an Owner may manage Members';
		case 'baby':
			return 'only an Owner may manage Babies';
		case 'household':
			return 'only an Owner may change Household settings';
		case 'target':
			return 'only an Owner may change Targets';
	}
}

/** The narrow exemption from Owner-only deletion: a Member taking back the row
    they just logged, while the toast could still be on screen. Not a
    correction-of-anything-old, and never someone else's row. */
function withinUndoWindow(
	db: Db,
	householdId: string,
	incoming: PendingRevision,
	fields: Record<string, unknown>,
	memberId: string,
	now: number
): boolean {
	if (incoming.kind !== 'entry') return false;
	if (fields.deleted_at == null) return false;
	const entry = getEntry(db, householdId, incoming.entity_id);
	if (!entry || entry.logged_by !== memberId) return false;
	return now - entry.logged_at <= UNDO_WINDOW_MS;
}

/** One hard rule: the last Owner can be neither demoted nor removed. */
function refuseLastOwner(
	db: Db,
	householdId: string,
	revision: PendingRevision
): string | null {
	if (revision.kind !== 'member') return null;
	const demoting = revision.fields.role != null && revision.fields.role !== 'owner';
	const removing = revision.fields.removed_at != null;
	if (!demoting && !removing) return null;

	const subject = getMember(db, revision.entity_id);
	if (!subject || subject.role !== 'owner' || subject.removed_at != null) return null;
	if (countActiveOwners(db, householdId, subject.id) > 0) return null;
	return removing
		? 'the last Owner cannot be removed'
		: 'the last Owner cannot be demoted';
}

/** Applies a batch. Everything below happens in one transaction, so a Device
    either gets a new cursor or gets to retry unchanged. */
export function push(db: Db, input: PushInput): PushResult {
	if (input.protocolVersion != null && input.protocolVersion !== PROTOCOL_VERSION) {
		throw new SyncError(
			'protocol',
			`this device speaks protocol ${input.protocolVersion}, the server speaks ${PROTOCOL_VERSION}`
		);
	}
	if (!Array.isArray(input.revisions)) throw new SyncError('malformed', 'revisions must be an array');
	if (input.revisions.length > MAX_BATCH) {
		throw new SyncError('batch_too_large', `at most ${MAX_BATCH} revisions per push`);
	}

	const { householdId, memberId, role, now } = input;
	const accepted: string[] = [];
	const rejected: Array<{ id: string; reason: string }> = [];
	const merged: Array<{ survivor_id: string; loser_id: string }> = [];

	db.transaction(() => {
		const redirects = mergedIntoMap(db, householdId);
		const touched = new Set<string>();

		for (const raw of input.revisions as unknown[]) {
			const incoming = asIncoming(raw);
			if (!incoming) {
				rejected.push({ id: typeof (raw as { id?: string })?.id === 'string' ? (raw as { id: string }).id : '', reason: 'malformed revision' });
				continue;
			}

			/* Replay is a no-op — the id is client-minted, so a retry after a lost
			   response lands here rather than duplicating anything. */
			if (revisionExists(db, incoming.id)) {
				accepted.push(incoming.id);
				continue;
			}

			const validation = validateFields(incoming.kind, incoming.fields);
			if (!validation.ok) {
				rejected.push({ id: incoming.id, reason: validation.reason });
				continue;
			}

			const byRole = refuseByRole(incoming.kind, validation.fields, role);
			if (byRole && !withinUndoWindow(db, householdId, incoming, validation.fields, memberId, now)) {
				rejected.push({ id: incoming.id, reason: byRole });
				continue;
			}

			/* Author and Household come from the session, never from the client:
			   possession of a device_id is never a proof of identity. */
			const revision: PendingRevision = {
				...incoming,
				fields: validation.fields,
				household_id: householdId,
				author_id: memberId
			};

			const lastOwner = refuseLastOwner(db, householdId, revision);
			if (lastOwner) {
				rejected.push({ id: revision.id, reason: lastOwner });
				continue;
			}

			/* A late "stop" pressed on a Device whose session lost a merge lands on
			   the survivor. */
			const directed = redirectRevision(revision, redirects);

			const skewed = directed.merge_at > now + SKEW_TOLERANCE_MS;
			insertRevision(
				db,
				{
					...directed,
					kind: directed.kind,
					merge_at: skewed ? now : directed.merge_at,
					skewed
				},
				now
			);
			materialise(db, householdId, directed.kind, directed.entity_id);
			touched.add(`${directed.kind} ${directed.entity_id}`);
			accepted.push(revision.id);
		}

		/* Any two open sessions of the same kind for one Baby are a contradiction.
		   Run after the batch, so a start and its stop in the same push do not
		   momentarily look like two open sessions. */
		for (const plan of planSessionMerges(liveSessions(db, householdId))) {
			const id = `merge:${plan.loser_id}:${plan.survivor_id}`;
			if (revisionExists(db, id)) continue;
			const revision = mergeRevision(plan, {
				household_id: householdId,
				at: now,
				device_id: 'server',
				id
			});
			insertRevision(db, { ...revision, skewed: false }, now);
			materialise(db, householdId, 'entry', plan.loser_id);
			merged.push({ survivor_id: plan.survivor_id, loser_id: plan.loser_id });
		}
	})();

	return {
		cursor: currentCursor(db, householdId),
		serverTime: now,
		accepted,
		rejected,
		merged,
		protocolVersion: PROTOCOL_VERSION
	};
}

export interface PullResult {
	revisions: Revision[];
	cursor: number;
	/** True while more pages are waiting, which is what the quiet "catching up"
	    line reads. */
	more: boolean;
	serverTime: number;
	protocolVersion: number;
}

/** The ordinary paged pull. Initial sync is this from cursor 0 — no bootstrap
    path and no snapshot subsystem (spec §5.4). */
export function pull(db: Db, householdId: string, since: number, now: number, limit = PULL_PAGE): PullResult {
	const revisions = pullRevisions(db, householdId, since, limit);
	const cursor = revisions.length > 0 ? (revisions.at(-1)!.seq ?? since) : since;
	const head = currentCursor(db, householdId);
	return {
		revisions,
		cursor,
		more: cursor < head,
		serverTime: now,
		protocolVersion: PROTOCOL_VERSION
	};
}
