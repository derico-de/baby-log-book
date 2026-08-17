import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb, integrityOk } from './db';
import { appliedMigrations, MIGRATIONS, pendingMigrations, runMigrations } from './migrations';

function fresh() {
	const db = openDb(':memory:');
	return db;
}

describe('the boot-time migration runner', () => {
	it('brings an empty database up to date', () => {
		const db = fresh();
		expect(runMigrations(db)).toEqual(MIGRATIONS.map((m) => m.name));
		expect(appliedMigrations(db)).toEqual(MIGRATIONS.map((m) => m.name));
		expect(integrityOk(db)).toBe(true);
	});

	it('is a no-op on a database that is already current', () => {
		const db = fresh();
		runMigrations(db);
		expect(runMigrations(db)).toEqual([]);
		expect(pendingMigrations(db)).toEqual([]);
	});

	it('is cumulative from any older version, which is what lets operators skip', () => {
		const db = fresh();
		/* Pretend this deployment only ever saw the first migration. */
		runMigrations(db);
		db.prepare('DELETE FROM _migrations WHERE name = ?').run(MIGRATIONS.at(-1)!.name);
		expect(pendingMigrations(db).map((m) => m.name)).toEqual([MIGRATIONS.at(-1)!.name]);
	});

	it('leaves nothing half-applied when a migration fails', () => {
		const db = fresh();
		runMigrations(db);
		const broken = [{ name: '9999-broken', sql: 'CREATE TABLE ok_so_far (x); SELECT nonsense_function();' }];
		expect(() => {
			for (const m of broken) {
				db.transaction(() => {
					db.exec(m.sql);
					db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(m.name, 1);
				})();
			}
		}).toThrow();
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok_so_far'")
			.all();
		expect(tables).toEqual([]);
		expect(appliedMigrations(db)).not.toContain('9999-broken');
	});

	it('opens with the pragmas the sync path depends on', () => {
		const db = openDb(':memory:');
		expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('assigns the cursor in commit order, never from a wall clock', () => {
		const db = fresh();
		runMigrations(db);
		db.prepare('INSERT INTO households (id, name, zone, created_at) VALUES (?,?,?,?)').run(
			'h1',
			'Zuhause',
			'Europe/Berlin',
			1
		);
		const insert = db.prepare(
			`INSERT INTO revisions (id, household_id, kind, entity_id, fields, merge_at, device_id, author_id, received_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`
		);
		/* The second revision carries an EARLIER merge_at, as a phone with a slow
		   clock would. Its seq must still be higher, or a client past that
		   watermark never sees it. */
		insert.run('r1', 'h1', 'entry', 'e1', '{}', 5000, 'a', 'm1', 1);
		insert.run('r2', 'h1', 'entry', 'e1', '{}', 1000, 'b', 'm1', 2);
		const rows = db.prepare('SELECT id, seq FROM revisions ORDER BY seq').all() as Array<{
			id: string;
			seq: number;
		}>;
		expect(rows.map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(rows[1].seq).toBeGreaterThan(rows[0].seq);
	});

	it('refuses a second revision with the same client-minted id, so replay is a no-op', () => {
		const db = fresh();
		runMigrations(db);
		db.prepare('INSERT INTO households (id, name, zone, created_at) VALUES (?,?,?,?)').run(
			'h1',
			'',
			'Europe/Berlin',
			1
		);
		const insert = db.prepare(
			`INSERT INTO revisions (id, household_id, kind, entity_id, fields, merge_at, device_id, author_id, received_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`
		);
		insert.run('r1', 'h1', 'entry', 'e1', '{}', 1, 'a', 'm1', 1);
		expect(() => insert.run('r1', 'h1', 'entry', 'e1', '{}', 1, 'a', 'm1', 2)).toThrow(/UNIQUE/);
	});
});

describe('opening the database', () => {
	it('puts a real file in WAL mode, silently', () => {
		// WAL is what makes `docker exec babylog members` safe while the server is
		// running. When a volume cannot host it — an NFS or CIFS mount — openDb
		// says which mount type to suspect instead of surfacing SQLITE_IOERR.
		const dir = mkdtempSync(`${tmpdir()}/blb-wal-`);
		try {
			const lines: string[] = [];
			const db = openDb(`${dir}/app.db`, { log: (line) => lines.push(line) });
			expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
			expect(lines).toEqual([]);
			db.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('leaves an in-memory database alone', () => {
		const lines: string[] = [];
		openDb(':memory:', { log: (line) => lines.push(line) });
		expect(lines).toEqual([]);
	});
});
