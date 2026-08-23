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
function acceptAll(): Sender & { calls: Array<{ endpoint: string; payload: string }> } {
	const calls: Array<{ endpoint: string; payload: string }> = [];
	const sender = (async (subscription: StoredSubscription, payload: string) => {
		calls.push({ endpoint: subscription.endpoint, payload });
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

	it('names the bottle and the Devices once its last ten minutes have begun', () => {
		openBottle('f1');
		subscribe('https://push.example.com/1');
		expect(planNotices(db, Date.parse('2026-08-17T13:40:00Z'))).toEqual([]);
		const notices = planNotices(db, INSIDE);
		expect(notices.map((n) => n.entry.id)).toEqual(['f1']);
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

describe('the wording', () => {
	it('falls back to English for a Member who has never chosen', () => {
		expect(noticeText('Lina', null).title).toBe('Bottle nearly out');
		expect(noticeText('Lina', 'fr').title).toBe('Bottle nearly out');
	});

	it('says nearly out rather than expired — the Household\'s number, not a verdict', () => {
		for (const locale of [null, 'de', 'ro']) {
			const text = noticeText('Lina', locale);
			expect(`${text.title} ${text.body}`.toLowerCase()).not.toMatch(/expire|abgelaufen|verdorben|stricat/);
		}
	});
});
