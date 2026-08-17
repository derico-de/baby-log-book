/* The ten queries ADR-0001 promised, and the server's copy of the fold.

   Current state is a fold over the revision log, materialised on both sides —
   and it is the *same* fold, imported from $domain, so the server and a phone
   cannot disagree about what an Entry currently says. Re-folding an entity from
   its own revisions on every write is deliberate: an entity has a handful of
   revisions, and it removes any need to store per-field merge keys. */

import { coercePayload } from '$domain/entries';
import { compareRevisions, foldEntity, foldEntry, splitFields } from '$domain/revisions';
import type {
	Baby,
	Entry,
	Food,
	Household,
	MemberRecord,
	Revision,
	RevisionKind,
	Target
} from '$domain/types';
import { ENTRY_TYPES, type EntryType } from '$domain/types';
import type { Db } from './db';

interface RevisionRow {
	seq: number;
	id: string;
	household_id: string;
	kind: string;
	entity_id: string;
	fields: string;
	merge_at: number;
	device_id: string;
	author_id: string | null;
	skewed: number;
}

function toRevision(row: RevisionRow): Revision {
	return {
		seq: row.seq,
		id: row.id,
		household_id: row.household_id,
		kind: row.kind as RevisionKind,
		entity_id: row.entity_id,
		fields: JSON.parse(row.fields) as Record<string, unknown>,
		merge_at: row.merge_at,
		device_id: row.device_id,
		author_id: row.author_id,
		skewed: row.skewed === 1
	};
}

const REVISION_COLUMNS =
	'seq, id, household_id, kind, entity_id, fields, merge_at, device_id, author_id, skewed';

/** One page of the feed, in cursor order. Pull is the only path by which rows
    arrive — the SSE channel carries a bare wake-up signal and never data. */
export function pullRevisions(db: Db, householdId: string, since: number, limit: number): Revision[] {
	const rows = db
		.prepare(
			`SELECT ${REVISION_COLUMNS} FROM revisions
			 WHERE household_id = ? AND seq > ?
			 ORDER BY seq LIMIT ?`
		)
		.all(householdId, since, limit) as RevisionRow[];
	return rows.map(toRevision);
}

export function currentCursor(db: Db, householdId: string): number {
	const row = db
		.prepare('SELECT COALESCE(MAX(seq), 0) AS cursor FROM revisions WHERE household_id = ?')
		.get(householdId) as { cursor: number };
	return row.cursor;
}

export function revisionsOf(db: Db, householdId: string, kind: RevisionKind, entityId: string): Revision[] {
	const rows = db
		.prepare(
			`SELECT ${REVISION_COLUMNS} FROM revisions
			 WHERE household_id = ? AND kind = ? AND entity_id = ?`
		)
		.all(householdId, kind, entityId) as RevisionRow[];
	return rows.map(toRevision).sort(compareRevisions);
}

export function revisionExists(db: Db, id: string): boolean {
	return db.prepare('SELECT 1 FROM revisions WHERE id = ?').get(id) != null;
}

export interface InsertableRevision {
	id: string;
	household_id: string;
	kind: RevisionKind;
	entity_id: string;
	fields: Record<string, unknown>;
	merge_at: number;
	device_id: string;
	author_id: string | null;
	skewed: boolean;
}

/** Inserts one revision and returns its seq — the cursor, assigned inside the
    write transaction (ADR-0004). */
