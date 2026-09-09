/* The derived read. Spec §5.4, §5.5 and §5.6.

   Everything here goes through a real database and the real folds, because the
   claim the endpoint makes is that the wall cannot disagree with the app's own
   header — and a fixture that stubbed the folds would prove nothing. */

import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import { hubEtag, readHubState, type HubBaby, type HubState } from './hub';
import { getHousehold } from './store';
import { push } from './sync';
import type { PendingRevision } from '$domain/types';

const BERLIN = 'Europe/Berlin';
/* 14:00 in Berlin: comfortably inside the day, comfortably outside any night. */
const NOW = Date.parse('2026-08-17T12:00:00Z');
const min = (n: number) => n * 60_000;
const hour = (n: number) => n * 3600_000;

let db: Db;
let seq = 0;

function setup(): Db {
	const fresh = openDb(':memory:');
	runMigrations(fresh);
	fresh
		.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)')
		.run('h1', 'Zuhause', '05:00', BERLIN, NOW);
	fresh
		.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)')
		.run('mum', 'h1', 'Mama', 'parent');
	fresh
		.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)')
		.run('b1', 'h1', 'Emma', '2026-02-17');
	return fresh;
}

beforeEach(() => {
	db = setup();
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

function pushed(revisions: unknown[], now = NOW) {
	return push(db, {
		householdId: 'h1',
		memberId: 'mum',
		role: 'parent',
		deviceId: 'phone-a',
		revisions,
		now
	});
}

const entry = (
	id: string,
	type: string,
	at: number,
	extra: Record<string, unknown> = {},
	babyId = 'b1'
) =>
	rev({
		entity_id: id,
		fields: { baby_id: babyId, type, occurred_at: at, recording_zone: BERLIN, ...extra }
	});

function read(now = NOW, ifNoneMatch: string | null = null) {
	return readHubState(db, 'h1', { now, ifNoneMatch });
}

function state(now = NOW): HubState {
	const result = read(now);
	if (result.status !== 200) throw new Error(`expected a payload, got ${result.status}`);
	return result.state;
}

const emma = (now = NOW): HubBaby => state(now).babies[0];

/* --- the payload ------------------------------------------------------- */

describe('the payload', () => {
	it('takes no ids and carries every Baby', () => {
		db.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)').run(
			'b2',
			'h1',
			'Anton',
			'2026-02-17'
		);
		expect(state().babies.map((b) => b.name)).toEqual(['Anton', 'Emma']);
	});

	it('drops a deleted Baby, so her device goes stale and removable', () => {
		db.prepare('UPDATE babies SET deleted_at = ? WHERE id = ?').run(NOW, 'b1');
		expect(state().babies).toEqual([]);
	});

	it('names the Household and its Day Start instant, in the Household Zone', () => {
		const household = state().household;
		expect(household.id).toBe('h1');
		expect(household.name).toBe('Zuhause');
		/* 05:00 Berlin on the 17th is 03:00 UTC. */
		expect(household.day_reset_at).toBe(Date.parse('2026-08-17T03:00:00Z'));
		expect(household.caregiving).toBe(true);
	});

	it('passes Caregiving through — a read, never a gate', () => {
		pushed([rev({ kind: 'household', entity_id: 'h1', fields: { caregiving: false } })]);
		const payload = state();
		expect(payload.household.caregiving).toBe(false);
		/* Nothing is suppressed while it is off: a withheld total would lie. */
		expect(payload.babies[0].feeds_today).toBe(0);
	});

	it('ships no rows — no Entries, no ids, no Revision history', () => {
		pushed([entry('e1', 'breast_feed', NOW - hour(1), { ended_at: NOW - min(50), side: 'both' })]);
		const json = JSON.stringify(state());
		expect(json).not.toContain('"e1"');
		expect(json).not.toContain('occurred_at');
		expect(json).not.toContain('payload');
	});

	it('carries only instants — no elapsed, no remaining, no overdue', () => {
		pushed([entry('e1', 'breast_feed', NOW - hour(1), { ended_at: null, side: 'both' })]);
		const json = JSON.stringify(state());
		for (const forbidden of ['elapsed', 'remaining', 'overdue', 'absolute']) {
			expect(json).not.toContain(forbidden);
		}
	});

	it('is inapplicable as null, never as a missing key', () => {
		const baby = emma();
		expect(baby.last_feed).toBeNull();
		expect(baby.feed_due).toBeNull();
		expect(baby.asleep_since).toBeNull();
		expect(baby.awake_since).toBeNull();
		expect(baby.wake_window_up).toBeNull();
		expect(baby.bottle_runs_out).toBeNull();
		expect(baby.last_poop).toBeNull();
	});
});

