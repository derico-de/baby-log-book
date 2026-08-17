/* The one piece of knowledge `bin/babylog.js` duplicates rather than imports:
   how a token is stored. The CLI has to run from a shell against a possibly
   stopped container, so it depends on nothing but better-sqlite3 and the two
   files in the volume — and this test is what keeps that duplication honest. */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { hashToken, RESCUE_TTL_MS } from '../../../bin/babylog.js';
import { loadSecret, tokenHash } from './auth';
import { RESCUE_TTL_MS as APP_RESCUE_TTL_MS } from './claims';
import { openDb } from './db';
import { runMigrations } from './migrations';

const SECRET = Buffer.alloc(32, 3);

describe('the operator tool', () => {
	it('hashes a token exactly as the app does', () => {
		expect(hashToken('a-token', SECRET)).toBe(tokenHash('a-token', SECRET));
	});

	it('mints a Rescue Link with the same fifteen minutes', () => {
		expect(RESCUE_TTL_MS).toBe(APP_RESCUE_TTL_MS);
	});

	it('lists Members and mints a link the app can resolve', () => {
		const dir = mkdtempSync(`${tmpdir()}/blb-cli-`);
		try {
			const db = openDb(`${dir}/app.db`);
			runMigrations(db);
			db.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)').run(
				'h1',
				'Zuhause',
				'05:00',
				'Europe/Berlin',
				1
			);
			db.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)').run(
				'mum',
				'h1',
				'Mama',
				'parent'
			);
			db.close();

			/* The secret is created by the app on first boot; the CLI only reads it. */
			loadSecret(`${dir}/secret.key`);

			const env = { ...process.env, DATA_DIR: dir, ORIGIN: 'https://log.example.com' };
			const listed = execFileSync('node', ['bin/babylog.js', 'members'], { env, encoding: 'utf8' });
			expect(listed).toContain('Mama');
			expect(listed).toContain('parent');

			/* Invoked through a symlink, exactly as the image does with
			   /usr/local/bin/babylog — the raw argv there never ends in .js. */
			symlinkSync(resolve('bin/babylog.js'), `${dir}/babylog`);
			const minted = execFileSync('node', [`${dir}/babylog`, 'rescue', 'Mama'], { env, encoding: 'utf8' });
			expect(minted).toContain('https://log.example.com/claim?t=');
			expect(minted).toContain('15 minutes');
			/* It says plainly that it re-binds rather than creating someone new. */
			expect(minted).toContain('does not create a new person');

			const token = minted.match(/claim\?t=([A-Za-z0-9_-]+)/)?.[1] ?? '';
			const reopened = openDb(`${dir}/app.db`);
			const secret = loadSecret(`${dir}/secret.key`);
			const row = reopened
				.prepare('SELECT kind, member_id FROM claim_links WHERE token_hash = ?')
				.get(tokenHash(token, secret));
			expect(row).toEqual({ kind: 'rescue', member_id: 'mum' });
			reopened.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses to print a link with no ORIGIN to build it from', () => {
		const dir = mkdtempSync(`${tmpdir()}/blb-cli-`);
		try {
			const db = openDb(`${dir}/app.db`);
			runMigrations(db);
			db.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)').run(
				'h1',
				'',
				'05:00',
				'UTC',
				1
			);
			db.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)').run(
				'mum',
				'h1',
				'Mama',
				'parent'
			);
			db.close();
			loadSecret(`${dir}/secret.key`);

			const env = { ...process.env, DATA_DIR: dir, ORIGIN: '' };
			expect(() =>
				execFileSync('node', ['bin/babylog.js', 'rescue', 'Mama'], { env, encoding: 'utf8', stdio: 'pipe' })
			).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
