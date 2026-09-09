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
import { feedEndRevision, planFeedEnds } from '$domain/feed-end';
import { mergeRevision, planSessionMerges, redirectRevision } from '$domain/session-merge';
import { pastBottleRevision, planPastBottles } from '$domain/targets';
import { PROTOCOL_VERSION, REVISION_KINDS, type Entry, type PendingRevision, type Revision, type RevisionKind, type Role } from '$domain/types';
import type { Db } from './db';
import {
	countActiveParents,
	currentCursor,
	getEntry,
	getMember,
	insertRevision,
	listTargets,
	materialise,
	mergedIntoMap,
	liveSessions,
	pullRevisions,
	entityBelongsElsewhere,
	revisionBelongsElsewhere,
	revisionExists
} from './store';

/** Batches of up to ~200 revisions, applied in one all-or-nothing transaction. */
export const MAX_BATCH = 200;
export const PULL_PAGE = 500;
/** One-sided: past timestamps are always legitimate. More than five minutes in
    the future after correction is clamped and flagged — never rejected, because
    refusing to record a night feed is worse than recording it slightly late. */
export const SKEW_TOLERANCE_MS = 5 * 60_000;

/** The two id shapes the server mints for itself, deterministically, so that
    replay is a no-op. A client that pushes one is claiming a name that is not
    its to claim: it would suppress the bookkeeping the id stands for, and —
    since ids are globally unique — pre-empting another Household's would make
    their next push fail outright on the UNIQUE constraint. Nothing legitimate
    ever mints these: an outbox holds only ids the client itself minted.

    This refusal may say what it is, unlike the ownership ones below: it is
    decided by the shape of the id the client sent and reads nothing, so there
    is no existence to leak. */
const RESERVED_ID_PREFIXES = ['merge:', 'bottle-past:', 'feed-end:'];
const isReservedId = (id: string) => RESERVED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));

/** One uninformative reason for every ownership refusal. Saying more would turn
    the rejection into an oracle; this way the only thing it can reveal is that
    some 128-bit id exists somewhere, which is what ADR-0020 accepts. */
const NOT_ACCEPTED = 'not accepted';

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

    Roles say deleting Entries is the Parent's (spec §6.3), and the logging design
    says the FAB fan has no confirm step because *undo* covers a mistake — a rule
    written about nappies, which every Member logs (spec §8.5). Both hold if a
    Member may tombstone their own Entry for as long as the toast could plausibly
    still be on screen, and nothing older. Any other reading breaks one of them:
    a Caregiver whose undo silently fails would tap twice at 3am. */
export const UNDO_WINDOW_MS = 5 * 60_000;

/** Roles gate writes and management, never reads (spec §6.3). */
function refuseByRole(kind: RevisionKind, fields: Record<string, unknown>, role: Role): string | null {
	if (role === 'parent') return null;
	switch (kind) {
		case 'entry':
			/* Any Member may log and may correct anyone's Entry. Deleting is the
			   Parent's — except the undo window, which is checked separately because
			   it needs the Entry itself. */
			return 'deleted_at' in fields ? 'only a Parent may delete an Entry' : null;
		case 'food':
			/* A Caregiver logging a Meal grows the catalogue; removing from it is
			   management. */
			return 'deleted_at' in fields ? 'only a Parent may remove a Food' : null;
		case 'member':
			return 'only a Parent may manage Members';
		case 'baby':
			return 'only a Parent may manage Babies';
		case 'household':
			return 'only a Parent may change Household settings';
		case 'target':
			return 'only a Parent may change Targets';
	}
}

/** The narrow exemption from Parent-only deletion: a Member taking back the row
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

/** The mark is the server's to write, and nobody else's (ADR-0038). It is
    stamped once by the claim, from what the Parent stated on the Invite; a
    client that names it is either buggy or trying to talk its way out of the
    role a Hub is confined to.

    Refused rather than silently dropped, unlike an unknown field: this one is
    known, and it decides a blast radius. The reason may say what it is — it is
    decided by the shape of what the client sent and reads nothing, so there is
    no existence to leak. */
function refuseServerStamped(revision: PendingRevision): string | null {
	if (revision.kind !== 'member') return null;
	return 'kind' in revision.fields ? 'only the server may mark a Member' : null;
}

/** A Hub stays a Caregiver (ADR-0038). Subject-based, beside the last-Parent
    rule, because the subject is the Member being changed rather than the one
    doing the changing — and anything less quietly deletes ADR-0034's
    blast-radius argument, which is the reason the Caregiver role was chosen in
    the first place. */
function refuseHubParent(db: Db, householdId: string, revision: PendingRevision): string | null {
	if (revision.kind !== 'member' || revision.fields.role !== 'parent') return null;
	const subject = getMember(db, householdId, revision.entity_id);
	if (!subject || subject.kind !== 'hub') return null;
	return 'a Hub stays a Caregiver';
}

