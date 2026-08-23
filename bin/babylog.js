#!/usr/bin/env node
/* The operator's entrypoint. Spec §4.4 and §6.1.

   A second entrypoint in the same image:

       docker exec <container> babylog members
       docker exec <container> babylog rescue "Mama"
       docker exec -it <container> babylog delete "Anna & Tom"
       docker exec -e ORIGIN=... <container> babylog household "Anna & Tom"

   One deployment may host several Households (ADR-0020), so everything here
   either names one or says which it means: `households` lists them, `members`
   groups by them, `rescue` searches inside one, `household` mints the Founding
   Link that creates the next, `label` fixes what this tool calls one, and
   `delete` ends one — the only command that destroys anything, and the only one
   that asks before it acts.

   That label is the operator's, not the family's. Parents rename their own
   Household from Settings and that rename syncs to their Devices; it must not
   move the name an operator has in a runbook, so the two are separate columns
   and every command here accepts the id, the label or the family's name.

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
import { readFileSync, readSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR && process.env.DATA_DIR !== '' ? process.env.DATA_DIR : '/data';
const DB_PATH = `${DATA_DIR}/app.db`;
const SECRET_PATH = `${DATA_DIR}/secret.key`;
/** Fifteen minutes, because you are standing at the terminal. */
export const RESCUE_TTL_MS = 15 * 60_000;
/** Seven days: a Founding Link is sent over WhatsApp and opened whenever the
    family gets round to it. */
export const BOOTSTRAP_TTL_MS = 7 * 24 * 60 * 60_000;

/** What the operator sends along with a Founding Link. The pilot answers the
    trust boundary with disclosure, not encryption: whoever receives the link is
    told plainly that the operator can read everything they log (ADR-0020). */
export const DISCLOSURE =
	'It runs on my server, so technically I can see everything you log — ' +
	'same trust as sending it to me directly.';

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

/**
 * @param {number | null} at
 * @returns {string}
 */
