/* The driver, and the thin typed helper the research asked for.

   `better-sqlite3` 13.x with plain SQL. ADR-0001 leaves one table and roughly
   ten queries — below the threshold where a query layer pays for itself — and
   the migration story decided the rest: Kysely's SQLite migrator runs outside
   any transaction, so a halfway failure strands a partial schema on the one
   engine that implements transactional DDL properly.

   13.0.2+ ships eight prebuilt Node-API addons in the tarball, including
   linuxmusl-x64 and linuxmusl-arm64, so nothing here compiles on install and
   the same binary keeps working across Node 24 → 26. */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

export interface OpenOptions {
	readonly?: boolean;
	/** The CLI opens the file directly rather than talking to the server, which
	    is what makes "works without the app running" free. */
	verbose?: (message?: unknown, ...rest: unknown[]) => void;
	/** Where a diagnosis goes when the volume cannot do what SQLite needs. */
	log?: (line: string) => void;
}

export function openDb(path: string, options: OpenOptions = {}): Db {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

	const db = new Database(path, {
		readonly: options.readonly ?? false,
		verbose: options.verbose
	});

	/* better-sqlite3 defaults this to 5000ms; `node:sqlite` defaults it to 0,
	   which was one of the three reasons it lost. Stated rather than assumed. */
	db.pragma('busy_timeout = 5000');

	/* A read-only connection — the integrity check on a fresh backup — cannot
	   set a journal mode, and does not need to. */
	if (!options.readonly) {
		/* WAL is what makes a second process — `docker exec babylog members` —
		   safe while the server is running. It needs a shared-memory file beside
		   the database, which NFS and CIFS mounts do not provide: a self-hoster
		   who put the volume on a NAS share otherwise meets SQLITE_IOERR_SHMMAP
		   and nothing that explains it. */
		let mode = '';
		try {
			mode = String(db.pragma('journal_mode = WAL', { simple: true }));
		} catch (error) {
			mode = `error: ${(error as Error).message}`;
		}
		/* An in-memory database answers `memory` and that is correct; a file that
		   answers anything but `wal` is a volume that cannot do it. */
		if (path !== ':memory:' && mode !== 'wal') {
			(options.log ?? console.log)(
				`Could not switch ${path} to WAL mode (${mode}).\n` +
					'This almost always means the data directory is an NFS or CIFS mount,\n' +
					'which cannot host the shared-memory file SQLite needs. Move the volume\n' +
					'to local storage. Carrying on in rollback-journal mode, which works but\n' +
					'serialises the app against `babylog` while both are open.'
			);
			try {
				db.pragma('journal_mode = DELETE');
			} catch {
				/* Nothing left to try; the first query will say so properly. */
			}
		}
		db.pragma('foreign_keys = ON');
		/* NORMAL is the right trade under WAL: a crash can lose the last commits,
		   a power cut cannot corrupt the file. Every Device holds the whole log
		   anyway, and the outbox re-pushes. */
		db.pragma('synchronous = NORMAL');
	}

	return db;
}

/** One transaction, one wrapped function. This is the whole "query layer". */
export function transaction<T>(db: Db, fn: () => T): T {
	return db.transaction(fn)();
}

export function integrityOk(db: Db): boolean {
	const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
	return rows.length === 1 && rows[0].integrity_check === 'ok';
}
