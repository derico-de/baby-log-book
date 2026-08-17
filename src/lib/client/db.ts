/* The local replica and the outbox. ADR-0013.

   These two tables are not the same kind of thing, and the difference is the
   whole design:

     - The **replica is a cache**. Every table except `outbox` can be dropped and
       re-pulled — which is what made building the sync engine beat buying one,
       and it is an actual button in Settings.
     - The **outbox is data**. It holds the only copy of an unsynced Entry.

   Its consequence is a hard contract: **a new client must be able to read an old
   client's outbox records.** Otherwise an incompatible local schema meets the
   reset lever's non-empty-outbox refusal, and the only way out is to destroy
   Entries a Member typed. So an outbox row carries its own `v`, its fields stay
   a plain JSON object, and nothing in it is ever renamed — only added. */

import Dexie, { type EntityTable } from 'dexie';
import type { Baby, Entry, Food, Household, MemberRecord, Revision, Target } from '$domain/types';

/** The shape version of an outbox row. Bump only by adding, never by renaming,
    and keep every reader able to handle every older value. */
export const OUTBOX_VERSION = 1;

export interface OutboxRow {
	/** The revision id, minted on this Device, which is what makes push
	    idempotent on retry. */
	id: string;
	v: number;
	kind: Revision['kind'];
	entity_id: string;
	fields: Record<string, unknown>;
	/** The merge key at the moment of writing: this Device's clock corrected by
	    its observed server offset. */
	merge_at: number;
	device_id: string;
	author_id: string | null;
	/** Queue order, so the server sees a Member's writes in the order they made
	    them. Not a merge input. */
	queued_at: number;
	attempts: number;
}

export interface MetaRow {
	key: string;
	value: unknown;
}

/** The materialised replica, plus the log it was folded from. Keeping the log is
    what lets a row show its Revision history — "edited by Oma, was 120 ml" —
    without asking the server. */
export class ReplicaDb extends Dexie {
	revisions!: EntityTable<Revision, 'id'>;
	entries!: EntityTable<Entry, 'id'>;
	babies!: EntityTable<Baby, 'id'>;
	members!: EntityTable<MemberRecord, 'id'>;
	foods!: EntityTable<Food, 'id'>;
	targets!: EntityTable<Target, 'id'>;
	households!: EntityTable<Household, 'id'>;
	outbox!: EntityTable<OutboxRow, 'id'>;
	meta!: EntityTable<MetaRow, 'key'>;

	constructor(name = 'baby-log-book') {
		super(name);
		this.version(1).stores({
			revisions: 'id, seq, [kind+entity_id], entity_id, merge_at',
			entries: 'id, [baby_id+occurred_at], occurred_at, type, logged_by, ended_at',
			babies: 'id',
			members: 'id',
			foods: 'id, name',
			targets: 'id, [baby_id+activity]',
			households: 'id',
			outbox: 'id, queued_at',
			meta: 'key'
		});
	}
}

let instance: ReplicaDb | null = null;

export function replica(): ReplicaDb {
	if (!instance) instance = new ReplicaDb();
	return instance;
}

/* --- meta ------------------------------------------------------------- */

/** The Dexie schema this build knows how to read. Compared on boot, because a
    rollback can leave a replica written by a newer client — and spec §5.4 says the
    reset lever fires automatically when the version check reports an incompatible
    local schema, rather than waiting for a Member to find the button. */
export const REPLICA_SCHEMA = 1;

export const META = {
	/** The pull cursor. Never a wall clock (ADR-0004). */
	cursor: 'cursor',
	/** serverTime - clientTime, observed on the last sync response. */
	clockOffset: 'clock_offset',
	memberId: 'member_id',
	householdId: 'household_id',
	/** Set once the first Entry has been logged, which is what the install nudge
	    waits for so a grandparent's first screen is not a request. */
	loggedFirstEntry: 'logged_first_entry',
	lastSyncAt: 'last_sync_at',
	/** Per running Sleep: when a Member last said *Still asleep*. Device-local,
	    because an acknowledgement is not data anyone entered about the Baby. */
	staleAck: 'stale_ack',
	/** The Baby the timeline is showing, when there is more than one. */
	selectedBaby: 'selected_baby',
	/** The Household Zone this Device last suggested changing to, so a layover
	    prompts once and never again for that zone. */
	zoneSuggestionDismissed: 'zone_suggestion_dismissed',
	zoneSeenSince: 'zone_seen_since',
	/** The REPLICA_SCHEMA of the build that last wrote this replica. */
	replicaSchema: 'replica_schema'
} as const;

export async function getMeta<T>(db: ReplicaDb, key: string, fallback: T): Promise<T> {
	const row = await db.meta.get(key);
	return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(db: ReplicaDb, key: string, value: unknown): Promise<void> {
	await db.meta.put({ key, value });
}

/** The reset lever: drop the local DB and re-pull. It **refuses while the outbox
    is non-empty** — the outbox holds the only copy of those Entries — and it is
    also what fires automatically when a version check reports an incompatible
    local schema (spec §5.4). */
export async function resetReplica(db: ReplicaDb): Promise<{ ok: boolean; waiting: number }> {
	const waiting = await db.outbox.count();
	if (waiting > 0) return { ok: false, waiting };

	await db.transaction(
		'rw',
		[db.revisions, db.entries, db.babies, db.members, db.foods, db.targets, db.households, db.meta],
		async () => {
			await Promise.all([
				db.revisions.clear(),
				db.entries.clear(),
				db.babies.clear(),
				db.members.clear(),
				db.foods.clear(),
				db.targets.clear(),
				db.households.clear()
			]);
			await db.meta.delete(META.cursor);
			await db.meta.delete(META.lastSyncAt);
		}
	);
	return { ok: true, waiting: 0 };
}

export type SchemaCheck =
	| { compatible: true }
	/** Written by a newer build: this one cannot be trusted to read it. The reset
	    still refuses while the outbox is non-empty — those Entries exist nowhere
	    else — which leaves the passive banner and a Member who can act. */
	| { compatible: false; reset: boolean; waiting: number };

/** Runs on boot, before anything reads the replica. */
export async function checkReplicaSchema(db: ReplicaDb): Promise<SchemaCheck> {
	const written = await getMeta<number>(db, META.replicaSchema, REPLICA_SCHEMA);
	if (written <= REPLICA_SCHEMA) {
		if (written !== REPLICA_SCHEMA) await setMeta(db, META.replicaSchema, REPLICA_SCHEMA);
		return { compatible: true };
	}
	const outcome = await resetReplica(db);
	if (outcome.ok) await setMeta(db, META.replicaSchema, REPLICA_SCHEMA);
	return { compatible: false, reset: outcome.ok, waiting: outcome.waiting };
}

/** A removed response makes a best-effort local wipe, and says so plainly. The
    outbox goes too here — anything in it at the moment of removal is rejected
    and lost, which is accepted rather than papered over (spec §6.4). */
export async function wipeEverything(db: ReplicaDb): Promise<void> {
	await Promise.all(db.tables.map((table) => table.clear()));
}
