/* The two-household fixture. Hosted spec §8, ADR-0020.

   Isolation is demonstrated, not assumed: two populated Households, every
   boundary attacked from the wrong side. Everything here is a push, a pull or a
   claim made by a real Member of Household A naming something that belongs to
   Household B — the shape a hosted deployment makes reachable and a
   one-Household deployment never did. */

import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import { push, pull } from './sync';
import {
	claim,
	mintBootstrap,
	mintInvite,
	mintRescue,
	listPendingLinks,
	revokePendingLink
} from './claims';
import { createSession, resolveSession, revokeMember } from './auth';
import { getEntry, getHousehold, getMember, insertRevision, listMembers, materialise, revisionsOf } from './store';
import { listenerCount, subscribe, wake } from './live';
import {
	deleteMemberSubscriptions,
	deleteOwnSubscription,
	listSubscriptions,
	planNotices,
	saveSubscription
} from './notify';
import type { PendingRevision, Role } from '$domain/types';

const BERLIN = 'Europe/Berlin';
const LISBON = 'Europe/Lisbon';
const NOW = Date.parse('2026-08-17T20:00:00Z');
const SECRET = Buffer.alloc(32, 5);

let db: Db;
let seq = 0;

/** Two Households, both populated, both with a Parent, a Caregiver and a Baby.
    A is the attacker's own Household throughout; B is the victim. */
function fixture(): Db {
	const fresh = openDb(':memory:');
	runMigrations(fresh);
	const household = fresh.prepare(
		'INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)'
	);
	const member = fresh.prepare(
		'INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)'
	);
	const baby = fresh.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)');

	household.run('A', 'Anna & Tom', '05:00', BERLIN, NOW);
	member.run('a-mum', 'A', 'Mama', 'parent');
	member.run('a-oma', 'A', 'Oma', 'caregiver');
	baby.run('a-baby', 'A', 'Lina', '2026-02-17');

	household.run('B', 'Bea & Ben', '06:00', LISBON, NOW);
	member.run('b-mum', 'B', 'Beatriz', 'parent');
	member.run('b-dad', 'B', 'Bento', 'parent');
	baby.run('b-baby', 'B', 'Rui', '2026-03-01');
	return fresh;
}

beforeEach(() => {
	db = fixture();
	seq = 0;
});

function rev(p: Partial<PendingRevision> & { entity_id: string; fields: Record<string, unknown> }) {
	seq += 1;
	return {
		...p,
		id: p.id ?? `r${seq}`,
		kind: p.kind ?? 'entry',
		merge_at: p.merge_at ?? NOW,
		device_id: p.device_id ?? 'phone-a'
	};
}

/** A push by Household A's Parent — the wrong side of every boundary below. */
function fromA(revisions: unknown[], role: Role = 'parent', memberId = 'a-mum', now = NOW) {
	return push(db, { householdId: 'A', memberId, role, deviceId: 'phone-a', revisions, now });
}

function fromB(revisions: unknown[], role: Role = 'parent', memberId = 'b-mum', now = NOW) {
	return push(db, { householdId: 'B', memberId, role, deviceId: 'phone-b', revisions, now });
}

const sleep = (id: string, babyId: string, at: number) =>
	rev({
		entity_id: id,
		fields: { baby_id: babyId, type: 'sleep', occurred_at: at, ended_at: null, recording_zone: BERLIN }
	});

const bottle = (id: string, babyId: string, at: number) =>
	rev({
		entity_id: id,
		fields: {
			baby_id: babyId,
			type: 'bottle_feed',
			occurred_at: at,
			ended_at: null,
			recording_zone: BERLIN,
			volume_ml: 120
		}
	});

