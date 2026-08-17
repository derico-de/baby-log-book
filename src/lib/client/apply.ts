/* Applying revisions to the local replica.

   The same fold as the server's, imported from $domain, so a phone and the
   server cannot disagree about what an Entry currently says. Everything here is
   idempotent: a revision that arrives twice — from a pull that overlapped a push,
   or from a replay — lands on the same state. */

import { coercePayload } from '$domain/entries';
import { foldEntity, foldEntry, splitFields } from '$domain/revisions';
import {
	DEFAULT_DAY_START,
	type Baby,
	type Food,
	type Household,
	type MemberRecord,
	type Revision,
	type RevisionKind,
	type Target
} from '$domain/types';
import { deviceZone } from './device';
import { META, OUTBOX_VERSION, type ReplicaDb } from './db';

const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v));

/** Re-folds one entity from the local log and rewrites its materialised row. */
async function materialise(db: ReplicaDb, householdId: string, kind: RevisionKind, entityId: string) {
	const revisions = await db.revisions.where({ kind, entity_id: entityId }).toArray();
	if (revisions.length === 0) return;
	const state = foldEntity(revisions);

	switch (kind) {
		case 'entry': {
			const entry = foldEntry(entityId, revisions, householdId);
			/* No type yet: the creating revision has not arrived. The next page
			   completes the row. */
			if (!entry) return;
			const { payload } = splitFields(state);
			await db.entries.put({ ...entry, payload: coercePayload(entry.type, payload) });
			return;
		}
		case 'baby':
			await db.babies.put({
				id: entityId,
				household_id: householdId,
				name: str(state.name),
				birth_date: str(state.birth_date),
				deleted_at: num(state.deleted_at)
			} satisfies Baby);
			return;
		case 'member':
			await db.members.put({
				id: entityId,
				household_id: householdId,
				display_name: str(state.display_name),
				role: state.role === 'owner' ? 'owner' : 'caregiver',
				removed_at: num(state.removed_at),
				locale: state.locale == null ? null : String(state.locale)
			} satisfies MemberRecord);
			return;
		case 'food':
			await db.foods.put({
				id: entityId,
				household_id: householdId,
				name: str(state.name),
				deleted_at: num(state.deleted_at)
			} satisfies Food);
			return;
		case 'target':
			await db.targets.put({
				id: entityId,
				household_id: householdId,
				baby_id: str(state.baby_id),
				activity: state.activity === 'sleep' ? 'sleep' : 'feed',
				duration_s: Number(state.duration_s ?? 0),
				anchor: state.anchor === 'sleep_end' ? 'sleep_end' : 'feed_start',
				deleted_at: num(state.deleted_at)
			} satisfies Target);
			return;
		case 'household': {
			const existing = await db.households.get(entityId);
			await db.households.put({
				id: entityId,
				name: str(state.name, existing?.name ?? ''),
				day_start: str(state.day_start, existing?.day_start ?? DEFAULT_DAY_START),
				/* Until the log says otherwise, this Device's own zone is the least
				   wrong lens available. */
				zone: str(state.zone, existing?.zone ?? deviceZone())
			} satisfies Household);
			return;
		}
	}
}

/** Writes a page of pulled revisions and re-folds everything they touched, in one
    transaction: a page either lands whole or not at all, so a tab that dies
    mid-pull cannot leave a materialised row disagreeing with the log. */
export async function applyRevisions(
	db: ReplicaDb,
	householdId: string,
	revisions: Revision[]
): Promise<void> {
	if (revisions.length === 0) return;

	const touched = new Map<string, { kind: RevisionKind; entity_id: string }>();
	for (const r of revisions) touched.set(`${r.kind} ${r.entity_id}`, { kind: r.kind, entity_id: r.entity_id });

	await db.transaction('rw', db.tables, async () => {
		await db.revisions.bulkPut(revisions);
		for (const { kind, entity_id } of touched.values()) {
			await materialise(db, householdId, kind, entity_id);
		}
	});
}

/** A local write: the revision is appended to the log, applied straight away so
    the row appears at once, and queued in the outbox — all in one transaction,
    because a tab that died between them could leave an Entry that exists locally
    and will never be sent. The outbox holds the only copy. */
export async function applyLocal(
	db: ReplicaDb,
	householdId: string,
	revision: Revision,
	queuedAt: number
): Promise<void> {
	await db.transaction('rw', db.tables, async () => {
		await db.revisions.put(revision);
		await db.outbox.put({
			id: revision.id,
			v: OUTBOX_VERSION,
			kind: revision.kind,
			entity_id: revision.entity_id,
			fields: revision.fields,
			merge_at: revision.merge_at,
			device_id: revision.device_id,
			author_id: revision.author_id,
			queued_at: queuedAt,
			attempts: 0
		});
		await materialise(db, householdId, revision.kind, revision.entity_id);
		if (revision.kind === 'entry') await db.meta.put({ key: META.loggedFirstEntry, value: true });
	});
}
