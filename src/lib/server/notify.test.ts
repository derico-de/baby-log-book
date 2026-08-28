/* The notifier (ADR-0030). What is asserted here is delivery, not arithmetic:
   *which* bottle is nearly out is `bottlesNearingEnd`, tested beside the other
   domain folds and imported unchanged. */

import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import {
	deleteDeviceSubscriptions,
	listSubscriptions,
	noticeText,
	planNotices,
	pruneSent,
	runNotifierTick,
	saveSubscription,
	type Sender,
	type StoredSubscription
} from './notify';
import { revokeMember } from './auth';

const BERLIN = 'Europe/Berlin';
const STARTED = Date.parse('2026-08-17T13:00:00Z');
/** An hour's Bottle Life: due at 14:00, so the last ten minutes begin at 13:50. */
const INSIDE = Date.parse('2026-08-17T13:55:00Z');

let db: Db;

function openBottle(id: string, at = STARTED, householdId = 'h1', babyId = 'b1') {
	db.prepare(
		`INSERT INTO entries (id, household_id, baby_id, type, occurred_at, payload, logged_by, logged_at)
		 VALUES (?,?,?,'bottle_feed',?,'{}','mum',?)`
	).run(id, householdId, babyId, at, at);
}

function closedEntry(id: string, type: string, at: number, endedAt: number, babyId = 'b1') {
	db.prepare(
		`INSERT INTO entries (id, household_id, baby_id, type, occurred_at, ended_at, payload, logged_by, logged_at)
		 VALUES (?,'h1',?,?,?,?,'{}','mum',?)`
	).run(id, babyId, type, at, endedAt, at);
}

/** A Target the Household typed. The bottle has one by default — the fold falls
    back to the seeded hour — but a Feed Notice and a Sleep Notice need a stated
    number, exactly as the sticky header does. */
function target(id: string, activity: string, durationS: number, anchor: string, babyId = 'b1') {
	db.prepare(
		`INSERT INTO targets (id, household_id, baby_id, activity, duration_s, anchor)
		 VALUES (?,'h1',?,?,?,?)`
	).run(id, babyId, activity, durationS, anchor);
}

function setOffsets(feed: number | null, sleep: number | null) {
	db.prepare('UPDATE households SET feed_notice_s = ?, sleep_notice_s = ? WHERE id = ?').run(
		feed,
		sleep,
		'h1'
	);
}

function subscribe(endpoint: string, memberId = 'mum', deviceId = 'phone', householdId = 'h1') {
	saveSubscription(db, {
		endpoint,
		p256dh: 'p',
		auth: 'a',
		householdId,
		memberId,
		deviceId,
		now: STARTED
	});
}

/** A push service that always accepts, and remembers what it was told. */
function acceptAll(): Sender & {
	calls: Array<{ endpoint: string; payload: string; ttlSeconds: number }>;
} {
	const calls: Array<{ endpoint: string; payload: string; ttlSeconds: number }> = [];
	const sender = (async (subscription: StoredSubscription, payload: string, ttlSeconds: number) => {
		calls.push({ endpoint: subscription.endpoint, payload, ttlSeconds });
		return { ok: true, status: 201, gone: false };
	}) as Sender & { calls: typeof calls };
	sender.calls = calls;
	return sender;
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	db.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)').run(
		'h1',
		'Zuhause',
		'05:00',
		BERLIN,
		STARTED
	);
	db.prepare('INSERT INTO members (id, household_id, display_name, role, locale) VALUES (?,?,?,?,?)').run(
		'mum',
		'h1',
		'Mama',
		'parent',
		'de'
	);
	db.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)').run(
		'b1',
		'h1',
		'Lina',
		'2026-02-17'
	);
});

describe('what is owed to whom', () => {
	it('says nothing while no Device has asked to be told', () => {
		openBottle('f1');
		expect(planNotices(db, INSIDE)).toEqual([]);
	});

	/* The Caregiving switch outranks everything below it: the subscription is
	   live, the bottle is inside its last ten minutes, and still nothing is
	   owed — until the switch comes back on, when the same bottle is. */
	it('says nothing while Caregiving is switched off, whatever else is switched on', () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		db.prepare('UPDATE households SET caregiving = 0 WHERE id = ?').run('h1');
		expect(planNotices(db, INSIDE)).toEqual([]);

		db.prepare('UPDATE households SET caregiving = 1 WHERE id = ?').run('h1');
		expect(planNotices(db, INSIDE)).toHaveLength(1);
	});

	it('names the bottle and the Devices once its last ten minutes have begun', () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		expect(planNotices(db, Date.parse('2026-08-17T13:40:00Z'))).toEqual([]);
		const notices = planNotices(db, INSIDE);
		expect(notices.map((n) => n.notice.entry_id)).toEqual(['f1']);
		expect(notices[0].babyName).toBe('Lina');
		expect(notices[0].subscriptions.map((s) => s.endpoint)).toEqual(['https://push.example.com/1']);
	});

	it('says nothing about a bottle already past its Life — that Feed is over', () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		expect(planNotices(db, Date.parse('2026-08-17T14:01:00Z'))).toEqual([]);
	});

	it('never speaks to a removed Member\'s Devices', () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		revokeMember(db, 'h1', 'mum', INSIDE);
		expect(listSubscriptions(db, 'h1')).toEqual([]);
		expect(planNotices(db, INSIDE)).toEqual([]);
	});

	it('forgets a phone that has signed out', () => {
		subscribe('https://push.example.com/1', 'mum', 'phone');
		subscribe('https://push.example.com/2', 'mum', 'tablet');
		deleteDeviceSubscriptions(db, 'mum', 'phone');
		expect(listSubscriptions(db, 'h1').map((s) => s.endpoint)).toEqual(['https://push.example.com/2']);
	});
});