describe('a foreign entity id', () => {
	it('is refused for an Entry that already lives in the other Household', () => {
		fromB([sleep('b-entry', 'b-baby', NOW - 3600_000)]);
		const result = fromA([rev({ entity_id: 'b-entry', fields: { note: 'mine now' } })]);
		expect(result.accepted).toEqual([]);
		expect(result.rejected).toHaveLength(1);
		expect(getEntry(db, 'B', 'b-entry')?.note).toBeNull();
	});

	it('is refused for a Baby, a Member, a Food and a Target alike', () => {
		fromB([rev({ kind: 'food', entity_id: 'b-food', fields: { name: 'Pêra' } })]);
		fromB([
			rev({
				kind: 'target',
				entity_id: 'b-target',
				fields: { baby_id: 'b-baby', activity: 'feed', duration_s: 7200, anchor: 'feed_start' }
			})
		]);

		const attacks = [
			rev({ kind: 'baby', entity_id: 'b-baby', fields: { name: 'Renamed' } }),
			rev({ kind: 'member', entity_id: 'b-dad', fields: { display_name: 'Renamed' } }),
			rev({ kind: 'food', entity_id: 'b-food', fields: { name: 'Renamed' } }),
			rev({
				kind: 'target',
				entity_id: 'b-target',
				fields: { baby_id: 'b-baby', activity: 'feed', duration_s: 60, anchor: 'feed_start' }
			})
		];
		for (const attack of attacks) {
			const result = fromA([attack]);
			expect(result.accepted).toEqual([]);
			expect(result.rejected).toHaveLength(1);
		}

		expect((db.prepare('SELECT name FROM babies WHERE id = ?').get('b-baby') as { name: string }).name).toBe(
			'Rui'
		);
		expect(getMember(db, 'B', 'b-dad')?.display_name).toBe('Bento');
		expect((db.prepare('SELECT name FROM foods WHERE id = ?').get('b-food') as { name: string }).name).toBe(
			'Pêra'
		);
		expect(
			(db.prepare('SELECT duration_s FROM targets WHERE id = ?').get('b-target') as { duration_s: number })
				.duration_s
		).toBe(7200);
	});

	it('is refused even before the entity has a row of its own', () => {
		/* An edit whose creating revision has not arrived materialises nothing, so
		   only the log knows the entity exists — and the guard reads the log. */
		fromB([rev({ entity_id: 'b-ghost', fields: { note: 'first' } })]);
		expect(getEntry(db, 'B', 'b-ghost')).toBeNull();
		const result = fromA([rev({ entity_id: 'b-ghost', fields: { note: 'stolen' } })]);
		expect(result.accepted).toEqual([]);
		expect(revisionsOf(db, 'A', 'entry', 'b-ghost')).toEqual([]);
	});

	it('cannot rename the other Household, because a household revision means the session s own', () => {
		const result = fromA([rev({ kind: 'household', entity_id: 'B', fields: { name: 'Taken over' } })]);
		/* Not rejected but redirected: the only Household it can mean is A's. */
		expect(result.accepted).toHaveLength(1);
		expect(getHousehold(db, 'B')).toMatchObject({ name: 'Bea & Ben', day_start: '06:00', zone: LISBON });
		expect(getHousehold(db, 'A')?.name).toBe('Taken over');
	});

	it('cannot change the other Household s Day Start or Zone either', () => {
		fromA([rev({ kind: 'household', entity_id: 'B', fields: { day_start: '23:00', zone: BERLIN } })]);
		expect(getHousehold(db, 'B')).toMatchObject({ day_start: '06:00', zone: LISBON });
		expect(getHousehold(db, 'A')).toMatchObject({ day_start: '23:00', zone: BERLIN });
	});

	it('says nothing about what it refused', () => {
		fromB([sleep('b-entry', 'b-baby', NOW)]);
		const known = fromA([rev({ entity_id: 'b-entry', fields: { note: 'x' } })]);
		const unknown = fromA([rev({ entity_id: 'not-a-real-id', fields: { deleted_at: NOW } })]);
		/* The reason for a foreign id is uninformative, and deliberately not the
		   reason a merely-unknown id gets. */
		expect(known.rejected[0].reason).toBe('not accepted');
		expect(unknown.accepted).toHaveLength(1);
	});
});