/* --- the seven timestamps ---------------------------------------------- */

describe('the timestamps', () => {
	const feedTarget = () =>
		rev({
			kind: 'target',
			entity_id: 't-feed',
			fields: { baby_id: 'b1', activity: 'feed', duration_s: 3 * 3600, anchor: 'feed_start' }
		});

	it('last_feed is the latest live Feed s start', () => {
		pushed([
			entry('f1', 'breast_feed', NOW - hour(5), { ended_at: NOW - hour(4), side: 'both' }),
			entry('f2', 'bottle_feed', NOW - hour(2), { ended_at: NOW - hour(1), volume_ml: 120 })
		]);
		expect(emma().last_feed).toBe(NOW - hour(2));
	});

	it('feed_due is the Feed Interval from that start, and unknown with no Target', () => {
		pushed([entry('f1', 'breast_feed', NOW - hour(1), { ended_at: NOW - min(50), side: 'both' })]);
		expect(emma().feed_due).toBeNull();
		pushed([feedTarget()]);
		expect(emma().feed_due).toBe(NOW - hour(1) + hour(3));
	});

	it('asleep_since is the running Sleep s start, and awake_since is unknown while it runs', () => {
		pushed([entry('s1', 'sleep', NOW - min(40), { ended_at: null })]);
		expect(emma().asleep_since).toBe(NOW - min(40));
		expect(emma().awake_since).toBeNull();
	});

	it('awake_since is the last Sleep s end once she is up', () => {
		pushed([entry('s1', 'sleep', NOW - hour(2), { ended_at: NOW - hour(1) })]);
		expect(emma().awake_since).toBe(NOW - hour(1));
		expect(emma().asleep_since).toBeNull();
	});

	it('wake_window_up is the sleep due instant, and unknown while she sleeps', () => {
		pushed([
			rev({
				kind: 'target',
				entity_id: 't-sleep',
				fields: { baby_id: 'b1', activity: 'sleep', duration_s: 2 * 3600, anchor: 'sleep_end' }
			}),
			entry('s1', 'sleep', NOW - hour(3), { ended_at: NOW - hour(1) })
		]);
		expect(emma().wake_window_up).toBe(NOW - hour(1) + hour(2));
		pushed([entry('s2', 'sleep', NOW - min(10), { ended_at: null })]);
		expect(emma().wake_window_up).toBeNull();
	});

	it('bottle_runs_out uses the synthesized hour, never unknown for lack of a Target', () => {
		pushed([entry('f1', 'bottle_feed', NOW - min(20), { ended_at: null, volume_ml: 120 })]);
		expect(emma().bottle_runs_out).toBe(NOW - min(20) + hour(1));
	});

	it('bottle_runs_out is the earliest open bottle, and unknown once none is open', () => {
		pushed([
			entry('f1', 'bottle_feed', NOW - min(30), { ended_at: null, volume_ml: 60 }),
			entry('f2', 'bottle_feed', NOW - min(10), { ended_at: null, volume_ml: 60 })
		]);
		/* The older of two open bottles is the one running out first — and the
		   feed-end rule closes it at the newer one's start (ADR-0019), so the
		   answer is the surviving open bottle. */
		expect(emma().bottle_runs_out).toBe(NOW - min(10) + hour(1));
		pushed([rev({ entity_id: 'f2', fields: { ended_at: NOW } })]);
		expect(emma().bottle_runs_out).toBeNull();
	});

	it('last_poop reaches past the Day Start on purpose', () => {
		const threeDaysAgo = NOW - 3 * 24 * hour(1);
		pushed([entry('n1', 'nappy', threeDaysAgo, { pee: false, poop: true })]);
		expect(emma().last_poop).toBe(threeDaysAgo);
	});
});

/* --- the three binaries ------------------------------------------------ */

