#!/usr/bin/env node
/* The operator's entrypoint. Spec §4.4 and §6.1.

   A second entrypoint in the same image:

       docker exec <container> babylog members
       docker exec <container> babylog rescue "Mama"

   It opens the SQLite file directly rather than talking to the running server,
   which is what makes "works without the app running" free — WAL mode makes
   concurrent access from a second process fine. There is deliberately **no HTTP
   admin endpoint**: an admin route on a public-internet app is a door that only
   ever needs to exist for five minutes a year.

   This script deliberately imports nothing from the app. It is run by a stranger
   under stress, from a shell, possibly against a stopped container, so it depends
   on exactly two things: better-sqlite3 and the two files in the volume. The one
   piece of shared knowledge — how a session token is hashed — is pinned by a test
   (`src/lib/server/cli.test.ts`) rather than by an import. */

import Database from 'better-sqlite3';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR && process.env.DATA_DIR !== '' ? process.env.DATA_DIR : '/data';
const DB_PATH = `${DATA_DIR}/app.db`;
const SECRET_PATH = `${DATA_DIR}/secret.key`;
/** Fifteen minutes, because you are standing at the terminal. */
export const RESCUE_TTL_MS = 15 * 60_000;

/**
 * @param {string} token
 * @param {Buffer} secret
 * @returns {string}
 */
export function hashToken(token, secret) {
	return createHmac('sha256', secret).update(token).digest('base64url');
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
	console.error(message);
	process.exit(1);
}

/** @returns {import('better-sqlite3').Database} */
function open() {
	try {
		const db = new Database(DB_PATH, { fileMustExist: true });
		db.pragma('busy_timeout = 5000');
		return db;
	} catch {
		return fail(
			`No Baby Log Book database at ${DB_PATH}.\n` +
				'If the data lives somewhere else, set DATA_DIR to that directory.'
		);
	}
}

/** @returns {Buffer} */
function secret() {
	try {
		return readFileSync(SECRET_PATH);
	} catch {
		return fail(
			`Cannot read ${SECRET_PATH}.\n` +
				'That file is created on first boot and is what signs every session.\n' +
				'Start the container once, then try again.'
		);
	}
}

/** @returns {string} */
function origin() {
	const value = process.env.ORIGIN;
	if (!value) {
		return fail(
			'ORIGIN is not set in this shell, so the link below would have no address.\n' +
				'Run it with the same ORIGIN the container uses, for example:\n' +
				'  docker exec -e ORIGIN=https://log.example.com <container> babylog rescue "Mama"'
		);
	}
	return value.replace(/\/$/, '');
}

/** @param {import('better-sqlite3').Database} db */
function members(db) {
	const rows = /** @type {Array<{id: string, display_name: string, role: string, removed_at: number | null, devices: number, last_seen: number | null}>} */ (db
		.prepare(
			`SELECT m.id, m.display_name, m.role, m.removed_at,
			        (SELECT COUNT(*) FROM sessions s WHERE s.member_id = m.id AND s.revoked_at IS NULL) AS devices,
			        (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.member_id = m.id) AS last_seen
			 FROM members m ORDER BY m.display_name`
		)
		.all());

	if (rows.length === 0) {
		console.log('No one has access yet. Start the container and read its log for the setup link.');
		return;
	}

	console.log('');
	for (const row of rows) {
		const state = row.removed_at ? 'removed' : row.role;
		const seen = row.last_seen ? new Date(row.last_seen).toISOString().slice(0, 16).replace('T', ' ') : 'never';
		console.log(`  ${row.display_name}`);
		console.log(`      ${state} · ${row.devices} device(s) · last seen ${seen} UTC`);
		console.log(`      id ${row.id}`);
	}
	console.log('');
}

/**
 * Re-binds a Device to a Member who already exists. It does NOT create a new
 * person: a new row would leave two "Mamas" and split three years of
 * attribution between them, since every Revision points at the old one.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} needle
 */
function rescue(db, needle) {
	const rows = /** @type {Array<{id: string, household_id: string, display_name: string, role: string, removed_at: number | null}>} */ (db
		.prepare(
			`SELECT id, household_id, display_name, role, removed_at FROM members
			 WHERE removed_at IS NULL AND (id = ? OR display_name = ? COLLATE NOCASE)`
		)
		.all(needle, needle));

	if (rows.length === 0) {
		fail(`No one here is called “${needle}”. Run "babylog members" to see the names.`);
	}
	if (rows.length > 1) {
		fail(
			`More than one person is called “${needle}”. Use the id instead:\n` +
				rows.map((r) => `  ${r.id}  ${r.display_name}`).join('\n')
		);
	}

	const member = rows[0];
	const key = secret();
	const token = randomBytes(16).toString('base64url');
	const now = Date.now();
	const expires = now + RESCUE_TTL_MS;

	db.prepare(
		`INSERT INTO claim_links (token_hash, kind, household_id, member_id, created_at, expires_at)
		 VALUES (?, 'rescue', ?, ?, ?, ?)`
	).run(hashToken(token, key), member.household_id, member.id, now, expires);

	/* Read by someone whose phone is gone and who is unlikely to have done this
	   before. It names the Member it re-binds, states the expiry, and says that it
	   re-binds an existing person rather than creating a new one (spec §6.1). */
	console.log('');
	console.log(`This link signs a phone or browser back in as ${member.display_name}.`);
	console.log('It does not create a new person: everything they have already');
	console.log('logged stays theirs.');
	console.log('');
	console.log(`    ${origin()}/claim?t=${token}`);
	console.log('');
	console.log('It expires in 15 minutes and works once. Open it on the device that');
	console.log('needs access, then press the button on the page.');
	console.log('');
}

function usage() {
	console.log('');
	console.log('babylog — the Baby Log Book operator tool');
	console.log('');
	console.log('  babylog members            who has access, and from how many devices');
	console.log('  babylog rescue <name>      a 15-minute link to sign a device back in');
	console.log('');
	console.log(`It reads the database directly from ${DATA_DIR}, so it works whether or`);
	console.log('not the app is running. Set DATA_DIR if the volume is mounted elsewhere.');
	console.log('');
}

/** @param {string[]} argv */
function main(argv) {
	const [command, ...rest] = argv;
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		usage();
		return;
	}

	const db = open();
	try {
		if (command === 'members') {
			members(db);
			return;
		}
		if (command === 'rescue') {
			const needle = rest.join(' ').trim();
			if (needle === '') fail('Who for? Try: babylog rescue "Mama"');
			rescue(db, needle);
			return;
		}
		usage();
		process.exitCode = 1;
	} finally {
		db.close();
	}
}

/* Run only when this file *is* the command, so a test can import the hashing
   without executing anything. `realpathSync` matters: in the image the command is
   the symlink /usr/local/bin/babylog, and comparing the raw argv would never
   match. */
function invokedDirectly() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(entry) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}

if (invokedDirectly()) main(process.argv.slice(2));
