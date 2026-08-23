/* The notifier: what gets said, to which Devices, and exactly once (ADR-0030).

   This is the server's half of the Bottle Chime. The in-app chime can only
   sound on a phone that is awake with the app open; ten minutes before a
   bottle's Life runs out is very often neither. So the same instant — the one
   `dueInstant` computes, from the same synced Target — is reached here on a
   timer and delivered as a push.

   Nothing about which bottle is nearly out is decided twice: `bottlesNearingEnd`
   is the domain fold the client uses, imported unchanged. What is server-only is
   *delivery* — who is subscribed, what language they read, and the record that
   keeps one bottle from being announced twice. */

import { bottlesNearingEnd } from '$domain/targets';
import type { Entry } from '$domain/types';
import * as m from '$lib/paraglide/messages';
import type { Db } from './db';
import { listTargets, liveSessions } from './store';
import { sendPush, type PushResult, type PushSubscription, type VapidKeys } from './webpush';

/** Kept in step with nothing: the record only has to outlive the ten minutes it
    guards, and a day is a generous margin for a server that was asleep. */
const SENT_TTL_MS = 24 * 60 * 60_000;

export interface StoredSubscription extends PushSubscription {
	household_id: string;
	member_id: string;
	device_id: string;
	locale: string | null;
}

export interface SubscriptionInput {
	endpoint: string;
	p256dh: string;
	auth: string;
	householdId: string;
	memberId: string;
	deviceId: string;
	now: number;
}

/** One row per Device, keyed by the endpoint the browser minted. A Device that
    re-subscribes after a browser rotated its keys simply writes a new row; the
    old one dies at its first 410. */
export function saveSubscription(db: Db, input: SubscriptionInput): void {
	db.prepare(
		`INSERT INTO push_subscriptions (endpoint, household_id, member_id, device_id, p256dh, auth, created_at, last_ok_at)
		 VALUES (?,?,?,?,?,?,?,NULL)
		 ON CONFLICT(endpoint) DO UPDATE SET
		   household_id = excluded.household_id,
		   member_id    = excluded.member_id,
		   device_id    = excluded.device_id,
		   p256dh       = excluded.p256dh,
		   auth         = excluded.auth`
	).run(
		input.endpoint,
		input.householdId,
		input.memberId,
		input.deviceId,
		input.p256dh,
		input.auth,
		input.now
	);
}

export function deleteSubscription(db: Db, endpoint: string): number {
	return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes;
}

/** The one a Member may delete: their own. An endpoint is a client-supplied id,
    and one of those is never a capability (ADR-0020) — without the member_id
    here, anyone holding another Device's endpoint could silence it. */
export function deleteOwnSubscription(db: Db, endpoint: string, memberId: string): number {
	return db
		.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND member_id = ?')
		.run(endpoint, memberId).changes;
}

/** Signing out takes this phone's subscription with it: the session is gone, so
    nothing may keep speaking to the Device in the Household's name. */
export function deleteDeviceSubscriptions(db: Db, memberId: string, deviceId: string): number {
	return db
		.prepare('DELETE FROM push_subscriptions WHERE member_id = ? AND device_id = ?')
		.run(memberId, deviceId).changes;
}

/** Removal ends access, and a notification is access. */
export function deleteMemberSubscriptions(db: Db, memberId: string): number {
	return db.prepare('DELETE FROM push_subscriptions WHERE member_id = ?').run(memberId).changes;
}

export function listSubscriptions(db: Db, householdId: string): StoredSubscription[] {
	return db
		.prepare(
			`SELECT s.endpoint, s.household_id, s.member_id, s.device_id, s.p256dh, s.auth, mem.locale
			   FROM push_subscriptions s
			   JOIN members mem ON mem.id = s.member_id
			  WHERE s.household_id = ? AND mem.removed_at IS NULL
			  ORDER BY s.created_at`
		)
		.all(householdId) as StoredSubscription[];
}

export interface Notice {
	entry: Entry;
	babyName: string;
	subscriptions: StoredSubscription[];
}

function babyNames(db: Db, householdId: string): Map<string, string> {
	const rows = db
		.prepare('SELECT id, name FROM babies WHERE household_id = ? AND deleted_at IS NULL')
		.all(householdId) as Array<{ id: string; name: string }>;
	return new Map(rows.map((r) => [r.id, r.name]));
}

/** Which Devices are owed which notice, right now.

    Households with no subscription at all are never looked at, which is the
    common case on a self-hosted Book and keeps the tick free. */