/** One hard rule: the last Parent can be neither demoted nor removed. */
function refuseLastParent(
	db: Db,
	householdId: string,
	revision: PendingRevision
): string | null {
	if (revision.kind !== 'member') return null;
	const demoting = revision.fields.role != null && revision.fields.role !== 'parent';
	const removing = revision.fields.removed_at != null;
	if (!demoting && !removing) return null;

	const subject = getMember(db, householdId, revision.entity_id);
	if (!subject || subject.role !== 'parent' || subject.removed_at != null) return null;
	if (countActiveParents(db, householdId, subject.id) > 0) return null;
	return removing
		? 'the last Parent cannot be removed'
		: 'the last Parent cannot be demoted';
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
		/* The Entries this batch wrote to. A Meal is not a Live Session, so this
		   is the only way the feed-end rule below can see one. */
		const touchedEntries = new Set<string>();

		for (const raw of input.revisions as unknown[]) {
			const incoming = asIncoming(raw);
			if (!incoming) {
				rejected.push({ id: typeof (raw as { id?: string })?.id === 'string' ? (raw as { id: string }).id : '', reason: 'malformed revision' });
				continue;
			}

			if (isReservedId(incoming.id)) {
				rejected.push({ id: incoming.id, reason: 'only the app may mint that revision id' });
				continue;
			}

			/* A household-kind revision can only ever mean the session's Household, so
			   the client's entity_id is replaced rather than checked: "a Parent of A
			   renames B" becomes unwritable rather than merely rejected (hosted
			   spec §5.2). Everything below reads this, never the client's. */
			const entityId = incoming.kind === 'household' ? householdId : incoming.entity_id;

			/* Replay is a no-op — the id is client-minted, so a retry after a lost
			   response lands here rather than duplicating anything. */
			if (revisionExists(db, householdId, incoming.id)) {
				accepted.push(incoming.id);
				continue;
			}

			/* The ownership guard. An id that already lives in another Household is
			   adversarial by construction: accepting it as a replay would lose the
			   pusher's revision, and writing it would cross the boundary. */
			if (
				revisionBelongsElsewhere(db, householdId, incoming.id) ||
				entityBelongsElsewhere(db, householdId, entityId)
			) {
				rejected.push({ id: incoming.id, reason: NOT_ACCEPTED });
				continue;
			}

			const serverStamped = refuseServerStamped(incoming);
			if (serverStamped) {
				rejected.push({ id: incoming.id, reason: serverStamped });
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
				entity_id: entityId,
				fields: validation.fields,
				household_id: householdId,
				author_id: memberId
			};

			const subjectRefusal =
				refuseHubParent(db, householdId, revision) ?? refuseLastParent(db, householdId, revision);
			if (subjectRefusal) {
				rejected.push({ id: revision.id, reason: subjectRefusal });
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
			if (directed.kind === 'entry') touchedEntries.add(directed.entity_id);
			accepted.push(revision.id);
		}

		/* Any two open sessions of the same kind for one Baby are a contradiction.
		   Run after the batch, so a start and its stop in the same push do not
		   momentarily look like two open sessions. */
		for (const plan of planSessionMerges(liveSessions(db, householdId))) {
			const id = `merge:${plan.loser_id}:${plan.survivor_id}`;
			if (revisionExists(db, householdId, id)) continue;
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

		/* Before the feed-end rule, so a bottle that outlived its Life ends at the
		   due instant rather than at the next feeding: ADR-0017's end is the
		   earlier and the truer of the two, and once it lands the Feed is no
		   longer running for ADR-0019 to close. */
		closePastBottles(db, householdId, now);
		closeEndedFeeds(db, householdId, touchedEntries, now);
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

/** Ends every open bottle Feed whose Bottle Life has run out, at the due
    instant, attributed to the app (ADR-0017). Deterministic id, so replay is a
    no-op — and so a Member who deliberately reopens the Feed by clearing its
    end is not fought: a bottle is closed exactly once. */
function closePastBottles(db: Db, householdId: string, now: number): void {
	const plans = planPastBottles(liveSessions(db, householdId), listTargets(db, householdId), now);
	for (const plan of plans) {
		const id = `bottle-past:${plan.entry_id}`;
		if (revisionExists(db, householdId, id)) continue;
		const revision = pastBottleRevision(plan, {
			household_id: householdId,
			at: now,
			device_id: 'server',
			id
		});
		insertRevision(db, { ...revision, skewed: false }, now);
		materialise(db, householdId, 'entry', plan.entry_id);
	}
}

/** Ends every running Feed the log says has in fact ended, at the start of the
    feeding that followed it (ADR-0019, moved here by ADR-0034).

    Deterministic id, so replay is a no-op — and so a Member who deliberately
    reopens the Feed by clearing its end is not fought: a Feed is closed by the
    feeding after it exactly once.

    Unlike the past-bottle close, the end is attributed to the Member who logged
    that following feeding: they entered the instant, so nothing here is data
    nobody entered. */
function closeEndedFeeds(db: Db, householdId: string, touchedEntries: Set<string>, now: number): void {
	const open = liveSessions(db, householdId);
	const pushed = [...touchedEntries]
		.map((id) => getEntry(db, householdId, id))
		.filter((e): e is Entry => e != null);

	for (const plan of planFeedEnds(open, [...open, ...pushed])) {
		const id = `feed-end:${plan.entry_id}`;
		if (revisionExists(db, householdId, id)) continue;
		const revision = feedEndRevision(plan, {
			household_id: householdId,
			at: now,
			device_id: 'server',
			id
		});
		insertRevision(db, { ...revision, skewed: false }, now);
		materialise(db, householdId, 'entry', plan.entry_id);
	}
}

/** The ordinary paged pull. Initial sync is this from cursor 0 — no bootstrap
    path and no snapshot subsystem (spec §5.4). */
export function pull(db: Db, householdId: string, since: number, now: number, limit = PULL_PAGE): PullResult {
	/* A bottle goes past by time passing alone, not by anyone writing — so this also runs
	   when somebody merely looks, or a bottle started at night and never
	   followed by another push would stay open until morning. */
	db.transaction(() => closePastBottles(db, householdId, now))();
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
