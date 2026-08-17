/* The fold. ADR-0003: sync moves immutable revisions, not rows, and current
   state is a fold over the log materialised on both sides — so this module is
   shared by the server and every Device, and they cannot disagree.

   Two clocks, and conflating either into the other loses data (ADR-0004):
   `seq` is the cursor and `merge_at` is the merge key. Nothing here reads
   `seq`; ordering a fold by arrival would let a phone that was offline for
   three days beat yesterday's correction simply by landing later. */

import {
	SHARED_ENTRY_FIELDS,
	ENTRY_TYPES,
	type Entry,
	type EntryType,
	type Revision
} from './types';
import { emptyPayload, coercePayload } from './entries';

/** Ascending merge order: the writing Device's corrected clock, ties broken
    lexicographically by `device_id`. */
export function compareRevisions(a: Revision, b: Revision): number {
	if (a.merge_at !== b.merge_at) return a.merge_at - b.merge_at;
	if (a.device_id !== b.device_id) return a.device_id < b.device_id ? -1 : 1;
	/* Same instant, same Device: the revision id keeps the fold deterministic
	   rather than dependent on the order rows came back in. */
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Last-write-wins per FIELD. Per-entity LWW is only cheaper when you are
    overwriting rows, which we are not. */
export function foldEntity(revisions: Revision[]): Record<string, unknown> {
	const state: Record<string, unknown> = {};
	for (const r of [...revisions].sort(compareRevisions)) {
		for (const [k, v] of Object.entries(r.fields)) state[k] = v;
	}
	return state;
}

const SHARED = new Set<string>(SHARED_ENTRY_FIELDS);

/** Splits a fold into the Entry's shared columns and its JSON payload. The
    database cannot enforce payload shape, so this is where the split lives
    (ADR-0001). */
export function splitFields(state: Record<string, unknown>): {
	shared: Record<string, unknown>;
	payload: Record<string, unknown>;
} {
	const shared: Record<string, unknown> = {};
	const payload: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(state)) {
		if (SHARED.has(k)) shared[k] = v;
		else payload[k] = v;
	}
	return { shared, payload };
}

const isEntryType = (v: unknown): v is EntryType => ENTRY_TYPES.includes(v as EntryType);

/** Folds a log into Entries. Revisions for other kinds are ignored, so a
    caller can hand this the whole feed. */
export function foldEntries(revisions: Revision[], householdId = 'h1'): Entry[] {
	const byEntity = new Map<string, Revision[]>();
	for (const r of revisions) {
		if (r.kind !== 'entry') continue;
		const list = byEntity.get(r.entity_id);
		if (list) list.push(r);
		else byEntity.set(r.entity_id, [r]);
	}

	const entries: Entry[] = [];
	for (const [id, list] of byEntity) {
		const entry = foldEntry(id, list, householdId);
		if (entry) entries.push(entry);
	}
	return entries;
}

/** One Entry, or null when the fold has not established a type — a revision
    naming only a note, for a creation this replica has not seen yet. */
export function foldEntry(id: string, revisions: Revision[], householdId: string): Entry | null {
	const ordered = [...revisions].sort(compareRevisions);
	if (ordered.length === 0) return null;

	const state = foldEntity(ordered);
	const { shared, payload } = splitFields(state);
	const type = shared.type;
	if (!isEntryType(type)) return null;

	const created = ordered[0];
	/* The last revision that changed anything after the creation. Attribution
	   is per revision, so this is the "edited by Oma, was 120 ml" line. */
	const edited = ordered.length > 1 ? ordered[ordered.length - 1] : null;

	return {
		id,
		household_id: created.household_id ?? householdId,
		baby_id: String(shared.baby_id ?? ''),
		type,
		occurred_at: Number(shared.occurred_at ?? created.merge_at),
		ended_at: shared.ended_at == null ? null : Number(shared.ended_at),
		recording_zone: String(shared.recording_zone ?? 'UTC'),
		note: shared.note == null ? null : String(shared.note),
		payload: coercePayload(type, payload),
		logged_by: created.author_id ?? '',
		logged_at: created.merge_at,
		edited_by: edited ? edited.author_id : null,
		edited_at: edited ? edited.merge_at : null,
		deleted_at: shared.deleted_at == null ? null : Number(shared.deleted_at),
		merged_into: shared.merged_into == null ? null : String(shared.merged_into)
	};
}

export function isTombstoned(entry: Entry): boolean {
	return entry.deleted_at != null;
}

/** Follows a Session Merge chain to the surviving session. Transitive,
    because the loser of one merge can itself have lost an earlier one. */
export function resolveMerged(id: string, mergedInto: Map<string, string>): string {
	const seen = new Set<string>([id]);
	let current = id;
	for (;;) {
		const next = mergedInto.get(current);
		if (!next || seen.has(next)) return current;
		seen.add(next);
		current = next;
	}
}

export { emptyPayload };
