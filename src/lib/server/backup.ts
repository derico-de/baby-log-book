/* Backups. Spec §4.4.

   Nightly online `.backup` into /data/backups/app-YYYY-MM-DD.db, keeping about
   fourteen, so a host-level snapshot picks up a consistent file rather than a
   torn mid-write WAL. Shipping them off-box is the operator's business; making
   them *correct* is ours — which is why `PRAGMA integrity_check` runs on each
   backup the moment it is written, and logs loudly on failure. A broken chain
   surfaces that night, not on the worst day.

   Restore is deliberately dumb and documented, with no CLI verb: stop the
   container, replace /data/app.db, delete the stale -wal and -shm, start. A file
   copy is something an operator can do under stress at 3am. */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { openDb, integrityOk, type Db } from './db';

export const KEEP_NIGHTLY = 14;
export const KEEP_PRE_MIGRATION = 5;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date, because the operator reading the directory listing is local. */
export function nightlyName(at: Date): string {
	return `app-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.db`;
}

export function preMigrationName(at: Date): string {
	return (
		`app-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
		`T${pad(at.getHours())}${pad(at.getMinutes())}-premigration.db`
	);
}

export interface BackupResult {
	path: string;
	bytes: number;
	integrityOk: boolean;
}

/** Takes one online backup and verifies it. Throws only if the copy itself
    failed; a failed integrity check is reported, loudly, and left on disk for
    the operator to look at. */
export async function takeBackup(
	db: Db,
	dir: string,
	name: string,
	log: (line: string) => void = console.log
): Promise<BackupResult> {
	mkdirSync(dir, { recursive: true });
	const path = `${dir}/${name}`;
	await db.backup(path);

	const bytes = statSync(path).size;
	const copy = openDb(path, { readonly: true });
	let ok = false;
	try {
		ok = integrityOk(copy);
	} finally {
		copy.close();
	}

	if (ok) log(`backup: ${path} (${bytes} bytes, integrity ok)`);
	else log(`BACKUP INTEGRITY CHECK FAILED: ${path} — this backup cannot be trusted`);

	return { path, bytes, integrityOk: ok };
}

/** The synchronous form, for the one place blocking is correct: nothing may
    touch the schema until the copy exists, so boot cannot hand this to a
    promise. `VACUUM INTO` writes a consistent snapshot of a live WAL database in
    one statement — which is exactly what a pre-migration backup needs and what a
    plain file copy of app.db would fail to be. */
export function takeBackupSync(
	db: Db,
	dir: string,
	name: string,
	log: (line: string) => void = console.log
): BackupResult {
	mkdirSync(dir, { recursive: true });
	const path = `${dir}/${name}`;
	db.prepare('VACUUM INTO ?').run(path);

	const bytes = statSync(path).size;
	const copy = openDb(path, { readonly: true });
	let ok = false;
	try {
		ok = integrityOk(copy);
	} finally {
		copy.close();
	}

	if (ok) log(`backup: ${path} (${bytes} bytes, integrity ok)`);
	else log(`BACKUP INTEGRITY CHECK FAILED: ${path} — this backup cannot be trusted`);

	return { path, bytes, integrityOk: ok };
}

/** Keeps the most recent of each kind and deletes the rest. */
export function pruneBackups(dir: string, log: (line: string) => void = console.log): string[] {
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir).filter((f) => f.startsWith('app-') && f.endsWith('.db'));
	const nightly = files.filter((f) => !f.includes('premigration')).sort();
	const pre = files.filter((f) => f.includes('premigration')).sort();

	const doomed = [
		...nightly.slice(0, Math.max(0, nightly.length - KEEP_NIGHTLY)),
		...pre.slice(0, Math.max(0, pre.length - KEEP_PRE_MIGRATION))
	];
	for (const file of doomed) {
		unlinkSync(`${dir}/${file}`);
		log(`backup: pruned ${file}`);
	}
	return doomed;
}

/** True when tonight's backup has not been taken yet and it is late enough to
    take it. Checked hourly rather than scheduled at a fixed instant, so a
    container that was restarted at 02:59 still backs up. */
export function backupDue(dir: string, at: Date, earliestHour = 3): boolean {
	if (at.getHours() < earliestHour) return false;
	return !existsSync(`${dir}/${nightlyName(at)}`);
}

export interface NightlyHandle {
	stop: () => void;
}

export function startNightlyBackups(
	db: Db,
	dir: string,
	log: (line: string) => void = console.log
): NightlyHandle {
	const tick = async () => {
		const at = new Date();
		if (!backupDue(dir, at)) return;
		try {
			await takeBackup(db, dir, nightlyName(at), log);
			pruneBackups(dir, log);
		} catch (error) {
			log(`backup failed: ${(error as Error).message}`);
		}
	};

	void tick();
	const timer = setInterval(() => void tick(), 60 * 60_000);
	/* A backup timer must never be the reason a container refuses to exit. */
	timer.unref?.();
	return { stop: () => clearInterval(timer) };
}