describe('the household predicate on every upsert', () => {
	/* Defence in depth (hosted spec §5.4): with the guard in push these can never
	   fire, so they are reached here by calling materialise directly — the shape a
	   future bug upstream would take. */
	const foreignRevision = (kind: 'entry' | 'baby' | 'member' | 'food' | 'target', fields: Record<string, unknown>) =>
		insertRevision(
			db,
			{
				id: `forged-${kind}`,
				/* The log entry says A, while the entity id names a row of B's. */
				household_id: 'A',
				kind,
				entity_id: kind === 'entry' ? 'b-entry' : kind === 'baby' ? 'b-baby' : 'b-dad',
				fields,
				merge_at: NOW,
				device_id: 'phone-a',
				author_id: 'a-mum',
				skewed: false
			},
			NOW
		);

	it('refuses to update an Entry that belongs to the other Household', () => {
		fromB([sleep('b-entry', 'b-baby', NOW - 3600_000)]);
		foreignRevision('entry', {
			baby_id: 'a-baby',
			type: 'sleep',
			occurred_at: NOW,
			recording_zone: BERLIN,
			note: 'taken over'
		});
		materialise(db, 'A', 'entry', 'b-entry');
		expect(getEntry(db, 'B', 'b-entry')).toMatchObject({ baby_id: 'b-baby', note: null });
		/* And no second row appeared in A either: the id is B's. */
		expect(getEntry(db, 'A', 'b-entry')).toBeNull();
	});

	it('refuses to update a Baby or a Member that belongs to the other Household', () => {
		foreignRevision('baby', { name: 'Renamed' });
		materialise(db, 'A', 'baby', 'b-baby');
		expect(db.prepare('SELECT name, household_id FROM babies WHERE id = ?').get('b-baby')).toEqual({
			name: 'Rui',
			household_id: 'B'
		});

		foreignRevision('member', { display_name: 'Renamed', role: 'caregiver' });
		materialise(db, 'A', 'member', 'b-dad');
		expect(getMember(db, 'B', 'b-dad')).toMatchObject({ display_name: 'Bento', role: 'parent' });
	});

	it('names the session s Household in the households UPDATE, whatever entity is asked for', () => {
		insertRevision(
			db,
			{
				id: 'forged-household',
				household_id: 'A',
				kind: 'household',
				entity_id: 'B',
				fields: { name: 'Taken over', day_start: '23:00' },
				merge_at: NOW,
				device_id: 'phone-a',
				author_id: 'a-mum',
				skewed: false
			},
			NOW
		);
		materialise(db, 'A', 'household', 'B');
		expect(getHousehold(db, 'B')).toMatchObject({ name: 'Bea & Ben', day_start: '06:00' });
		/* It lands on the Household whose log holds the revision — the only one it
		   can ever mean. */
		expect(getHousehold(db, 'A')).toMatchObject({ name: 'Taken over', day_start: '23:00' });
	});
});

describe('a foreign revision id', () => {
	it('is rejected rather than silently accepted as a replay', () => {
		/* Accepting it would be data loss for the pusher — their revision would
		   never be stored — plus an existence oracle. */
		fromB([{ ...sleep('b-entry', 'b-baby', NOW), id: 'shared-id' }]);
		const result = fromA([{ ...sleep('a-entry', 'a-baby', NOW), id: 'shared-id' }]);
		expect(result.accepted).toEqual([]);
		expect(result.rejected).toEqual([{ id: 'shared-id', reason: 'not accepted' }]);
		expect(getEntry(db, 'A', 'a-entry')).toBeNull();
	});

	it('still lets the owning Household replay its own', () => {
		const batch = [{ ...sleep('a-entry', 'a-baby', NOW), id: 'shared-id' }];
		fromA(batch);
		expect(fromA(batch).accepted).toEqual(['shared-id']);
		expect(revisionsOf(db, 'A', 'entry', 'a-entry')).toHaveLength(1);
	});
});

describe('the deterministic server-minted ids', () => {
	it('let both Households merge their own duplicate Sleeps', () => {
		/* `merge:<loser>:<survivor>` is a shared namespace; unscoped, the first
		   Household to write one would suppress the other's. */
		fromA([sleep('a-early', 'a-baby', NOW - 7200_000)]);
		const a = fromA([sleep('a-late', 'a-baby', NOW - 3600_000)]);
		expect(a.merged).toEqual([{ survivor_id: 'a-early', loser_id: 'a-late' }]);

		fromB([sleep('b-early', 'b-baby', NOW - 7200_000)]);
		const b = fromB([sleep('b-late', 'b-baby', NOW - 3600_000)]);
		expect(b.merged).toEqual([{ survivor_id: 'b-early', loser_id: 'b-late' }]);
	});

	it('cannot be squatted by a client at all, in either Household', () => {
		/* Ids are globally unique, so squatting `merge:…` would not merely suppress
		   the other Household's merge — their next push would fail on the UNIQUE
		   constraint. Nothing legitimate mints these, so push refuses them. */
		const squat = fromA([
			{ ...sleep('a-x', 'a-baby', NOW - 7200_000), id: 'merge:b-late:b-early' },
			{ ...sleep('a-y', 'a-baby', NOW - 7200_000), id: 'bottle-past:b-bottle' }
		]);
		expect(squat.accepted).toEqual([]);
		expect(squat.rejected.map((r) => r.reason)).toEqual([
			'only the app may mint that revision id',
			'only the app may mint that revision id'
		]);

		fromB([sleep('b-early', 'b-baby', NOW - 7200_000)]);
		const b = fromB([sleep('b-late', 'b-baby', NOW - 3600_000)]);
		expect(b.merged).toEqual([{ survivor_id: 'b-early', loser_id: 'b-late' }]);
		expect(getEntry(db, 'B', 'b-late')?.merged_into).toBe('b-early');
	});

	it('close each Household s past bottle independently', () => {
		fromA([bottle('a-bottle', 'a-baby', NOW - 2 * 3600_000)]);
		fromB([bottle('b-bottle', 'b-baby', NOW - 2 * 3600_000)]);
		expect(getEntry(db, 'A', 'a-bottle')?.ended_at).toBe(NOW - 3600_000);
		expect(getEntry(db, 'B', 'b-bottle')?.ended_at).toBe(NOW - 3600_000);
		expect(revisionsOf(db, 'A', 'entry', 'a-bottle')[1].id).toBe('bottle-past:a-bottle');
		expect(revisionsOf(db, 'B', 'entry', 'b-bottle')[1].id).toBe('bottle-past:b-bottle');
	});
});