describe('the binaries', () => {
	it('asleep, feeding and bottle_open follow the app s own header', () => {
		expect(emma()).toMatchObject({ asleep: false, feeding: false, bottle_open: false });
		pushed([
			entry('s1', 'sleep', NOW - min(30), { ended_at: null }),
			entry('f1', 'bottle_feed', NOW - min(5), { ended_at: null, volume_ml: 120 })
		]);
		expect(emma()).toMatchObject({ asleep: true, feeding: true, bottle_open: true });
	});

	it('a breast feed is feeding without a bottle open', () => {
		pushed([entry('f1', 'breast_feed', NOW - min(5), { ended_at: null, side: 'both' })]);
		expect(emma()).toMatchObject({ feeding: true, bottle_open: false });
	});
});

/* --- the six totals ---------------------------------------------------- */

describe('the totals', () => {
	it('feeds_today counts rounds, not rows', () => {
		/* Breast, then formula five minutes later: one answer to "has she eaten". */
		pushed([
			entry('f1', 'breast_feed', NOW - hour(1), { ended_at: NOW - min(55), side: 'both' }),
			entry('f2', 'bottle_feed', NOW - min(50), { ended_at: NOW - min(45), volume_ml: 60 })
		]);
		expect(emma().feeds_today).toBe(1);
	});

	it('sleep_today is whole minutes, floored server-side', () => {
		pushed([entry('s1', 'sleep', NOW - min(90), { ended_at: NOW - min(30) - 20_000 })]);
		expect(emma().sleep_today).toBe(59);
	});

	it('counts pees and poops separately', () => {
		pushed([
			entry('n1', 'nappy', NOW - hour(2), { pee: true, poop: false }),
			entry('n2', 'nappy', NOW - hour(1), { pee: true, poop: true })
		]);
		expect(emma()).toMatchObject({ pees_today: 2, poops_today: 1 });
	});

	it('every always-there total is zero rather than absent on a quiet day', () => {
		expect(emma()).toMatchObject({
			feeds_today: 0,
			sleep_today: 0,
			pees_today: 0,
			poops_today: 0
		});
	});
});

/* --- appear on first use ----------------------------------------------- */

describe('appear on first use', () => {
	it('omits milk_today and tummy_today until the Household has ever logged one', () => {
		const baby = emma();
		expect('milk_today' in baby).toBe(false);
		expect('tummy_today' in baby).toBe(false);
	});

	it('a bottle brings milk_today, a stretch brings tummy_today', () => {
		pushed([entry('f1', 'bottle_feed', NOW - hour(1), { ended_at: NOW - min(50), volume_ml: 150 })]);
		expect(emma().milk_today).toBe(150);
		pushed([entry('t1', 'tummy_time', NOW - min(30), { ended_at: NOW - min(18) })]);
		expect(emma().tummy_today).toBe(12);
	});

	it('milk_today is the Intake, with a legacy leftover taken off', () => {
		pushed([
			entry('f1', 'bottle_feed', NOW - hour(1), {
				ended_at: NOW - min(50),
				volume_ml: 180,
				leftover_ml: 30
			})
		]);
		expect(emma().milk_today).toBe(150);
	});

	it('never drops a field it once carried — the rule only adds', () => {
		/* A bottle long enough ago that the stats window no longer sees it. */
		const lastMonth = NOW - 30 * 24 * hour(1);
		pushed([entry('f1', 'bottle_feed', lastMonth, { ended_at: lastMonth + min(10), volume_ml: 150 })]);
		pushed([entry('t1', 'tummy_time', lastMonth, { ended_at: lastMonth + min(10) })]);
		const baby = emma();
		expect(baby.milk_today).toBe(0);
		expect(baby.tummy_today).toBe(0);
	});

	it('the gate is the Household s, so one schema covers every Baby', () => {
		db.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)').run(
			'b2',
			'h1',
			'Anton',
			'2026-02-17'
		);
		pushed([entry('f1', 'bottle_feed', NOW - hour(1), { ended_at: NOW - min(50), volume_ml: 150 })]);
		for (const baby of state().babies) expect('milk_today' in baby).toBe(true);
	});
});

/* --- the conditional contract ------------------------------------------ */

