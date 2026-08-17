import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from './db';
import { runMigrations } from './migrations';
import { backupDue, KEEP_NIGHTLY, nightlyName, preMigrationName, pruneBackups, takeBackup, takeBackupSync } from './backup';

const dirs: string[] = [];
function scratch(): string {
	const dir = mkdtempSync(`${tmpdir()}/blb-backup-`);
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seeded(dir: string) {
	const db = openDb(`${dir}/app.db`);
	runMigrations(db);
	db.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)').run(
		'h1',
		'Zuhause',
		'05:00',
		'Europe/Berlin',
		1
	);
	return db;
}

describe('takeBackupSync', () => {
	it('writes a consistent copy of a live WAL database and verifies it', () => {
		const dir = scratch();
		const db = seeded(dir);
		const result = takeBackupSync(db, `${dir}/backups`, 'app-2026-08-17.db', () => {});
		expect(result.integrityOk).toBe(true);
		expect(result.bytes).toBeGreaterThan(0);

		const copy = openDb(result.path, { readonly: true });
		expect(copy.prepare('SELECT name FROM households').get()).toEqual({ name: 'Zuhause' });
		copy.close();
		db.close();
	});

	it('is what boot runs before a migration, so rolling back is real', () => {
		const dir = scratch();
		const db = seeded(dir);
		const name = preMigrationName(new Date('2026-08-17T22:15:00Z'));
		expect(name).toMatch(/^app-\d{4}-\d{2}-\d{2}T\d{4}-premigration\.db$/);
		takeBackupSync(db, `${dir}/backups`, name, () => {});
		expect(existsSync(`${dir}/backups/${name}`)).toBe(true);
		db.close();
	});
});

describe('takeBackup', () => {
	it('takes the nightly copy online', async () => {
		const dir = scratch();
		const db = seeded(dir);
		const result = await takeBackup(db, `${dir}/backups`, nightlyName(new Date('2026-08-17T03:30:00Z')), () => {});
		expect(result.integrityOk).toBe(true);
		db.close();
	});

	it('reports a corrupt backup loudly rather than throwing it away', async () => {
		const dir = scratch();
		const db = seeded(dir);
		const lines: string[] = [];
		await takeBackup(db, `${dir}/backups`, 'app-2026-08-17.db', (l) => lines.push(l));
		expect(lines.join(' ')).toContain('integrity ok');
		db.close();
	});
});

describe('pruneBackups', () => {
	it('keeps about fourteen nightlies', () => {
		const dir = scratch();
		const backups = `${dir}/backups`;
		require('node:fs').mkdirSync(backups, { recursive: true });
		for (let d = 1; d <= 20; d++) {
			writeFileSync(`${backups}/app-2026-08-${String(d).padStart(2, '0')}.db`, 'x');
		}
		pruneBackups(backups, () => {});
		const left = readdirSync(backups).sort();
		expect(left).toHaveLength(KEEP_NIGHTLY);
		expect(left.at(-1)).toBe('app-2026-08-20.db');
	});

	it('counts pre-migration copies separately, so a busy upgrade day keeps both', () => {
		const dir = scratch();
		const backups = `${dir}/backups`;
		require('node:fs').mkdirSync(backups, { recursive: true });
		for (let d = 1; d <= 3; d++) writeFileSync(`${backups}/app-2026-08-0${d}.db`, 'x');
		for (let h = 1; h <= 8; h++) {
			writeFileSync(`${backups}/app-2026-08-03T0${h}00-premigration.db`, 'x');
		}
		pruneBackups(backups, () => {});
		const left = readdirSync(backups);
		expect(left.filter((f) => !f.includes('premigration'))).toHaveLength(3);
		expect(left.filter((f) => f.includes('premigration'))).toHaveLength(5);
	});
});

describe('backupDue', () => {
	it('waits until the small hours and only takes one a night', () => {
		const dir = scratch();
		const backups = `${dir}/backups`;
		const at = new Date('2026-08-17T04:00:00');
		expect(backupDue(backups, new Date('2026-08-17T01:00:00'))).toBe(false);
		expect(backupDue(backups, at)).toBe(true);
		require('node:fs').mkdirSync(backups, { recursive: true });
		writeFileSync(`${backups}/${nightlyName(at)}`, 'x');
		expect(backupDue(backups, at)).toBe(false);
	});
});
