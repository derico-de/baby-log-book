/* The deployment's inputs. Spec §4.4.

   The governing rule of this whole file: anything the deployment needs done
   correctly, the app does — not the proxy, not the runbook. A stranger pulls
   this image; the only failure modes worth having are the ones they can
   diagnose in thirty seconds. */

import { env } from '$env/dynamic/private';

export interface Config {
	/** Required. The app cannot discover its own public URL and it needs one: a
	    Claim Link is an absolute URL sent over WhatsApp, so a wrong origin mints
	    dead invites *silently*. Boot failure is the only failure mode cheap
	    enough for a stranger to diagnose. */
	origin: string;
	/** True iff `origin` is https — which is what decides the cookie's `Secure`
	    flag, so `http://localhost:3000` works with no dev-only switch. */
	secure: boolean;
	dataDir: string;
	dbPath: string;
	backupDir: string;
	secretPath: string;
	/** Off by default. Behind an unknown proxy topology an untrusted
	    `X-Forwarded-For` is a forged client IP walking through the rate limit. */
	trustProxy: boolean;
	/** Set only for deliberate rotation; otherwise the key lives in the volume,
	    where it can be lost only by destroying the data it protects. */
	sessionSecretOverride: string | null;
}

export class BootError extends Error {}

function requireOrigin(raw: string | undefined): string {
	if (!raw || raw.trim() === '') {
		throw new BootError(
			'ORIGIN is required and this container will not start without it.\n' +
				'Set it to the public URL Members will open, with no trailing slash:\n' +
				'  ORIGIN=https://log.example.com\n' +
				'It is the address every Claim Link is built from, so a wrong value\n' +
				'sends out invites that cannot be claimed.'
		);
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new BootError(`ORIGIN is not a URL: ${raw}\nExpected something like https://log.example.com`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new BootError(`ORIGIN must be http or https, not ${url.protocol}`);
	}
	/* Normalised once here so no caller has to think about trailing slashes. */
	return url.origin;
}

const truthy = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

export function readConfig(source: Record<string, string | undefined> = env): Config {
	const origin = requireOrigin(source.ORIGIN);
	const dataDir = source.DATA_DIR && source.DATA_DIR !== '' ? source.DATA_DIR : '/data';
	return {
		origin,
		secure: origin.startsWith('https:'),
		dataDir,
		/* The WAL and SHM sidecars land beside it — SQLite creates them in that
		   directory and that is not optional. */
		dbPath: `${dataDir}/app.db`,
		backupDir: `${dataDir}/backups`,
		secretPath: `${dataDir}/secret.key`,
		trustProxy: truthy(source.TRUST_PROXY),
		sessionSecretOverride: source.SESSION_SECRET && source.SESSION_SECRET !== '' ? source.SESSION_SECRET : null
	};
}

/** Baked in at build time by vite.config.ts. Shown in the UI beside a source
    link, which is how AGPL §13 is satisfied for every operator automatically. */
export const VERSION = {
	app: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
	sha: typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'unknown',
	source: 'https://github.com/MrTango/baby-log-book'
};
