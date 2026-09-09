/* The one piece of knowledge `bin/babylog.js` duplicates rather than imports:
   how a token is stored. The CLI has to run from a shell against a possibly
   stopped container, so it depends on nothing but better-sqlite3 and the two
   files in the volume — and this test is what keeps that duplication honest. */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	BOOTSTRAP_TTL_MS,
	DISCLOSURE,
	hashToken,
	RESCUE_TTL_MS,
	UNSWEPT_TABLES
} from '../../../bin/babylog.js';
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
			/* The same string lands in both names: the family's, which they may
			   change from Settings, and the operator's, which they cannot reach. */
			expect(db.prepare('SELECT label FROM households WHERE id = ?').get(result.householdId)).toEqual({
				label: 'Anna & Tom'
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

describe('babylog label', () => {
	it('names a Household for the operator without touching the name the family chose', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Beatriz', 'parent']]);
			db.close();

			const said = run(vol.env, 'label', 'Anna & Tom', 'The Hansens');
			expect(said).toContain('The Hansens');

			const after = vol.db();
			expect(after.prepare('SELECT name, label FROM households WHERE id = ?').get('h1')).toEqual({
				name: 'Anna & Tom',
				label: 'The Hansens'
			});
			/* Household #2 is untouched. */
			expect(after.prepare('SELECT label FROM households WHERE id = ?').get('h2')).toEqual({ label: '' });
			after.close();

			/* The listing leads with the operator's name and still prints the
			   family's, so a mail quoting either one resolves. */
			const listed = run(vol.env, 'households');
			expect(listed.indexOf('The Hansens')).toBeLessThan(listed.indexOf('the family calls it “Anna & Tom”'));

			/* And both keep working as the argument that scopes a rescue. */
			expect(run(vol.env, 'rescue', 'The Hansens', 'Mama')).toContain(`${ORIGIN}/claim?t=`);
			expect(run(vol.env, 'rescue', 'Anna & Tom', 'Mama')).toContain(`${ORIGIN}/claim?t=`);
			expect(run(vol.env, 'rescue', 'h1', 'Mama')).toContain(`${ORIGIN}/claim?t=`);
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('names the one Household in the file from a single argument — including the unnamed one', () => {
		const vol = volume();
		try {
			const db = vol.db();
			/* Founded by the setup link, which carries no label: there is no name to
			   type, so the id would be the only handle without this shortcut. */
			seedHousehold(db, 'h1', '', [['a-mum', 'Mama', 'parent']]);
			db.close();

			run(vol.env, 'label', 'The Hansens');

			const after = vol.db();
			expect(after.prepare('SELECT name, label FROM households WHERE id = ?').get('h1')).toEqual({
				name: '',
				label: 'The Hansens'
			});
			after.close();
			expect(run(vol.env, 'households')).toContain('The Hansens');
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('refuses to guess between two Households of the same name, and changes nothing', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Anna & Tom', [['b-mum', 'Beatriz', 'parent']]);
			db.close();

			let stderr = '';
			try {
				execFileSync('node', ['bin/babylog.js', 'label', 'Anna & Tom', 'The Hansens'], {
					env: vol.env,
					encoding: 'utf8',
					stdio: 'pipe'
				});
				throw new Error('should have failed');
			} catch (error) {
				stderr = String((error as { stderr?: string }).stderr ?? '');
			}
			expect(stderr).toContain('h1');
			expect(stderr).toContain('h2');

			const after = vol.db();
			expect(
				(after.prepare("SELECT COUNT(*) AS n FROM households WHERE label <> ''").get() as { n: number }).n
			).toBe(0);
			after.close();

			/* The id is the way through, exactly as the message says. */
			run(vol.env, 'label', 'h2', 'The Hansens');
			const settled = vol.db();
			expect(settled.prepare('SELECT label FROM households WHERE id = ?').get('h2')).toEqual({
				label: 'The Hansens'
			});
			settled.close();
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

	it('says which rows are Hubs, so removing one is not mistaken for removing Oma', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [
				['a-mum', 'Mama', 'parent'],
				['a-hub', 'Home Assistant', 'caregiver']
			]);
			db.prepare('UPDATE members SET kind = ? WHERE id = ?').run('hub', 'a-hub');
			db.close();

			const listed = run(vol.env, 'members');
			expect(listed).toContain('Hub · caregiver');
			/* And a person's row says nothing extra. */
			expect(listed).toMatch(/Mama\n\s+parent ·/);
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

describe('babylog delete', () => {
	/** One row in every table a Household owns, so "everything it ever logged"
	    can be asserted rather than assumed. */
	function seedData(db: Db, householdId: string, memberId: string, tag: string) {
		db.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)').run(
			`baby-${tag}`,
			householdId,
			'Nele',
			'2026-01-01'
		);
		db.prepare('INSERT INTO foods (id, household_id, name) VALUES (?,?,?)').run(
			`food-${tag}`,
			householdId,
			'Karotte'
		);
		db.prepare(
			'INSERT INTO targets (id, household_id, baby_id, activity, duration_s, anchor) VALUES (?,?,?,?,?,?)'
		).run(`target-${tag}`, householdId, `baby-${tag}`, 'feed', 10800, 'start');
		db.prepare(
			`INSERT INTO entries (id, household_id, baby_id, type, occurred_at, payload, logged_by)
			 VALUES (?,?,?,?,?,?,?)`
		).run(`entry-${tag}`, householdId, `baby-${tag}`, 'feed', 1, '{}', memberId);
		db.prepare(
			`INSERT INTO revisions (id, household_id, kind, entity_id, fields, merge_at, device_id, author_id, received_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`
		).run(`rev-${tag}`, householdId, 'entry', `entry-${tag}`, '{}', 1, 'device', memberId, 1);
		db.prepare(
			'INSERT INTO sessions (token_hash, member_id, device_id, created_at, last_seen_at) VALUES (?,?,?,?,?)'
		).run(`session-${tag}`, memberId, 'device', 1, 1);
		db.prepare(
			`INSERT INTO claim_links (token_hash, kind, household_id, member_id, created_at, expires_at)
			 VALUES (?,?,?,?,?,?)`
		).run(`link-${tag}`, 'rescue', householdId, memberId, 1, 2);
		db.prepare(
			`INSERT INTO push_subscriptions (endpoint, household_id, member_id, device_id, p256dh, auth, created_at)
			 VALUES (?,?,?,?,?,?,?)`
		).run(`https://push.example.com/${tag}`, householdId, memberId, 'device', 'p', 'a', 1);
		/* Reached through the subscription rather than by a household_id of its
		   own, which is why the erasure names it and this seeds it. */
		db.prepare("INSERT INTO push_sent (entry_id, kind, endpoint, sent_at) VALUES (?,'bottle',?,?)").run(
			`entry-${tag}`,
			`https://push.example.com/${tag}`,
			1
		);
	}

	const attempt = (env: NodeJS.ProcessEnv, answer: string, ...args: string[]) =>
		execFileSync('node', ['bin/babylog.js', ...args], {
			env,
			encoding: 'utf8',
			input: answer,
			stdio: ['pipe', 'pipe', 'pipe']
		});

	const stderrOf = (run: () => string) => {
		try {
			run();
			throw new Error('should have failed');
		} catch (error) {
			return String((error as { stderr?: string }).stderr ?? '');
		}
	};

	/** Every row still keyed to this Household, table by table. */
	const leftBehind = (db: Db, householdId: string) =>
		tablesWithHousehold(db)
			.map((table) => [
				table,
				(
					db
						.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE household_id = ?`)
						.get(householdId) as { n: number }
				).n
			])
			.filter(([, n]) => (n as number) > 0);

	const tablesWithHousehold = (db: Db) =>
		(
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
				.all() as Array<{ name: string }>
		)
			.map((t) => t.name)
			.filter((name) =>
				(db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some(
					(column) => column.name === 'household_id'
				)
			);

	it('deletes everything one Household owns, and nothing of the other', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Beatriz', 'parent']]);
			seedData(db, 'h1', 'a-mum', 'a');
			seedData(db, 'h2', 'b-mum', 'b');
			db.close();

			const said = attempt(vol.env, 'h1\n', 'delete', 'Anna & Tom');
			expect(said).toContain('Deleted Anna & Tom');

			const after = vol.db();
			/* Every household-keyed table, asked of the schema rather than listed,
			   so a table added later is covered here too. */
			expect(leftBehind(after, 'h1')).toEqual([]);
			expect(after.prepare('SELECT id FROM households WHERE id = ?').get('h1')).toBeUndefined();
			/* The two tables that reach a Household through its Members. */
			expect(after.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
			expect(after.prepare('SELECT COUNT(*) AS n FROM claim_links').get()).toEqual({ n: 1 });
			expect(after.prepare('SELECT member_id FROM sessions').get()).toEqual({ member_id: 'b-mum' });
			expect(after.prepare('SELECT member_id FROM claim_links').get()).toEqual({ member_id: 'b-mum' });
			/* What was pushed to those Devices goes with them — it hangs off the
			   subscriptions, not off a household_id the sweep could find. */
			expect(after.prepare('SELECT COUNT(*) AS n FROM push_sent').get()).toEqual({ n: 1 });
			expect(after.prepare('SELECT endpoint FROM push_sent').get()).toEqual({
				endpoint: 'https://push.example.com/b'
			});

			/* Household #2 still has one of everything. */
			for (const table of tablesWithHousehold(after)) {
				expect([
					table,
					(after.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE household_id = ?`).get('h2') as {
						n: number;
					}).n
				]).toEqual([table, 1]);
			}
			expect(after.prepare('SELECT name FROM households WHERE id = ?').get('h2')).toEqual({
				name: 'Bea & Ben'
			});
			after.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('names what it is about to destroy before it asks', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Familie Hansen', [
				['a-mum', 'Mama', 'parent'],
				['a-oma', 'Oma', 'caregiver']
			]);
			db.prepare('UPDATE households SET label = ? WHERE id = ?').run('The Hansens', 'h1');
			seedData(db, 'h1', 'a-mum', 'a');
			db.close();

			const said = attempt(vol.env, 'h1\n', 'delete', 'The Hansens');
			/* Both names, so an operator who resolved the wrong Household sees it
			   here rather than afterwards. */
			expect(said).toContain('About to delete The Hansens');
			expect(said).toContain('the family calls it “Familie Hansen”');
			expect(said).toContain('2 members · 1 baby · 1 entry · 1 device');
			expect(said).toContain('id h1');
			/* And the way out that costs nothing. */
			expect(said).toContain('export it from Settings first');
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('deletes nothing when the id is not typed back', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedData(db, 'h1', 'a-mum', 'a');
			db.close();

			/* A yes is the answer to a question you have stopped reading. */
			expect(stderrOf(() => attempt(vol.env, 'yes\n', 'delete', 'Anna & Tom'))).toContain(
				'nothing was deleted'
			);
			/* The name is not the id: it is the part that was ambiguous. */
			expect(stderrOf(() => attempt(vol.env, 'Anna & Tom\n', 'delete', 'Anna & Tom'))).toContain(
				'nothing was deleted'
			);

			const after = vol.db();
			expect(after.prepare('SELECT COUNT(*) AS n FROM entries').get()).toEqual({ n: 1 });
			expect(after.prepare('SELECT id FROM households WHERE id = ?').get('h1')).toEqual({ id: 'h1' });
			after.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('hands over the command that works when there is no terminal to answer on', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			db.close();

			/* `docker exec` without -it, from in here: the prompt was printed into a
			   shell with nothing attached to answer it. A dead end is not an answer,
			   so the failure carries the form that needs no terminal. */
			const stderr = stderrOf(() => attempt(vol.env, '', 'delete', 'Anna & Tom'));
			expect(stderr).toContain('no terminal here to answer on');
			expect(stderr).toContain('babylog delete "Anna & Tom" h1');
			expect(stderr).toContain('docker exec -it');

			const after = vol.db();
			expect(after.prepare('SELECT id FROM households WHERE id = ?').get('h1')).toEqual({ id: 'h1' });
			after.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('takes the id as the last argument, for the shell that cannot be asked', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Beatriz', 'parent']]);
			seedData(db, 'h1', 'a-mum', 'a');
			seedData(db, 'h2', 'b-mum', 'b');
			db.close();

			/* No stdin at all, exactly as `docker exec` without -it. */
			const said = attempt(vol.env, '', 'delete', 'Anna & Tom', 'h1');
			/* Still shows what it destroyed before it did it. */
			expect(said).toContain('About to delete Anna & Tom');
			expect(said).toContain('Deleted Anna & Tom');

			const after = vol.db();
			expect(leftBehind(after, 'h1')).toEqual([]);
			expect(after.prepare('SELECT COUNT(*) AS n FROM entries WHERE household_id = ?').get('h2')).toEqual({
				n: 1
			});
			after.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it("deletes nothing when the id passed is another household's, or no id at all", () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Bea & Ben', [['b-mum', 'Beatriz', 'parent']]);
			db.close();

			expect(stderrOf(() => attempt(vol.env, '', 'delete', 'Anna & Tom', 'h2'))).toContain(
				'not the id of Anna & Tom'
			);
			expect(stderrOf(() => attempt(vol.env, '', 'delete', 'Anna & Tom', 'yes'))).toContain(
				'nothing was deleted'
			);

			const after = vol.db();
			expect(after.prepare('SELECT COUNT(*) AS n FROM households').get()).toEqual({ n: 2 });
			after.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('reads a bare id as the household to delete, never as an answer', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			db.close();

			/* `babylog delete h1` names the Household; the answer is still owed. */
			const stderr = stderrOf(() => attempt(vol.env, '', 'delete', 'h1'));
			expect(stderr).toContain('babylog delete "Anna & Tom" h1');

			const after = vol.db();
			expect(after.prepare('SELECT COUNT(*) AS n FROM households').get()).toEqual({ n: 1 });
			after.close();

			/* And typed at the prompt it goes, as it always did. */
			expect(attempt(vol.env, 'h1\n', 'delete', 'h1')).toContain('Deleted Anna & Tom');
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('refuses to guess between two Households of the same name', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			seedHousehold(db, 'h2', 'Anna & Tom', [['b-mum', 'Beatriz', 'parent']]);
			db.close();

			const stderr = stderrOf(() => attempt(vol.env, 'h1\n', 'delete', 'Anna & Tom'));
			expect(stderr).toContain('h1');
			expect(stderr).toContain('h2');

			const after = vol.db();
			expect(after.prepare('SELECT COUNT(*) AS n FROM households').get()).toEqual({ n: 2 });
			after.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	it('tells the operator when that was the last Household on the box', () => {
		const vol = volume();
		try {
			const db = vol.db();
			seedHousehold(db, 'h1', 'Anna & Tom', [['a-mum', 'Mama', 'parent']]);
			db.close();
			expect(attempt(vol.env, 'h1\n', 'delete', 'Anna & Tom')).toContain(
				'That was the last household here'
			);
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});

	/* The sweep finds its tables by asking the schema for a household_id column.
	   This is what makes that safe as the schema grows: a table added later is
	   either swept by construction, or named as a deliberate exception — never
	   silently left holding a deleted family's rows. */
	it('leaves no table unaccounted for', () => {
		const vol = volume();
		try {
			const db = vol.db();
			const tables = (
				db
					.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
					.all() as Array<{ name: string }>
			).map((t) => t.name);
			const swept = new Set(tablesWithHousehold(db));
			expect(tables.filter((t) => !swept.has(t) && !(t in UNSWEPT_TABLES))).toEqual([]);
			/* And the exceptions are all real tables, so the list cannot rot. */
			expect(Object.keys(UNSWEPT_TABLES).filter((t) => !tables.includes(t))).toEqual([]);
			db.close();
		} finally {
			rmSync(vol.dir, { recursive: true, force: true });
		}
	});
});