export function insertRevision(db: Db, revision: InsertableRevision, receivedAt: number): number {
	const info = db
		.prepare(
			`INSERT INTO revisions
			   (id, household_id, kind, entity_id, fields, merge_at, device_id, author_id, skewed, received_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			revision.id,
			revision.household_id,
			revision.kind,
			revision.entity_id,
			JSON.stringify(revision.fields),
			revision.merge_at,
			revision.device_id,
			revision.author_id,
			revision.skewed ? 1 : 0,
			receivedAt
		);
	return Number(info.lastInsertRowid);
}

const isEntryType = (v: unknown): v is EntryType => ENTRY_TYPES.includes(v as EntryType);

/** Re-folds one entity and writes the result to its table. Called for every
    entity a push touched, inside the same transaction. */
export function materialise(db: Db, householdId: string, kind: RevisionKind, entityId: string): void {
	const revisions = revisionsOf(db, householdId, kind, entityId);
	if (revisions.length === 0) return;

	if (kind === 'entry') {
		const entry = foldEntry(entityId, revisions, householdId);
		/* No type yet means the creating revision has not arrived; the row stays
		   unmaterialised and the next push completes it. */
		if (!entry) return;
		db.prepare(
			`INSERT INTO entries
			   (id, household_id, baby_id, type, occurred_at, ended_at, recording_zone, note,
			    payload, logged_by, logged_at, edited_by, edited_at, deleted_at, merged_into)
			 VALUES (@id, @household_id, @baby_id, @type, @occurred_at, @ended_at, @recording_zone, @note,
			         @payload, @logged_by, @logged_at, @edited_by, @edited_at, @deleted_at, @merged_into)
			 ON CONFLICT(id) DO UPDATE SET
			   baby_id = excluded.baby_id,
			   type = excluded.type,
			   occurred_at = excluded.occurred_at,
			   ended_at = excluded.ended_at,
			   recording_zone = excluded.recording_zone,
			   note = excluded.note,
			   payload = excluded.payload,
			   logged_by = excluded.logged_by,
			   logged_at = excluded.logged_at,
			   edited_by = excluded.edited_by,
			   edited_at = excluded.edited_at,
			   deleted_at = excluded.deleted_at,
			   merged_into = excluded.merged_into`
		).run({
			id: entry.id,
			household_id: householdId,
			baby_id: entry.baby_id,
			type: entry.type,
			occurred_at: entry.occurred_at,
			ended_at: entry.ended_at,
			recording_zone: entry.recording_zone,
			note: entry.note,
			payload: JSON.stringify(splitFields(foldEntity(revisions)).payload),
			logged_by: entry.logged_by,
			logged_at: entry.logged_at,
			edited_by: entry.edited_by,
			edited_at: entry.edited_at,
			deleted_at: entry.deleted_at,
			merged_into: entry.merged_into
		});
		return;
	}

	const state = foldEntity(revisions);
	const num = (v: unknown) => (v == null ? null : Number(v));
	const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v));

	switch (kind) {
		case 'baby':
			db.prepare(
				`INSERT INTO babies (id, household_id, name, birth_date, deleted_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET name = excluded.name,
				   birth_date = excluded.birth_date, deleted_at = excluded.deleted_at`
			).run(entityId, householdId, str(state.name), str(state.birth_date), num(state.deleted_at));
			return;
		case 'member':
			db.prepare(
				`INSERT INTO members (id, household_id, display_name, role, removed_at, locale)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name,
				   role = excluded.role, removed_at = excluded.removed_at, locale = excluded.locale`
			).run(
				entityId,
				householdId,
				str(state.display_name),
				str(state.role, 'caregiver'),
				num(state.removed_at),
				state.locale == null ? null : String(state.locale)
			);
			return;
		case 'food':
			db.prepare(
				`INSERT INTO foods (id, household_id, name, deleted_at) VALUES (?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET name = excluded.name, deleted_at = excluded.deleted_at`
			).run(entityId, householdId, str(state.name), num(state.deleted_at));
			return;
		case 'target':
			db.prepare(
				`INSERT INTO targets (id, household_id, baby_id, activity, duration_s, anchor, deleted_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET baby_id = excluded.baby_id, activity = excluded.activity,
				   duration_s = excluded.duration_s, anchor = excluded.anchor, deleted_at = excluded.deleted_at`
			).run(
				entityId,
				householdId,
				str(state.baby_id),
				str(state.activity, 'feed'),
				Number(state.duration_s ?? 0),
				str(state.anchor, 'feed_start'),
				num(state.deleted_at)
			);
			return;
		case 'household':
			db.prepare(
				`UPDATE households SET
				   name = COALESCE(?, name),
				   day_start = COALESCE(?, day_start),
				   zone = COALESCE(?, zone)
				 WHERE id = ?`
			).run(
				state.name == null ? null : String(state.name),
				state.day_start == null ? null : String(state.day_start),
				state.zone == null ? null : String(state.zone),
				entityId
			);
			return;
	}
}

interface EntryRow {
	id: string;
	household_id: string;
	baby_id: string;
	type: string;
	occurred_at: number;
	ended_at: number | null;
	recording_zone: string;
	note: string | null;
	payload: string;
	logged_by: string | null;
	logged_at: number | null;
	edited_by: string | null;
	edited_at: number | null;
	deleted_at: number | null;
	merged_into: string | null;
}

/** The payload validation ADR-0001 requires, at the one place a row becomes an
    Entry. A row whose type the code does not know is dropped rather than
    rendered: this is the read path, and it must not throw. */
export function rowToEntry(row: EntryRow): Entry | null {
	if (!isEntryType(row.type)) return null;
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse(row.payload) as Record<string, unknown>;
	} catch {
		raw = {};
	}
	return {
		id: row.id,
		household_id: row.household_id,
		baby_id: row.baby_id,
		type: row.type,
		occurred_at: row.occurred_at,
		ended_at: row.ended_at,
		recording_zone: row.recording_zone,
		note: row.note,
		payload: coercePayload(row.type, raw),
		logged_by: row.logged_by ?? '',
		logged_at: row.logged_at ?? row.occurred_at,
		edited_by: row.edited_by,
		edited_at: row.edited_at,
		deleted_at: row.deleted_at,
		merged_into: row.merged_into
	};
}

const ENTRY_COLUMNS =
	'id, household_id, baby_id, type, occurred_at, ended_at, recording_zone, note, payload, ' +
	'logged_by, logged_at, edited_by, edited_at, deleted_at, merged_into';

/** Every Live Session in the Household. This is the Session Merge's only input,
    and the partial index makes it a lookup rather than a scan. */
export function liveSessions(db: Db, householdId: string): Entry[] {
	const rows = db
		.prepare(
			`SELECT ${ENTRY_COLUMNS} FROM entries
			 WHERE household_id = ? AND ended_at IS NULL AND deleted_at IS NULL AND merged_into IS NULL
			   AND type IN ('sleep', 'breast_feed', 'bottle_feed')`
		)
		.all(householdId) as EntryRow[];
	return rows.map(rowToEntry).filter((e): e is Entry => e != null);
}

/** The merge chain, for redirecting a late stop onto the survivor. */
export function mergedIntoMap(db: Db, householdId: string): Map<string, string> {
	const rows = db
		.prepare('SELECT id, merged_into FROM entries WHERE household_id = ? AND merged_into IS NOT NULL')
		.all(householdId) as Array<{ id: string; merged_into: string }>;
	return new Map(rows.map((r) => [r.id, r.merged_into]));
}

export function getEntry(db: Db, householdId: string, id: string): Entry | null {
	const row = db
		.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE household_id = ? AND id = ?`)
		.get(householdId, id) as EntryRow | undefined;
	return row ? rowToEntry(row) : null;
}

export function theHousehold(db: Db): Household | null {
	const row = db.prepare('SELECT id, name, day_start, zone FROM households LIMIT 1').get() as
		| Household
		| undefined;
	return row ?? null;
}

export function listMembers(db: Db, householdId: string): MemberRecord[] {
	return db
		.prepare(
			`SELECT id, household_id, display_name, role, removed_at, locale
			 FROM members WHERE household_id = ? ORDER BY display_name`
		)
		.all(householdId) as MemberRecord[];
}

export function getMember(db: Db, id: string): MemberRecord | null {
	return (
		(db
			.prepare('SELECT id, household_id, display_name, role, removed_at, locale FROM members WHERE id = ?')
			.get(id) as MemberRecord | undefined) ?? null
	);
}

export function countActiveOwners(db: Db, householdId: string, excluding?: string): number {
	const row = db
		.prepare(
			`SELECT COUNT(*) AS n FROM members
			 WHERE household_id = ? AND role = 'owner' AND removed_at IS NULL AND id IS NOT ?`
		)
		.get(householdId, excluding ?? null) as { n: number };
	return row.n;
}

export function listTargets(db: Db, householdId: string): Target[] {
	return db
		.prepare(
			`SELECT id, household_id, baby_id, activity, duration_s, anchor, deleted_at
			 FROM targets WHERE household_id = ?`
		)
		.all(householdId) as Target[];
}