function utcStamp(at) {
	return at ? `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'never';
}

/** The label to print for a Household that was never named. */
const UNNAMED = '(unnamed)';

/** What the operator calls this Household: their own label, and only if they
 * never set one, whatever the family named itself.
 *
 * @param {{id: string, name: string, label: string}} household
 */
const called = (household) => household.label || household.name || UNNAMED;

/** Matches on the id, the operator's label or the family's name — all three,
 * because a support mail quotes whichever one its writer happens to know.
 *
 * @param {Array<{id: string, name: string, label: string}>} all
 * @param {string} wanted
 */
function matching(all, wanted) {
	const needle = wanted.trim().toLowerCase();
	const same = (/** @type {string} */ value) => value !== '' && value.toLowerCase() === needle;
	return all.filter((h) => h.id === wanted.trim() || same(h.label) || same(h.name));
}

/** @param {Array<{id: string, name: string, label: string}>} all */
const listing = (all) => all.map((h) => `  ${called(h)}`).join('\n');

/** @param {import('better-sqlite3').Database} db */
function allHouseholds(db) {
	return /** @type {Array<{id: string, name: string, label: string, members: number, last_activity: number | null}>} */ (db
		.prepare(
			`SELECT h.id, h.name, h.label,
			        (SELECT COUNT(*) FROM members m
			          WHERE m.household_id = h.id AND m.removed_at IS NULL) AS members,
			        (SELECT MAX(r.received_at) FROM revisions r WHERE r.household_id = h.id) AS last_activity
			 FROM households h ORDER BY h.label, h.name, h.id`
		)
		.all());
}

/** Is anyone actually using this — the pilot question, in one screen.
 *
 * @param {import('better-sqlite3').Database} db
 */
function households(db) {
	const rows = allHouseholds(db);
	if (rows.length === 0) {
		console.log('No households yet. Start the container and read its log for the setup link.');
		return;
	}

	console.log('');
	for (const row of rows) {
		console.log(`  ${called(row)}`);
		/* Parents may rename their Household from Settings, and then the name in a
		   mail from them is not the one below. Both are printed so either resolves. */
		if (row.name !== row.label) console.log(`      the family calls it “${row.name || UNNAMED}”`);
		console.log(`      ${row.members} member(s) · last activity ${utcStamp(row.last_activity)}`);
		console.log(`      id ${row.id}`);
	}
	console.log('');
}

/**
 * Mints a Founding Link for a new Household — the `babylog household` command.
 * It creates no rows besides the link: the Household appears when somebody
 * claims it, taking its Zone from the claiming Device, so the operator
 * configures nothing about the family's rhythm. An unclaimed link expires
 * leaving no orphan.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} label
 */
function mintFoundingLink(db, label) {
	const name = label.trim();
	if (name === '') fail('What is it called? Try: babylog household "Anna & Tom"');
	if (name.length > 200) fail('That name is too long — 200 characters at most.');

	const key = secret();
	const token = randomBytes(16).toString('base64url');
	const now = Date.now();
	const expires = now + BOOTSTRAP_TTL_MS;
	const url = `${origin()}/claim?t=${token}`;

	db.prepare(
		`INSERT INTO claim_links (token_hash, kind, household_label, created_at, expires_at)
		 VALUES (?, 'bootstrap', ?, ?, ?)`
	).run(hashToken(token, key), name, now, expires);

	console.log('');
	console.log(`This link sets up a new household called “${name}”.`);
	console.log('Whoever opens it becomes its first parent, and the link stops');
	console.log('working once it has been used.');
	console.log('');
	console.log(`    ${url}`);
	console.log('');
	console.log(`It expires on ${utcStamp(expires)}. Run this command again for a fresh one;`);
	console.log('links already sent keep working.');
	console.log('');
	console.log('Send this sentence along with the link:');
	console.log('');
	console.log(`    ${DISCLOSURE}`);
	console.log('');
}

/**
 * Sets the operator's label — the `babylog label` command. It renames nothing
 * the family can see: `households.name` is theirs, changeable from Settings and
 * synced to every Device, while this column never leaves the server. Founding a
 * Household seeds both from the same string; this is how they come apart, and
 * how a Household founded from the plain setup link — which carries no label at
 * all — gets one.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} argv
 */
function relabel(db, argv) {
	const all = allHouseholds(db);
	if (all.length === 0) fail('There are no households yet.');

	/* With one Household in the file a single argument can only be the new label,
	   which is also the shape that reaches the unnamed one founded by the setup
	   link: it has no name to type. With several, both arguments are required. */
	const [household, wanted] =
		all.length === 1 && argv.length === 1
			? [all[0], argv[0]]
			: [resolve(all, argv[0] ?? ''), argv.slice(1).join(' ')];

	const label = wanted.trim();
	if (label === '') fail(`What should it be called? Try: babylog label "${called(household)}" "Anna & Tom"`);
	if (label.length > 200) fail('That name is too long — 200 characters at most.');

	db.prepare('UPDATE households SET label = ? WHERE id = ?').run(label, household.id);

	console.log('');
	console.log(`  ${called(household)} → ${label}`);
	console.log(`      id ${household.id}`);
	console.log('');
	console.log('That is this tool\'s name for them. The family keeps the name they');
	console.log(`chose in Settings${household.name === '' ? ' — they have not chosen one yet' : `, “${household.name}”`}, and nobody there sees this one.`);
	console.log('');
}

/** @param {import('better-sqlite3').Database} db */
function members(db) {
	const rows = /** @type {Array<{id: string, household_id: string, display_name: string, role: string, removed_at: number | null, devices: number, last_seen: number | null}>} */ (db
		.prepare(
			`SELECT m.id, m.household_id, m.display_name, m.role, m.removed_at,
			        (SELECT COUNT(*) FROM sessions s WHERE s.member_id = m.id AND s.revoked_at IS NULL) AS devices,
			        (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.member_id = m.id) AS last_seen
			 FROM members m ORDER BY m.display_name`
		)
		.all());

	if (rows.length === 0) {
		console.log('No one has access yet. Start the container and read its log for the setup link.');
		return;
	}

	/* Grouped, because a flat list across households says nothing about who is
	   whose (ADR-0020). */
	console.log('');
	for (const group of allHouseholds(db)) {
		const mine = rows.filter((row) => row.household_id === group.id);
		if (mine.length === 0) continue;
		console.log(`  ${called(group)}`);
		for (const row of mine) {
			const state = row.removed_at ? 'removed' : row.role;
			console.log(`      ${row.display_name}`);
			console.log(`          ${state} · ${row.devices} device(s) · last seen ${utcStamp(row.last_seen)}`);
			console.log(`          id ${row.id}`);
		}
		console.log('');
	}
}

/**
 * The one Household an argument names, or a loud failure. Two Households may
 * share a name — nothing stops a family renaming itself into a collision — so an
 * ambiguous argument is answered with the ids rather than with a guess.
 *
 * @param {Array<{id: string, name: string, label: string}>} all
 * @param {string} wanted
 */
function resolve(all, wanted) {
	const matches = matching(all, wanted);
	if (matches.length === 0) {
		fail(`No household here is called “${wanted.trim()}”. The households are:\n` + listing(all));
	}
	if (matches.length > 1) {
		fail(
			`More than one household is called “${wanted.trim()}”. Use the id instead:\n` +
				matches.map((h) => `  ${h.id}  ${called(h)}`).join('\n')
		);
	}
	return matches[0];
}

/**
 * The Household a rescue runs inside. With one in the file it is that one, so
 * `babylog rescue "Mama"` keeps working; with more, the operator names it and
 * omitting it fails loudly rather than guessing.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} argv
 * @returns {{household: {id: string, name: string, label: string}, needle: string}}
 */
function scopeRescue(db, argv) {
	const all = allHouseholds(db);
	if (all.length === 0) fail('There are no households yet.');

	if (all.length === 1) {
		const needle = argv.join(' ').trim();
		if (needle === '') fail('Who for? Try: babylog rescue "Mama"');
		return { household: all[0], needle };
	}

	if (argv.length < 2) {
		fail(
			`This deployment hosts ${all.length} households, so say which one:\n` +
				'  babylog rescue "Anna & Tom" "Mama"\n' +
				listing(all)
		);
	}

	const household = resolve(all, argv[0]);
	const needle = argv.slice(1).join(' ').trim();
	if (needle === '') fail(`Who for? Try: babylog rescue "${called(household)}" "Mama"`);
	return { household, needle };
}

/**
 * Re-binds a Device to a Member who already exists. It does NOT create a new
 * person: a new row would leave two "Mamas" and split three years of
 * attribution between them, since every Revision points at the old one.
 *
 * The search space is one Household, so a name that two Households share is not
 * ambiguous here — it cannot be, by construction.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{id: string, name: string}} inHousehold
 * @param {string} needle
 */
function rescue(db, inHousehold, needle) {
	const rows = /** @type {Array<{id: string, household_id: string, display_name: string, role: string, removed_at: number | null}>} */ (db
		.prepare(
			`SELECT id, household_id, display_name, role, removed_at FROM members
			 WHERE household_id = ? AND removed_at IS NULL
			   AND (id = ? OR display_name = ? COLLATE NOCASE)`
		)
		.all(inHousehold.id, needle, needle));

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

/** The tables the sweep below cannot find by itself, and why each one is safe
 * to leave out of it. Exported because a test walks the migrated schema and
 * insists every table is either keyed by `household_id` — and therefore swept —
 * or named here: the day a table is added, that test is what makes deleting a
 * Household a decision rather than an oversight.
 */
export const UNSWEPT_TABLES = {
	households: 'the row being deleted',
	sessions: 'reached through its Member',
	claim_links: 'reached through the Household or its Members',
	_migrations: "the deployment's, not any Household's",
	push_sent: "reached through the Household's push subscriptions"
};

/** Every table the schema keys by Household, asked of the file rather than
 * listed here, so a table added later is swept by construction.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]}
 */
function householdScopedTables(db) {
	const tables = /** @type {Array<{name: string}>} */ (db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
		.all());
	return tables
		.map((table) => table.name)
		.filter((name) =>
			/** @type {Array<{name: string}>} */ (db.prepare(`PRAGMA table_info("${name}")`).all()).some(
				(column) => column.name === 'household_id'
			)
		);
}

/** What is about to be destroyed, in the shape the operator has to recognise
 * before they can answer the prompt.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
function inventory(db, id) {
	const count = (/** @type {string} */ sql) =>
		/** @type {{n: number}} */ (db.prepare(sql).get(id)).n;
	return {
		members: count('SELECT COUNT(*) AS n FROM members WHERE household_id = ? AND removed_at IS NULL'),
		babies: count('SELECT COUNT(*) AS n FROM babies WHERE household_id = ? AND deleted_at IS NULL'),
		entries: count('SELECT COUNT(*) AS n FROM entries WHERE household_id = ?'),
		devices: count(
			`SELECT COUNT(*) AS n FROM sessions
			  WHERE revoked_at IS NULL AND member_id IN (SELECT id FROM members WHERE household_id = ?)`
		),
		lastActivity: /** @type {{at: number | null}} */ (db
			.prepare('SELECT MAX(received_at) AS at FROM revisions WHERE household_id = ?')
			.get(id)).at
	};
}

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Deletes every row the Household owns, in one transaction: it either all goes
 * or none of it does, because a half-deleted Household is a support case nobody
 * can read their way out of.
 *
 * The revision log goes with it. Append-only (ADR-0002) is what makes a
 * correction recoverable *inside* a living Household; it is not a reason to keep
 * a deleted family's Entries on the disk. Nothing here is a tombstone — a
 * tombstone hides a row from an app that still has to render it, and after this
 * there is no app left to render anything.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {Record<string, number>}
 */
function erase(db, id) {
	const swept = householdScopedTables(db);
	/** @type {Record<string, number>} */
	const removed = {};

	db.transaction(() => {
		/* Both of these hang off Members, so they go before the Members do. */
		removed.sessions = db
			.prepare('DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE household_id = ?)')
			.run(id).changes;
		removed.claim_links = db
			.prepare(
				`DELETE FROM claim_links
				  WHERE household_id = ?
				     OR member_id IN (SELECT id FROM members WHERE household_id = ?)`
			)
			.run(id, id).changes;
		/* The push subscriptions hang off Members too, and what was said to them
		   hangs off the subscriptions — so both go here, ahead of the sweep. */
		removed.push_sent = db
			.prepare(
				`DELETE FROM push_sent
				  WHERE endpoint IN (SELECT endpoint FROM push_subscriptions WHERE household_id = ?)`
			)
			.run(id).changes;
		removed.push_subscriptions = db
			.prepare('DELETE FROM push_subscriptions WHERE household_id = ?')
			.run(id).changes;
		for (const table of swept) {
			/* Added to, never overwritten: a table the steps above already emptied
			   for a reason of its own must keep the count it reported. */
			const gone = db.prepare(`DELETE FROM "${table}" WHERE household_id = ?`).run(id).changes;
			removed[table] = (removed[table] ?? 0) + gone;
		}
		removed.households = db.prepare('DELETE FROM households WHERE id = ?').run(id).changes;
	})();

	return removed;
}

/** Table names as an operator says them. A table added later and not named here
 * prints as itself, so the report is never wrong — only less fluent.
 *
 * @type {Record<string, [string, string]>}
 */
const AS_SPOKEN = {
	entries: ['entry', 'entries'],
	revisions: ['revision', 'revisions'],
	members: ['member', 'members'],
	babies: ['baby', 'babies'],
	foods: ['food', 'foods'],
	targets: ['target', 'targets'],
	sessions: ['device', 'devices'],
	claim_links: ['link', 'links'],
	push_subscriptions: ['notification subscription', 'notification subscriptions'],
	push_sent: ['sent notification', 'sent notifications']
};

/** One line from stdin, read without the stream API — everything here is
 * synchronous, and `docker exec -it` hands us a blocking descriptor. An empty
 * string means there was nothing to read at all, which is exactly what
 * `docker exec` without `-it` looks like from in here.
 *
 * @returns {string}
 */
function readLine() {
	const byte = Buffer.alloc(1);
	/** @type {number[]} */
	const line = [];
	for (;;) {
		let read = 0;
		try {
			read = readSync(0, byte, 0, 1, null);
		} catch (error) {
			const code = /** @type {{code?: string}} */ (error).code;
			/* A terminal with nothing typed yet, on the platforms that report it
			   this way. Wait a moment rather than spinning the CPU at the prompt. */
			if (code === 'EAGAIN') {
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
				continue;
			}
			if (code === 'EOF') break;
			throw error;
		}
		if (read === 0) break;
		if (byte[0] === 0x0a) break;
		line.push(byte[0]);
	}
	return Buffer.from(line).toString('utf8').trim();
}

/**
 * Deletes a Household — the `babylog delete` command, and the only thing in this
 * tool that destroys anything. It is how an erasure request is answered and how
 * a family that has left stops being hosted.
 *
 * Two things stand between a typo and a deleted family. First the inventory:
 * the Household is named, in both names, with what it holds — an operator who
 * resolved the wrong one sees it here, before anything happens. Then its id,
 * given back. The id rather than a yes, because "yes" is the answer to a
 * question you have stopped reading, and rather than the name, because the name
 * is what was ambiguous in the first place.
 *
 * The id is typed at a prompt, or passed as the last argument. Two forms rather
 * than one because `docker exec` without `-it` has no terminal to answer on, and
 * an operator standing in front of a prompt that cannot be answered is not being
 * protected — they are being sent to look for a flag. The argument form asks the
 * same thing the prompt does, and the first run is what prints it: nothing is
 * deleted by a command that has not already shown what it would destroy.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} argv
 */
function deleteHousehold(db, argv) {
	const all = allHouseholds(db);
	if (all.length === 0) fail('There are no households yet.');

	const args = argv.map((arg) => arg.trim()).filter((arg) => arg !== '');
	if (args.length === 0) fail('Which one? Try: babylog delete "Anna & Tom"');

	/* The id may be given as the last argument instead of typed at the prompt —
	   the same answer to the same question, for the shell that has no terminal to
	   ask on. It is the last argument only when the ones before it already name a
	   Household, so `babylog delete <id>` still means the Household with that id
	   rather than an answer with nothing to answer. */
	const head = args.slice(0, -1).join(' ');
	const given = args.length > 1 && matching(all, head).length > 0 ? args[args.length - 1] : null;

	const household = resolve(all, given === null ? args.join(' ') : head);
	const holds = inventory(db, household.id);

	console.log('');
	console.log(`  About to delete ${called(household)}`);
	if (household.name !== household.label) {
		console.log(`      the family calls it “${household.name || UNNAMED}”`);
	}
	console.log(
		`      ${plural(holds.members, 'member', 'members')} · ${plural(holds.babies, 'baby', 'babies')} · ` +
			`${plural(holds.entries, 'entry', 'entries')} · ${plural(holds.devices, 'device', 'devices')}`
	);
	console.log(`      last activity ${utcStamp(holds.lastActivity)}`);
	console.log(`      id ${household.id}`);
	console.log('');
	console.log('This deletes everything they have ever logged, along with everyone in');
	console.log('the household and every device signed in. It cannot be undone from');
	console.log('here, and their phones keep only what they already hold — they stop');
	console.log('syncing and nobody can sign in again.');
	console.log('');
	console.log('If they want their data, have a parent export it from Settings first.');
	console.log('');

	let answer = given;
	if (answer === null) {
		console.log('Type the id above to delete it, or press ctrl-c to stop.');
		process.stdout.write('> ');
		answer = readLine();
	}

	if (answer === '') {
		/* `docker exec` without `-it`: the prompt was printed into a shell with
		   nothing attached to answer it. Rather than leave the operator at a dead
		   end, hand them the command that does work — the id they need is on the
		   screen above, and passing it back is the same act as typing it. */
		fail(
			'\nNothing was deleted: there is no terminal here to answer on.\n\n' +
				'Pass the id as the last argument instead — it is the same answer:\n\n' +
				`    babylog delete "${called(household)}" ${household.id}\n\n` +
				'Or attach a terminal and answer the prompt:\n\n' +
				`    docker exec -it <container> babylog delete "${called(household)}"`
		);
	}
	if (answer !== household.id) fail(`\nThat is not the id of ${called(household)}, so nothing was deleted.`);

	const removed = erase(db, household.id);
	const rows = Object.values(removed).reduce((sum, n) => sum + n, 0);
	/* Read in the order the family would recognise — what they logged first,
	   the plumbing last — with any table added later on the end. */
	const order = Object.keys(AS_SPOKEN);
	const detail = Object.entries(removed)
		.filter(([table, n]) => n > 0 && table !== 'households')
		.sort(([a], [b]) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1))
		.map(([table, n]) => plural(n, ...(AS_SPOKEN[table] ?? [table, table])))
		.join(' · ');

	console.log('');
	console.log(`  Deleted ${called(household)}`);
	if (detail !== '') console.log(`      ${detail}`);
	console.log(`      ${plural(rows, 'row', 'rows')} in all, id ${household.id}`);
	console.log('');
	console.log('The rows are gone from the database. They are still inside the nightly');
	console.log('backups until those age out, which takes about two weeks — that is the');
	console.log('window to quote if somebody asked to be erased.');
	if (allHouseholds(db).length === 0) {
		console.log('');
		console.log('That was the last household here. The next restart prints a fresh setup');
		console.log('link, exactly as a new deployment does.');
	}
	console.log('');
}

function usage() {
	console.log('');
	console.log('babylog — the Baby Log Book operator tool');
	console.log('');
	console.log('  babylog households                 every household, its size and its last activity');
	console.log('  babylog household <name>           a 7-day link that sets up a new household');
	console.log('  babylog label [household] <name>   what this tool calls one, whatever the family renames itself');
	console.log('  babylog members                    who has access, and from how many devices');
	console.log('  babylog rescue [household] <name>  a 15-minute link to sign a device back in');
	console.log('  babylog delete <household> [id]    erase one household and everything it ever logged');
	console.log('');
	console.log('The two link commands need ORIGIN in the shell, the same one the');
	console.log('container uses, because a claim link is an absolute URL.');
	console.log('');
	console.log('`delete` shows what it would destroy and then wants that household\'s id');
	console.log('back — typed at the prompt, or passed as the last argument when there is');
	console.log('no terminal to ask on:');
	console.log('  docker exec -it <container> babylog delete "Anna & Tom"');
	console.log('  docker exec <container> babylog delete "Anna & Tom" <id>');
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
		if (command === 'households') {
			households(db);
			return;
		}
		if (command === 'label') {
			relabel(db, rest);
			return;
		}
		if (command === 'household') {
			mintFoundingLink(db, rest.join(' '));
			return;
		}
		if (command === 'delete') {
			deleteHousehold(db, rest);
			return;
		}
		if (command === 'rescue') {
			const scope = scopeRescue(db, rest);
			rescue(db, scope.household, scope.needle);
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