describe('the pull', () => {
	it('returns only the session Household s revisions', () => {
		fromA([sleep('a-entry', 'a-baby', NOW - 3600_000)]);
		fromB([sleep('b-entry', 'b-baby', NOW - 3600_000)]);
		expect(pull(db, 'A', 0, NOW).revisions.map((r) => r.entity_id)).toEqual(['a-entry']);
		expect(pull(db, 'B', 0, NOW).revisions.map((r) => r.entity_id)).toEqual(['b-entry']);
	});

	it('gives each Household a cursor of its own', () => {
		fromB([sleep('b-1', 'b-baby', NOW), sleep('b-2', 'b-baby', NOW)]);
		const a = fromA([sleep('a-1', 'a-baby', NOW)]);
		expect(a.cursor).toBe(pull(db, 'A', 0, NOW).cursor);
		expect(pull(db, 'A', a.cursor, NOW).more).toBe(false);
	});
});

describe('Member management', () => {
	it('counts only the own Household s Parents when protecting the last one', () => {
		/* B has two Parents; that must not license demoting A's only one. */
		const demote = fromA([rev({ kind: 'member', entity_id: 'a-mum', fields: { role: 'caregiver' } })]);
		expect(demote.rejected[0].reason).toMatch(/last Parent/);
		expect(getMember(db, 'A', 'a-mum')?.role).toBe('parent');
	});

	it('revokes Devices only inside the Household doing the removing', () => {
		const bToken = createSession(db, SECRET, { memberId: 'b-dad', deviceId: 'b-phone', now: NOW });
		expect(revokeMember(db, 'A', 'b-dad', NOW)).toBe(0);
		expect(resolveSession(db, SECRET, bToken, NOW)).toMatchObject({ ok: true });
		expect(revokeMember(db, 'B', 'b-dad', NOW)).toBe(1);
		expect(resolveSession(db, SECRET, bToken, NOW)).toEqual({ ok: false, code: 'unauthenticated' });
	});

	it('looks a Member up inside one Household only', () => {
		expect(getMember(db, 'A', 'b-dad')).toBeNull();
		expect(getMember(db, 'B', 'b-dad')).toMatchObject({ display_name: 'Bento' });
	});
});

