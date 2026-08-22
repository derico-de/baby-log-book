/* The one piece of knowledge `bin/babylog.js` duplicates rather than imports:
   how a token is stored. The CLI has to run from a shell against a possibly
   stopped container, so it depends on nothing but better-sqlite3 and the two
   files in the volume — and this test is what keeps that duplication honest. */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { BOOTSTRAP_TTL_MS, DISCLOSURE, hashToken, RESCUE_TTL_MS } from '../../../bin/babylog.js';
import { loadSecret, tokenHash } from './auth';
import { claim, BOOTSTRAP_TTL_MS as APP_BOOTSTRAP_TTL_MS, RESCUE_TTL_MS as APP_RESCUE_TTL_MS } from './claims';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import { getHousehold, listMembers } from './store';

const SECRET = Buffer.alloc(32, 3);
const ORIGIN = 'https://log.example.com';

/** A data directory the CLI can be run against, with the app's own secret in it
    — the CLI only ever reads that file. */
function volume(): { dir: string; env: NodeJS.ProcessEnv; db: () => Db } {
	const dir = mkdtempSync(`${tmpdir()}/blb-cli-`);
	const db = openDb(`${dir}/app.db`);
	runMigrations(db);
	db.close();
	loadSecret(`${dir}/secret.key`);
	return {
		dir,
		env: { ...process.env, DATA_DIR: dir, ORIGIN },
		db: () => openDb(`${dir}/app.db`)
	};
}

function seedHousehold(db: Db, id: string, name: string, members: Array<[string, string, string]>) {
	db.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)').run(
		id,
		name,
		'05:00',
		'Europe/Berlin',
		1
	);
	for (const [memberId, displayName, role] of members) {
		db.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)').run(
			memberId,
			id,
			displayName,
			role
		);
	}
}

const run = (env: NodeJS.ProcessEnv, ...args: string[]) =>
	execFileSync('node', ['bin/babylog.js', ...args], { env, encoding: 'utf8' });

const tokenIn = (output: string) => output.match(/claim\?t=([A-Za-z0-9_-]+)/)?.[1] ?? '';

