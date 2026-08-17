/* Boot. Spec §4.4.

   The order matters and every step is deliberate:

     1. Read the environment. No ORIGIN, no boot — a Claim Link is an absolute
        URL sent over WhatsApp, so a wrong origin mints dead invites silently.
     2. Open the database.
     3. Back up, if there is anything to back up and a migration is pending. This
        is the only thing that makes "roll back to the previous tag" real.
     4. Migrate. Failure refuses to start, loudly: read-only sounds kinder and is
        a trap, because every Device would keep queueing pushes that will never
        be accepted and the failure would stay silent for hours.
     5. Load or generate the session signing key in the volume.
     6. If the Household has no Members, print a bootstrap Claim Link to stdout —
        so first run needs no command at all. That line is the first thing a new
        operator sees after `docker run`, and it has to stand alone.
     7. Start the nightly backup timer. */

import { mintBootstrap } from './claims';
import { loadSecret } from './auth';
import { openDb, type Db } from './db';
import { BootError, readConfig, VERSION, type Config } from './env';
import { pendingMigrations, runMigrations } from './migrations';
import { preMigrationName, pruneBackups, startNightlyBackups, takeBackupSync } from './backup';
import { theHousehold } from './store';

export interface Boot {
	db: Db;
	config: Config;
	secret: Buffer;
}

let booted: Boot | null = null;

function log(line: string) {
	console.log(`[baby-log-book] ${line}`);
}

function countMembers(db: Db): number {
	const row = db.prepare('SELECT COUNT(*) AS n FROM members').get() as { n: number };
	return row.n;
}

/** The boot claim link is a stranger's onboarding path, not the author's private
    recovery hatch, and the wording has to read that way: it stands alone with no
    surrounding documentation (spec §6.1). */
function printBootstrapLink(url: string, expiresAt: number): void {
	const expires = new Date(expiresAt).toISOString().replace('T', ' ').slice(0, 16);
	log('');
	log('No one has access to this Baby Log Book yet.');
	log('Open this link to set it up. Whoever opens it becomes the first owner');
	log('of the household, and the link stops working once it has been used.');
	log('');
	log(`    ${url}`);
	log('');
	log(`It expires on ${expires} UTC. Restart the container to get a new one.`);
	log('');
}

export function boot(): Boot {
	if (booted) return booted;

	const config = readConfig();
	log(`version ${VERSION.app} (${VERSION.sha})`);
	log(`origin ${config.origin}`);

	const db = openDb(config.dbPath);

	const pending = pendingMigrations(db);
	if (pending.length > 0) {
		const hasData = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number })
			.n > 1;
		if (hasData) {
			/* Synchronous by necessity: nothing may touch the schema until the copy
			   exists. A failure here refuses the boot, because migrating without the
			   backup would remove the only thing that makes rolling back real. */
			takeBackupSync(db, config.backupDir, preMigrationName(new Date()), log);
			pruneBackups(config.backupDir, log);
		}
		log(`${pending.length} migration(s) pending`);
	}

	/* Any throw here takes the process with it, which is the point. */
	runMigrations(db, log);

	const secret = loadSecret(config.secretPath, config.sessionSecretOverride);

	if (countMembers(db) === 0) {
		const link = mintBootstrap(db, secret, { origin: config.origin, now: Date.now() });
		printBootstrapLink(link.url, link.expires_at);
	} else {
		const household = theHousehold(db);
		log(`household ready — zone ${household?.zone ?? 'unset'}, day start ${household?.day_start ?? 'unset'}`);
	}

	startNightlyBackups(db, config.backupDir, log);

	booted = { db, config, secret };
	return booted;
}

/** For the endpoints. Boots on first use, which in `adapter-node` is the first
    request — and a failed boot fails that request loudly rather than serving a
    half-configured app. */
export function server(): Boot {
	return boot();
}

export { BootError };
