/* The migration runner. Spec §4.4, and the SQLite research.

   Hand-rolled, because `db.transaction(() => { exec(sql); record(name) })` gives
   per-migration atomicity in one line — a better answer to "what happens if it
   fails halfway" than either library offers on this engine.

   The contract, which is a contract and not a hope, because operators skip
   versions and run unattended updaters:

     - Migrations are cumulative from any older version.
     - They are never destructive within a major.
     - They run on boot, and failure refuses to start, loudly. Read-only sounds
       kinder and is a trap: every Device would keep logging and queueing pushes
       that will never be accepted, so the failure stays silent for hours and
       arrives as a pile of rejected writes. A container that will not start is
       visible in thirty seconds.
     - A backup is taken immediately before any migration runs. That is the only
       thing that makes "roll back to the previous tag" real. Down-migrations are
       not written. */

import type { Db } from './db';

export interface Migration {
	name: string;
	sql: string;
}

export const MIGRATIONS: Migration[] = [
	{
		name: '0001-initial-schema',
		sql: `
			/* One Household per deployment (ADR-0009). Every row still carries the
			   boundary, so a hosted version later is a deployment mode rather than a
			   migration over every Entry ever logged. */
			CREATE TABLE households (
				id           TEXT PRIMARY KEY,
				name         TEXT NOT NULL DEFAULT '',
				/* An hour, not an instant (spec §7.4). */
				day_start    TEXT NOT NULL DEFAULT '05:00',
				/* One IANA zone id — the single lens. Never an offset. */
				zone         TEXT NOT NULL,
				created_at   INTEGER NOT NULL
			);

			CREATE TABLE babies (
				id           TEXT PRIMARY KEY,
				household_id TEXT NOT NULL REFERENCES households(id),
				name         TEXT NOT NULL DEFAULT '',
				birth_date   TEXT NOT NULL DEFAULT '',
				deleted_at   INTEGER
			);
			CREATE INDEX babies_household ON babies(household_id);

			/* Removal is a state, never a deletion: every Revision they ever wrote
			   points at this row, and the timeline must still read "logged by Oma"
			   in three years (spec §6.4). */
			CREATE TABLE members (
				id           TEXT PRIMARY KEY,
				household_id TEXT NOT NULL REFERENCES households(id),
				display_name TEXT NOT NULL DEFAULT '',
				role         TEXT NOT NULL DEFAULT 'caregiver',
				removed_at   INTEGER,
				locale       TEXT
			);
			CREATE INDEX members_household ON members(household_id);

			CREATE TABLE foods (
				id           TEXT PRIMARY KEY,
				household_id TEXT NOT NULL REFERENCES households(id),
				name         TEXT NOT NULL DEFAULT '',
				deleted_at   INTEGER
			);
			CREATE INDEX foods_household ON foods(household_id);

			/* A Target is a duration plus the anchor it measures from, which is what
			   makes v2 push notifications additive (ADR-0006). */
			CREATE TABLE targets (
				id           TEXT PRIMARY KEY,
				household_id TEXT NOT NULL REFERENCES households(id),
				baby_id      TEXT NOT NULL,
				activity     TEXT NOT NULL,
				duration_s   INTEGER NOT NULL,
				anchor       TEXT NOT NULL,
				deleted_at   INTEGER
			);
			CREATE INDEX targets_household ON targets(household_id);

			/* One entries table, a type discriminator, shared columns and a JSON
			   payload (ADR-0001). A Live Session is a row with no ended_at — not a
			   separate concept. */
			CREATE TABLE entries (
				id             TEXT PRIMARY KEY,
				household_id   TEXT NOT NULL REFERENCES households(id),
				baby_id        TEXT NOT NULL,
				type           TEXT NOT NULL,
				occurred_at    INTEGER NOT NULL,
				ended_at       INTEGER,
				/* Captured because it is unrecoverable later. Nothing in v1 reads it
				   (spec §7.3). */
				recording_zone TEXT NOT NULL DEFAULT 'UTC',
				note           TEXT,
				payload        TEXT NOT NULL DEFAULT '{}',
				logged_by      TEXT,
				logged_at      INTEGER,
				edited_by      TEXT,
				edited_at      INTEGER,
				/* A tombstone hides an Entry and never purges it (ADR-0002), which is
				   what makes a 3am mistake recoverable on every Device. */
				deleted_at     INTEGER,
				merged_into    TEXT
			);
			CREATE INDEX entries_timeline ON entries(household_id, baby_id, occurred_at);
			/* The open-session lookup the Session Merge runs on every push. */
			CREATE INDEX entries_open ON entries(household_id, baby_id, type, ended_at)
				WHERE ended_at IS NULL AND deleted_at IS NULL;

			/* The log. seq is the cursor and it is assigned inside the write
			   transaction; SQLite serialises writers, so sequence order is commit
			   order and the wall-clock-watermark trap closes by construction
			   (ADR-0004). Never use merge_at as a cursor. */
			CREATE TABLE revisions (
				seq          INTEGER PRIMARY KEY AUTOINCREMENT,
				/* Client-minted, which is what makes push idempotent on retry. */
				id           TEXT NOT NULL UNIQUE,
				household_id TEXT NOT NULL REFERENCES households(id),
				kind         TEXT NOT NULL,
				entity_id    TEXT NOT NULL,
				fields       TEXT NOT NULL,
				/* The merge key: the writing Device's clock corrected by its observed
				   server offset, ties broken by device_id. */
				merge_at     INTEGER NOT NULL,
				device_id    TEXT NOT NULL,
				/* NULL means the app did it. The one place that happens is a Session
				   Merge, and the history says so honestly (spec §5.3). */
				author_id    TEXT,
				/* Set when a future-dated merge key was clamped. Never a rejection. */
				skewed       INTEGER NOT NULL DEFAULT 0,
				received_at  INTEGER NOT NULL
			);
			CREATE INDEX revisions_cursor ON revisions(household_id, seq);
			CREATE INDEX revisions_entity ON revisions(household_id, kind, entity_id);

			/* Nothing authenticating ever syncs, so this table has no counterpart in
			   the log. The token is stored as a hash: a stolen database file must not
			   hand over live sessions. */
			CREATE TABLE sessions (
				token_hash   TEXT PRIMARY KEY,
				member_id    TEXT NOT NULL REFERENCES members(id),
				device_id    TEXT NOT NULL,
				created_at   INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL,
				/* No fixed expiry. Revocation is the control, not a timer: a 90-day
				   timer signs Oma out precisely when re-authentication is hardest
				   (spec §6.2). */
				revoked_at   INTEGER
			);
			CREATE INDEX sessions_member ON sessions(member_id);

			/* Every way in. Claimed by a POST behind a button, never by the GET that
			   fetches it — WhatsApp, Signal and Telegram all fetch a URL server-side
			   to build the preview card (spec §6.1). */
			CREATE TABLE claim_links (
				token_hash   TEXT PRIMARY KEY,
				kind         TEXT NOT NULL,
				household_id TEXT,
				/* An Invite carries the name and role up front, so the timeline reads
				   "Oma" from her first Entry rather than "Unnamed". */
				display_name TEXT,
				role         TEXT,
				/* A Rescue Link re-binds a Member who already exists. */
				member_id    TEXT,
				created_by   TEXT,
				created_at   INTEGER NOT NULL,
				expires_at   INTEGER NOT NULL,
				claimed_at   INTEGER,
				/* Five attempts per token, then the token is burnt permanently — the
				   limit an attacker cannot rotate around (spec §4.4). */
				attempts     INTEGER NOT NULL DEFAULT 0,
				burnt_at     INTEGER
			);
			CREATE INDEX claim_links_member ON claim_links(member_id);
		`
	}
];

const ensureLedger = (db: Db) =>
	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name       TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		);
	`);

export function appliedMigrations(db: Db): string[] {
	ensureLedger(db);
	return (db.prepare('SELECT name FROM _migrations ORDER BY name').all() as Array<{ name: string }>).map(
		(r) => r.name
	);
}

export function pendingMigrations(db: Db): Migration[] {
	const applied = new Set(appliedMigrations(db));
	return MIGRATIONS.filter((m) => !applied.has(m.name));
}

/** Runs what is missing, one transaction per migration. Throws on the first
    failure with nothing half-applied. */
export function runMigrations(db: Db, log: (line: string) => void = () => {}): string[] {
	const pending = pendingMigrations(db);
	const ran: string[] = [];
	const record = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

	for (const migration of pending) {
		log(`migrating: ${migration.name}`);
		db.transaction(() => {
			db.exec(migration.sql);
			record.run(migration.name, Date.now());
		})();
		ran.push(migration.name);
	}
	return ran;
}