describe('the operator tool', () => {
	it('hashes a token exactly as the app does', () => {
		expect(hashToken('a-token', SECRET)).toBe(tokenHash('a-token', SECRET));
	});

	it('mints links with the same expiries the app uses', () => {
		expect(RESCUE_TTL_MS).toBe(APP_RESCUE_TTL_MS);
		expect(BOOTSTRAP_TTL_MS).toBe(APP_BOOTSTRAP_TTL_MS);
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

describe('babylog household', () => {
	it('mints a Founding Link the app turns into a new Household, named by the label', () => {
		const vol = volume();
		try {
			const first = vol.db();
			seedHousehold(first, 'h1', 'Zuhause', [['mum', 'Mama', 'parent']]);
			first.close();

			const minted = run(vol.env, 'household', 'Anna & Tom');
			expect(minted).toContain(`${ORIGIN}/claim?t=`);
			expect(minted).toContain('Anna & Tom');
			/* The standing disclosure travels with the link, so handing it over is
			   the default rather than a thing to remember (ADR-0020). */
			expect(minted).toContain(DISCLOSURE);

			const db = vol.db();
			const secret = loadSecret(`${vol.dir}/secret.key`);
			const result = claim(db, secret, {
				token: tokenIn(minted),
				deviceId: 'their-phone',
				zone: 'Europe/Istanbul',
				displayName: 'Anna',
				now: Date.now()
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.householdId).not.toBe('h1');
			expect(getHousehold(db, result.householdId)).toMatchObject({
				name: 'Anna & Tom',
				zone: 'Europe/Istanbul'
			});
			expect(listMembers(db, result.householdId)).toMatchObject([{ display_name: 'Anna', role: 'parent' }]);
			/* Household #1 is untouched. */
			expect(listMembers(db, 'h1').map((m) => m.display_name)).toEqual(['Mama']);
			db.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('creates no rows besides the link, and never burns an earlier one', () => {
		const vol = volume();
		try {
			const first = run(vol.env, 'household', 'Anna & Tom');
			const second = run(vol.env, 'household', 'Bea & Ben');
			const db = vol.db();
			expect((db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number }).n).toBe(0);
			const links = db
				.prepare("SELECT household_label, claimed_at, burnt_at FROM claim_links WHERE kind = 'bootstrap'")
				.all() as Array<{ household_label: string; claimed_at: number | null; burnt_at: number | null }>;
			expect(links.map((l) => l.household_label).sort()).toEqual(['Anna & Tom', 'Bea & Ben']);
			expect(links.every((l) => l.claimed_at == null && l.burnt_at == null)).toBe(true);
			expect(tokenIn(first)).not.toBe(tokenIn(second));
			db.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('fails loudly with no label and with no ORIGIN', () => {
		const vol = volume();
		try {
			expect(() =>
				execFileSync('node', ['bin/babylog.js', 'household'], {
					env: vol.env,
					encoding: 'utf8',
					stdio: 'pipe'
				})
			).toThrow();
			expect(() =>
				execFileSync('node', ['bin/babylog.js', 'household', 'Anna & Tom'], {
					env: { ...vol.env, ORIGIN: '' },
					encoding: 'utf8',
					stdio: 'pipe'
				})
			).toThrow();
			const db = vol.db();
			expect((db.prepare('SELECT COUNT(*) AS n FROM claim_links').get() as { n: number }).n).toBe(0);
			db.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});
});

describe('babylog households', () => {
	it('answers the pilot question: who is here, how big, and last active when', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [
				['a-mum', 'Mama', 'parent'],
				['a-oma', 'Oma', 'caregiver']
			]);
			seedHousehold(db, 'h2', '', [['b-mum', 'Beatriz', 'parent']]);
			db.prepare('UPDATE members SET removed_at = 1 WHERE id = ?').run('a-oma');
			db.prepare(
				`INSERT INTO revisions (id, household_id, kind, entity_id, fields, merge_at, device_id, author_id, received_at)
				 VALUES (?,?,?,?,?,?,?,?,?)`
			).run('r1', 'h1', 'entry', 'e1', '{}', 1, 'd', 'a-mum', Date.parse('2026-08-20T09:30:00Z'));
			db.close();

			const listed = run(vol.env, 'households');
			expect(listed).toContain('Anna & Tom');
			/* Active members only: Oma has been removed. */
			expect(listed).toContain('1 member(s) · last activity 2026-08-20 09:30 UTC');
			expect(listed).toContain('(unnamed)');
			expect(listed).toContain('1 member(s) · last activity never');
			expect(listed).toContain('id h2');
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});
});

describe('babylog members, hosting more than one Household', () => {
	it('lists each Member under their own Household', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Beatriz', 'parent']]);
			db.close();

			const listed = run(vol.env, 'members');
			expect(listed.indexOf('Anna & Tom')).toBeLessThan(listed.indexOf('Mama'));
			expect(listed.indexOf('Mama')).toBeLessThan(listed.indexOf('Bea & Ben'));
			expect(listed.indexOf('Bea & Ben')).toBeLessThan(listed.indexOf('Beatriz'));
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});
});

describe('babylog rescue, hosting more than one Household', () => {
	it('needs the Household named, and lists them when it is missing', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Mama', 'parent']]);
			db.close();

			let stderr = '';
			try {
				execFileSync('node', ['bin/babylog.js', 'rescue', 'Mama'], {
					env: vol.env,
					encoding: 'utf8',
					stdio: 'pipe'
				});
				throw new Error('should have failed');
			} catch (error) {
				stderr = String((error as { stderr?: string }).stderr ?? '');
			}
			expect(stderr).toContain('Anna & Tom');
			expect(stderr).toContain('Bea & Ben');
			expect(vol.db().prepare("SELECT COUNT(*) AS n FROM claim_links").get()).toEqual({ n: 0 });
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('mints inside the named Household, so a shared name is not ambiguous', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Mama', 'parent']]);
			db.close();

			const minted = run(vol.env, 'rescue', 'Bea & Ben', 'Mama');
			const reopened = vol.db();
			const secret = loadSecret(`${vol.dir}/secret.key`);
			expect(
				reopened
					.prepare('SELECT kind, household_id, member_id FROM claim_links WHERE token_hash = ?')
					.get(tokenHash(tokenIn(minted), secret))
			).toEqual({ kind: 'rescue', household_id: 'h2', member_id: 'b-mum' });
			reopened.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('refuses a Household nobody is called', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Mama', 'parent']]);
			db.close();
			expect(() =>
				execFileSync('node', ['bin/babylog.js', 'rescue', 'Nobody', 'Mama'], {
					env: vol.env,
					encoding: 'utf8',
					stdio: 'pipe'
				})
			).toThrow();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});
});