describe('Claim Links', () => {
	it('land only in the minting Household', () => {
		const invite = mintInvite(db, SECRET, {
			householdId: 'A',
			displayName: 'Tante',
			role: 'caregiver',
			createdBy: 'a-mum',
			origin: 'https://log.example.com',
			now: NOW
		});
		expect(listPendingLinks(db, 'B', NOW)).toEqual([]);
		expect(listPendingLinks(db, 'A', NOW)).toHaveLength(1);

		const result = claim(db, SECRET, { token: invite.token, deviceId: 'd1', zone: BERLIN, now: NOW });
		expect(result).toMatchObject({ ok: true, householdId: 'A' });
		expect(listMembers(db, 'B').map((m) => m.display_name)).toEqual(['Beatriz', 'Bento']);
	});

	it('re-bind a rescued Device into the Member s own Household', () => {
		const link = mintRescue(db, SECRET, {
			householdId: 'B',
			memberId: 'b-dad',
			origin: 'https://log.example.com',
			now: NOW
		});
		const result = claim(db, SECRET, { token: link.token, deviceId: 'd2', zone: BERLIN, now: NOW });
		expect(result).toMatchObject({ ok: true, memberId: 'b-dad', householdId: 'B' });
	});

	it('a pending rescue is only ever the minting Household s to see or revoke', () => {
		const link = mintRescue(db, SECRET, {
			householdId: 'A',
			memberId: 'a-oma',
			createdBy: 'a-mum',
			origin: 'https://log.example.com',
			now: NOW
		});
		expect(listPendingLinks(db, 'B', NOW)).toEqual([]);
		const [pending] = listPendingLinks(db, 'A', NOW);
		/* Beatriz holds the handle — it is on nobody's screen but a Parent of A's,
		   and even so it is not hers to burn. */
		expect(revokePendingLink(db, 'B', pending.token_hash, NOW)).toBe(false);
		expect(revokePendingLink(db, 'A', pending.token_hash, NOW)).toBe(true);
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd3', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'burnt'
		});
	});

	it('Removal burns pending rescues inside that Household alone', () => {
		mintRescue(db, SECRET, {
			householdId: 'A',
			memberId: 'a-oma',
			createdBy: 'a-mum',
			origin: 'https://log.example.com',
			now: NOW
		});
		mintRescue(db, SECRET, {
			householdId: 'B',
			memberId: 'b-dad',
			createdBy: 'b-mum',
			origin: 'https://log.example.com',
			now: NOW
		});
		/* A member id is a client-supplied id and never a capability (ADR-0020):
		   removing from the wrong side reaches nothing. */
		revokeMember(db, 'A', 'b-dad', NOW);
		expect(listPendingLinks(db, 'B', NOW)).toHaveLength(1);
		revokeMember(db, 'B', 'b-dad', NOW);
		expect(listPendingLinks(db, 'B', NOW)).toEqual([]);
		expect(listPendingLinks(db, 'A', NOW)).toHaveLength(1);
	});

	it('are invalid when a non-founding link carries no Household', () => {
		/* A row without a household_id is a bug or an attack, never "whatever
		   Household happens to be first in the file". */
		const link = mintRescue(db, SECRET, {
			householdId: 'B',
			memberId: 'b-dad',
			origin: 'https://log.example.com',
			now: NOW
		});
		db.prepare("UPDATE claim_links SET household_id = NULL WHERE kind = 'rescue'").run();
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd2', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});
});

describe('a Founding Link', () => {
	it('founds a further Household even though two already exist', () => {
		const link = mintBootstrap(db, SECRET, {
			origin: 'https://log.example.com',
			now: NOW,
			label: 'Carla & Cem'
		});
		const result = claim(db, SECRET, {
			token: link.token,
			deviceId: 'd3',
			zone: 'Europe/Istanbul',
			displayName: 'Carla',
			now: NOW
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.householdId).not.toBe('A');
		expect(result.householdId).not.toBe('B');
		expect(getHousehold(db, result.householdId)).toMatchObject({
			name: 'Carla & Cem',
			zone: 'Europe/Istanbul',
			day_start: '05:00'
		});
		expect(listMembers(db, result.householdId)).toMatchObject([{ display_name: 'Carla', role: 'parent' }]);
	});

	it('carries the label into the log, so the founder s Device learns the name', () => {
		const link = mintBootstrap(db, SECRET, { origin: 'https://x', now: NOW, label: 'Carla & Cem' });
		const result = claim(db, SECRET, {
			token: link.token,
			deviceId: 'd3',
			zone: BERLIN,
			displayName: 'Carla',
			now: NOW
		});
		if (!result.ok) throw new Error('claim failed');
		const [seed] = revisionsOf(db, result.householdId, 'household', result.householdId);
		expect(seed.fields).toMatchObject({ name: 'Carla & Cem', zone: BERLIN });
	});

	it('founds an unnamed Household when it carries no label, as first boot does', () => {
		const link = mintBootstrap(db, SECRET, { origin: 'https://x', now: NOW });
		const result = claim(db, SECRET, {
			token: link.token,
			deviceId: 'd4',
			zone: BERLIN,
			displayName: 'Dana',
			now: NOW
		});
		if (!result.ok) throw new Error('claim failed');
		expect(getHousehold(db, result.householdId)?.name).toBe('');
	});

	it('never joins an existing Household, however many are in the file', () => {
		const before = db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number };
		const link = mintBootstrap(db, SECRET, { origin: 'https://x', now: NOW, label: 'Carla & Cem' });
		claim(db, SECRET, { token: link.token, deviceId: 'd3', zone: BERLIN, displayName: 'Carla', now: NOW });
		const after = db.prepare('SELECT COUNT(*) AS n FROM households').get() as { n: number };
		expect(after.n).toBe(before.n + 1);
	});

	it('is superseded on restart only when it was printed at boot', () => {
		/* An operator-minted link waiting for a friend must survive a container
		   restart; the boot line must not pile up (hosted spec §3.3). */
		const operator = mintBootstrap(db, SECRET, { origin: 'https://x', now: NOW, label: 'Carla & Cem' });
		const firstBoot = mintBootstrap(db, SECRET, { origin: 'https://x', now: NOW });
		const secondBoot = mintBootstrap(db, SECRET, { origin: 'https://x', now: NOW + 1000 });

		const live = (token: string) =>
			claim(db, SECRET, { token, deviceId: 'd9', zone: BERLIN, displayName: 'X', now: NOW + 2000 }).ok;
		expect(live(firstBoot.token)).toBe(false);
		expect(live(secondBoot.token)).toBe(true);
		expect(live(operator.token)).toBe(true);
	});
});