describe('the conditional contract', () => {
	const etagOf = (now = NOW) => {
		const result = read(now);
		if (result.status === 401 || result.status === 402) throw new Error('no etag');
		return result.etag;
	};

	it('is a strong ETag of the cursor, the day key and the night key', () => {
		const household = getHousehold(db, 'h1')!;
		expect(hubEtag(41, household, NOW)).toBe('"41-2026-08-17-0"');
	});

	it('answers 304 with an empty body when the Hub echoes it back', () => {
		const result = read(NOW, etagOf());
		expect(result.status).toBe(304);
		expect(result).not.toHaveProperty('state');
	});

	it('accepts a list, as a proxy in the middle may send one', () => {
		expect(read(NOW, `"nonsense", ${etagOf()}`).status).toBe(304);
	});

	it('never folds behind a match: a row the log did not move stays unseen', () => {
		const etag = etagOf();
		/* Straight into the table, so the cursor does not move — exactly what a
		   fold would have to run to notice. */
		db.prepare(
			`INSERT INTO entries (id, household_id, baby_id, type, occurred_at, recording_zone, payload, logged_by, logged_at)
			 VALUES ('sneaky', 'h1', 'b1', 'nappy', ?, ?, '{"pee":true,"poop":false}', 'mum', ?)`
		).run(NOW - min(5), BERLIN, NOW - min(5));
		expect(read(NOW, etag).status).toBe(304);
		expect(emma().pees_today).toBe(1);
	});

	it('misses once when a revision is accepted', () => {
		const before = etagOf();
		pushed([entry('n1', 'nappy', NOW - min(5), { pee: true, poop: false })]);
		expect(etagOf()).not.toBe(before);
		expect(read(NOW, before).status).toBe(200);
	});

	it('misses exactly once when the day rolls over', () => {
		const evening = Date.parse('2026-08-17T20:00:00Z');
		const morning = Date.parse('2026-08-18T04:00:00Z');
		const before = etagOf(evening);
		expect(etagOf(morning)).not.toBe(before);
		/* And then holds for the rest of the new day. */
		expect(etagOf(morning + hour(3))).toBe(etagOf(morning));
	});

	it('misses exactly once when the Night begins, and not before', () => {
		pushed([rev({ kind: 'household', entity_id: 'h1', fields: { night_start: '21:00' } })]);
		/* 20:00 and 20:30 Berlin: the Night is stated but has not begun. */
		const beforeNight = etagOf(Date.parse('2026-08-17T18:00:00Z'));
		expect(etagOf(Date.parse('2026-08-17T18:30:00Z'))).toBe(beforeNight);
		/* 21:30 Berlin: begun. */
		const inNight = etagOf(Date.parse('2026-08-17T19:30:00Z'));
		expect(inNight).not.toBe(beforeNight);
		expect(etagOf(Date.parse('2026-08-17T21:00:00Z'))).toBe(inNight);
	});

	it('the night key stays pinned for a Household that keeps none', () => {
		for (const at of ['T18:00', 'T19:30', 'T22:00']) {
			expect(etagOf(Date.parse(`2026-08-17${at}:00Z`))).toMatch(/-0"$/);
		}
	});

	it('a Night that begins at the Day Start is no Night at all', () => {
		pushed([rev({ kind: 'household', entity_id: 'h1', fields: { night_start: '05:00' } })]);
		expect(etagOf(Date.parse('2026-08-17T22:00:00Z'))).toMatch(/-0"$/);
	});

	it('the night key moves feed_due, which is why it is in the ETag', () => {
		pushed([
			rev({ kind: 'household', entity_id: 'h1', fields: { night_start: '21:00' } }),
			rev({
				kind: 'target',
				entity_id: 't-feed',
				fields: { baby_id: 'b1', activity: 'feed', duration_s: 3 * 3600, anchor: 'feed_start' }
			}),
			/* 20:00 Berlin, so the next Feed falls due at 23:00 — inside the Night. */
			entry('f1', 'breast_feed', Date.parse('2026-08-17T18:00:00Z'), {
				ended_at: Date.parse('2026-08-17T18:20:00Z'),
				side: 'both'
			})
		]);
		const evening = Date.parse('2026-08-17T18:30:00Z');
		expect(emma(evening).feed_due).toBe(Date.parse('2026-08-17T21:00:00Z'));
		/* Once the Night has begun, it is the morning's Feed. */
		const night = Date.parse('2026-08-17T19:30:00Z');
		expect(emma(night).feed_due).toBe(Date.parse('2026-08-18T03:00:00Z'));
	});

	it('a session whose Household is gone is not a session', () => {
		expect(readHubState(db, 'nowhere', { now: NOW })).toEqual({
			status: 401,
			code: 'unauthenticated'
		});
	});
});