describe('a tick', () => {
	it('tells every subscribed Device once, and only once', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1', 'mum', 'phone');
		subscribe('https://push.example.com/2', 'mum', 'tablet');
		const send = acceptAll();

		expect(await runNotifierTick(db, INSIDE, send)).toEqual({ sent: 2, failed: 0, dropped: 0 });
		expect(await runNotifierTick(db, INSIDE + 30_000, send)).toEqual({ sent: 0, failed: 0, dropped: 0 });
		expect(send.calls.length).toBe(2);
	});

	it('speaks the Member\'s own language, and names the Baby', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		const send = acceptAll();
		await runNotifierTick(db, INSIDE, send);

		const payload = JSON.parse(send.calls[0].payload);
		expect(payload.title).toBe('Fläschchenzeit fast um');
		expect(payload.body).toContain('Lina');
		/* One notification per bottle, replaced rather than stacked. */
		expect(payload.tag).toBe('bottle:f1');
	});

	it('tries again next tick when a push service is having a bad minute', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		let attempts = 0;
		const flaky: Sender = async () => {
			attempts += 1;
			return attempts === 1 ? { ok: false, status: 503, gone: false } : { ok: true, status: 201, gone: false };
		};

		expect(await runNotifierTick(db, INSIDE, flaky)).toEqual({ sent: 0, failed: 1, dropped: 0 });
		expect(await runNotifierTick(db, INSIDE + 30_000, flaky)).toEqual({ sent: 1, failed: 0, dropped: 0 });
		/* And a failure never costs the Device its subscription. */
		expect(listSubscriptions(db, 'h1').length).toBe(1);
	});

	it('drops a subscription the browser has thrown away', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		const gone: Sender = async () => ({ ok: false, status: 410, gone: true });

		expect(await runNotifierTick(db, INSIDE, gone)).toEqual({ sent: 0, failed: 0, dropped: 1 });
		expect(listSubscriptions(db, 'h1')).toEqual([]);
	});

	it('records the send against the Device, so a second Device still hears it', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1', 'mum', 'phone');
		const send = acceptAll();
		await runNotifierTick(db, INSIDE, send);

		subscribe('https://push.example.com/2', 'mum', 'tablet');
		expect(await runNotifierTick(db, INSIDE + 60_000, send)).toEqual({ sent: 1, failed: 0, dropped: 0 });
		expect(send.calls.map((c) => c.endpoint)).toEqual([
			'https://push.example.com/1',
			'https://push.example.com/2'
		]);
	});

	it('keeps its record no longer than a day', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		await runNotifierTick(db, INSIDE, acceptAll());
		expect(pruneSent(db, INSIDE + 60_000)).toBe(0);
		expect(pruneSent(db, INSIDE + 25 * 60 * 60_000)).toBe(1);
	});
});