describe('the wake signal', () => {
	it('reaches only the pushing Household s listeners', () => {
		const woken: string[] = [];
		const offA = subscribe('A', () => woken.push('A'));
		const offB = subscribe('B', () => woken.push('B'));
		try {
			wake('A');
			expect(woken).toEqual(['A']);
			wake('B');
			expect(woken).toEqual(['A', 'B']);
		} finally {
			offA();
			offB();
		}
		expect(listenerCount('A')).toBe(0);
		expect(listenerCount('B')).toBe(0);
	});

	it('wakes nobody for a Household with no Devices listening', () => {
		const woken: string[] = [];
		const off = subscribe('A', () => woken.push('A'));
		try {
			wake('B');
			expect(woken).toEqual([]);
		} finally {
			off();
		}
	});
});

describe('push subscriptions', () => {
	/** Two phones, one in each Household, both asking to be told about bottles. */
	function subscribed() {
		saveSubscription(db, {
			endpoint: 'https://push.example.com/a',
			p256dh: 'p',
			auth: 'a',
			householdId: 'A',
			memberId: 'a-mum',
			deviceId: 'phone-a',
			now: NOW
		});
		saveSubscription(db, {
			endpoint: 'https://push.example.com/b',
			p256dh: 'p',
			auth: 'a',
			householdId: 'B',
			memberId: 'b-mum',
			deviceId: 'phone-b',
			now: NOW
		});
	}

	it('lists only the Household that owns them', () => {
		subscribed();
		expect(listSubscriptions(db, 'A').map((s) => s.endpoint)).toEqual(['https://push.example.com/a']);
		expect(listSubscriptions(db, 'B').map((s) => s.endpoint)).toEqual(['https://push.example.com/b']);
	});

	it('never tells one Household about the other Household\'s bottle', () => {
		subscribed();
		/* B's Baby has a bottle open and nearly out; A's has nothing. */
		fromB([bottle('b-bottle', 'b-baby', NOW)], 'parent', 'b-mum', NOW);
		const notices = planNotices(db, NOW + 55 * 60_000);
		expect(notices.map((n) => n.notice.entry_id)).toEqual(['b-bottle']);
		expect(notices.flatMap((n) => n.subscriptions.map((s) => s.endpoint))).toEqual([
			'https://push.example.com/b'
		]);
	});

	it('refuses to silence a Device belonging to someone else', () => {
		subscribed();
		/* An endpoint is a client-supplied id, and one of those is never a
		   capability (ADR-0020). */
		expect(deleteOwnSubscription(db, 'https://push.example.com/b', 'a-mum')).toBe(0);
		expect(listSubscriptions(db, 'B').length).toBe(1);
		expect(deleteOwnSubscription(db, 'https://push.example.com/a', 'a-mum')).toBe(1);
	});

	it('removes only the named Member\'s own subscriptions', () => {
		subscribed();
		expect(deleteMemberSubscriptions(db, 'a-mum')).toBe(1);
		expect(listSubscriptions(db, 'B').length).toBe(1);
	});

	it('is dropped when that Member is removed from their own Household', () => {
		subscribed();
		revokeMember(db, 'A', 'a-mum', NOW);
		expect(listSubscriptions(db, 'A')).toEqual([]);
		expect(listSubscriptions(db, 'B').length).toBe(1);
	});

	it('survives a removal attempted from the wrong Household', () => {
		subscribed();
		revokeMember(db, 'A', 'b-mum', NOW);
		expect(listSubscriptions(db, 'B').length).toBe(1);
	});
});