export function planNotices(db: Db, now: number): Notice[] {
	const households = (
		db.prepare('SELECT DISTINCT household_id AS id FROM push_subscriptions').all() as Array<{ id: string }>
	).map((r) => r.id);

	const notices: Notice[] = [];
	for (const householdId of households) {
		const subscriptions = listSubscriptions(db, householdId);
		if (subscriptions.length === 0) continue;

		const open = liveSessions(db, householdId);
		const nearing = bottlesNearingEnd(open, listTargets(db, householdId), now);
		if (nearing.length === 0) continue;

		const names = babyNames(db, householdId);
		for (const id of nearing) {
			const entry = open.find((e) => e.id === id);
			if (!entry) continue;
			const unsent = subscriptions.filter((s) => !alreadySent(db, id, s.endpoint));
			if (unsent.length === 0) continue;
			notices.push({ entry, babyName: names.get(entry.baby_id) ?? '', subscriptions: unsent });
		}
	}
	return notices;
}

function alreadySent(db: Db, entryId: string, endpoint: string): boolean {
	return (
		db.prepare('SELECT 1 FROM push_sent WHERE entry_id = ? AND endpoint = ?').get(entryId, endpoint) !=
		null
	);
}

function recordSent(db: Db, entryId: string, endpoint: string, now: number): void {
	db.prepare('INSERT OR REPLACE INTO push_sent (entry_id, endpoint, sent_at) VALUES (?,?,?)').run(
		entryId,
		endpoint,
		now
	);
}

export function pruneSent(db: Db, now: number): number {
	return db.prepare('DELETE FROM push_sent WHERE sent_at < ?').run(now - SENT_TTL_MS).changes;
}

/** What the Device is told, in the language that Member reads.

    The wording is the row's, not a new vocabulary: the bottle is *nearly out*,
    which says the Household's own number is running down and says nothing about
    the milk (ADR-0016). The Baby's name is in it because a notification with no
    name is a notification you have to open to understand — and it is safe to
    put there precisely because the payload is encrypted to the Device. */
export function noticeText(babyName: string, locale: string | null): { title: string; body: string } {
	const known = locale === 'de' || locale === 'ro' ? locale : 'en';
	return {
		title: m.push_bottle_title({}, { locale: known }),
		body: m.push_bottle_body({ name: babyName }, { locale: known })
	};
}

export type Sender = (subscription: StoredSubscription, payload: string) => Promise<PushResult>;

export interface TickResult {
	sent: number;
	failed: number;
	dropped: number;
}

/** One pass. Every send is independent: a Device whose push service is having a
    bad minute costs the others nothing, and only a *delivered* notice is
    recorded as said — so a failure is retried on the next tick, and only while
    the bottle is still inside its last ten minutes. */
export async function runNotifierTick(db: Db, now: number, send: Sender): Promise<TickResult> {
	const result: TickResult = { sent: 0, failed: 0, dropped: 0 };
	const notices = planNotices(db, now);

	for (const notice of notices) {
		const jobs = notice.subscriptions.map(async (subscription) => {
			const text = noticeText(notice.babyName, subscription.locale);
			const payload = JSON.stringify({ ...text, tag: `bottle:${notice.entry.id}` });
			const outcome = await send(subscription, payload);
			if (outcome.ok) {
				recordSent(db, notice.entry.id, subscription.endpoint, now);
				db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?').run(
					now,
					subscription.endpoint
				);
				result.sent += 1;
			} else if (outcome.gone) {
				deleteSubscription(db, subscription.endpoint);
				result.dropped += 1;
			} else {
				result.failed += 1;
			}
		});
		await Promise.all(jobs);
	}

	pruneSent(db, now);
	return result;
}

/** The live sender: the tick above, wired to real push services. */
export function pushSender(keys: VapidKeys, subject: string, now: () => number): Sender {
	return (subscription, payload) =>
		sendPush(subscription, payload, { keys, subject, now: now() });
}

/** Every thirty seconds, because ten minutes of warning that arrives nine and a
    half minutes early is the same notification, and the query costs nothing
    when nobody is subscribed. Unref'd like the backup timer: it must never be
    the reason the process will not exit. */
const TICK_MS = 30_000;

export function startNotifier(
	db: Db,
	options: { keys: VapidKeys; subject: string; log?: (line: string) => void }
): () => void {
	const log = options.log ?? (() => {});
	const send = pushSender(options.keys, options.subject, () => Date.now());
	let running = false;

	const tick = async () => {
		if (running) return;
		running = true;
		try {
			const result = await runNotifierTick(db, Date.now(), send);
			if (result.sent > 0 || result.dropped > 0) {
				log(`push: ${result.sent} sent, ${result.failed} failed, ${result.dropped} dropped`);
			}
		} catch (error) {
			/* A notifier that throws must not take the process with it: nothing here
			   is the app's job, and the log is where an operator looks. */
			log(`push: tick failed — ${(error as Error).message}`);
		} finally {
			running = false;
		}
	};

	const timer = setInterval(() => void tick(), TICK_MS);
	timer.unref?.();
	return () => clearInterval(timer);
}