describe('the Notices a Target brings round', () => {
	/* Fed 10:00–10:20 against a three-hour interval, so the Feed is due at 13:00;
	   woke at 11:00 against a two-hour Wake Window, so that is up at 13:00 too. */
	const FED = Date.parse('2026-08-17T10:00:00Z');
	const DUE = Date.parse('2026-08-17T13:00:00Z');

	beforeEach(() => {
		target('t-feed', 'feed', 3 * 3600, 'feed_start');
		target('t-sleep', 'sleep', 2 * 3600, 'sleep_end');
		subscribe('https://push.example.com/1');
	});

	it('says a Feed is due, in the Member\'s own language and about the right Entry', async () => {
		closedEntry('f1', 'breast_feed', FED, FED + 20 * 60_000);
		const send = acceptAll();
		expect(await runNotifierTick(db, DUE, send)).toEqual({ sent: 1, failed: 0, dropped: 0 });

		const payload = JSON.parse(send.calls[0].payload);
		expect(payload.title).toBe('Mahlzeit fällig');
		expect(payload.body).toContain('Lina');
		expect(payload.tag).toBe('feed:f1');
	});

	it('says the Wake Window is up, anchored to the Sleep that opened it', async () => {
		closedEntry('s1', 'sleep', Date.parse('2026-08-17T10:00:00Z'), Date.parse('2026-08-17T11:00:00Z'));
		const send = acceptAll();
		await runNotifierTick(db, DUE, send);
		expect(JSON.parse(send.calls[0].payload).tag).toBe('sleep:s1');
	});

	it('waits for the offset the Household stated, and never says it twice', async () => {
		closedEntry('f1', 'breast_feed', FED, FED + 20 * 60_000);
		setOffsets(15 * 60, 0);
		const send = acceptAll();

		expect(await runNotifierTick(db, DUE - 20 * 60_000, send)).toEqual({ sent: 0, failed: 0, dropped: 0 });
		expect(await runNotifierTick(db, DUE - 15 * 60_000, send)).toEqual({ sent: 1, failed: 0, dropped: 0 });
		expect(await runNotifierTick(db, DUE - 14 * 60_000, send)).toEqual({ sent: 0, failed: 0, dropped: 0 });
		expect(JSON.parse(send.calls[0].payload).body).toContain('15');
	});

	it('says nothing at all when the Household has switched that Notice off', async () => {
		closedEntry('f1', 'breast_feed', FED, FED + 20 * 60_000);
		closedEntry('s1', 'sleep', Date.parse('2026-08-17T10:00:00Z'), Date.parse('2026-08-17T11:00:00Z'));
		setOffsets(null, null);
		expect(await runNotifierTick(db, DUE, acceptAll())).toEqual({ sent: 0, failed: 0, dropped: 0 });
	});

	/* Two Notices can be anchored to the same Entry at the same moment — a bottle
	   nearly out is also the Feed the next interval is measured from — so the
	   kind is part of the once-per key. */
	it('keeps the bottle Notice and the Feed Notice from silencing each other', async () => {
		openBottle('f1', Date.parse('2026-08-17T13:00:00Z'));
		const send = acceptAll();
		/* 13:55: the bottle is nearly out and its Feed is still running. */
		await runNotifierTick(db, INSIDE, send);
		expect(send.calls.map((c) => JSON.parse(c.payload).tag)).toEqual(['bottle:f1']);

		/* The Feed ends at 14:00 with the bottle, and the interval is up at 16:00. */
		db.prepare('UPDATE entries SET ended_at = ? WHERE id = ?').run(Date.parse('2026-08-17T14:00:00Z'), 'f1');
		await runNotifierTick(db, Date.parse('2026-08-17T16:00:00Z'), send);
		expect(send.calls.map((c) => JSON.parse(c.payload).tag)).toEqual(['bottle:f1', 'feed:f1']);
	});
});

describe('a Notice that has stopped being true', () => {
	/* The whole point of the deadline: a push service holds what it cannot
	   deliver, and a phone that surfaces twenty minutes later must not be told
	   about a bottle whose Feed has already ended. */
	it('asks the push service to hold a bottle Notice no longer than the bottle', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		const send = acceptAll();
		await runNotifierTick(db, INSIDE, send);
		/* 13:55, due at 14:00. */
		expect(send.calls[0].ttlSeconds).toBe(300);
		expect(JSON.parse(send.calls[0].payload).until).toBe(Date.parse('2026-08-17T14:00:00Z'));
	});

	it('is never planned for a Feed somebody stopped', async () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		db.prepare('UPDATE entries SET ended_at = ? WHERE id = ?').run(
			Date.parse('2026-08-17T13:52:00Z'),
			'f1'
		);
		expect(planNotices(db, INSIDE)).toEqual([]);
		expect(await runNotifierTick(db, INSIDE, acceptAll())).toEqual({ sent: 0, failed: 0, dropped: 0 });
	});
});

describe('the wording', () => {
	it('falls back to English for a Member who has never chosen', () => {
		expect(noticeText('bottle', 'Lina', 10, null).title).toBe('Bottle nearly out');
		expect(noticeText('bottle', 'Lina', 10, 'fr').title).toBe('Bottle nearly out');
	});

	it('says nearly out rather than expired — the Household\'s number, not a verdict', () => {
		for (const locale of [null, 'de', 'ro']) {
			const text = noticeText('bottle', 'Lina', 10, locale);
			expect(`${text.title} ${text.body}`.toLowerCase()).not.toMatch(/expire|abgelaufen|verdorben|stricat/);
		}
	});

	/* Two sentences per Notice, because *due in ten minutes* and *due now* are
	   different facts and one rounded sentence would have to lie about one of
	   them (ADR-0031). */
	it('says the stated offset out loud, and drops it when there is none', () => {
		expect(noticeText('feed', 'Lina', 10, 'en').body).toBe("Lina's next feed is due in 10 minutes.");
		expect(noticeText('feed', 'Lina', 0, 'en').body).toBe("Lina's next feed is due.");
		expect(noticeText('sleep', 'Lina', 15, 'en').body).toContain('15 minutes past');
		expect(noticeText('sleep', 'Lina', 0, 'en').body).not.toContain('0');
	});

	it('names the Baby in every Notice, in the language that Member reads', () => {
		for (const kind of ['bottle', 'feed', 'sleep'] as const) {
			for (const locale of ['en', 'de', 'ro']) {
				expect(noticeText(kind, 'Lina', 5, locale).body).toContain('Lina');
			}
		}
	});
});
