/* The notifier: what gets said, to which Devices, and exactly once (ADR-0030,
   ADR-0031).

   This is the server's half of three reminders a phone that is awake with the
   app open would give by itself — a bottle nearly out, a Feed due, a Wake
   Window run out. At 3am the phone is none of those things, so the instants the
   Household's own Targets compute are reached here on a timer and delivered as
   pushes.

   None of them is decided twice: `liveNotices` is the domain fold, imported
   unchanged, and it is the only thing that knows what is due. What is
   server-only is *delivery* — who is subscribed, what language they read, the
   record that keeps a Notice from being said twice, and the deadline that keeps
   a queued push from arriving after it has stopped being true. */

import { liveNotices, type Notice, type NoticeKind } from '$domain/notices';
import * as m from '$lib/paraglide/messages';
import type { Db } from './db';
import { getHousehold, listTargets, noticeEntries } from './store';
import { sendPush, type PushResult, type PushSubscription, type VapidKeys } from './webpush';

/** Kept in step with nothing: the record only has to outlive the window it
    guards, and a day is a generous margin for a server that was asleep. */
const SENT_TTL_MS = 24 * 60 * 60_000;

/** How far back a tick reads. Every anchor a Notice can hang on is either an
    open session — read whatever its age — or an Entry inside the last stretch
    of a Target, and nothing in the age tables comes near a day. */
const LOOKBACK_MS = 24 * 60 * 60_000;

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

export interface PlannedNotice {
	notice: Notice;
	babyName: string;
	subscriptions: StoredSubscription[];
}

function babyNames(db: Db, householdId: string): Map<string, string> {
	const rows = db
		.prepare('SELECT id, name FROM babies WHERE household_id = ? AND deleted_at IS NULL')
		.all(householdId) as Array<{ id: string; name: string }>;
	return new Map(rows.map((r) => [r.id, r.name]));
}

/** Which Devices are owed which Notice, right now.

    Households with no subscription at all are never looked at, which is the
    common case on a self-hosted Book and keeps the tick free. */
export function planNotices(db: Db, now: number): PlannedNotice[] {
	const households = (
		db.prepare('SELECT DISTINCT household_id AS id FROM push_subscriptions').all() as Array<{ id: string }>
	).map((r) => r.id);

	const planned: PlannedNotice[] = [];
	for (const householdId of households) {
		const subscriptions = listSubscriptions(db, householdId);
		if (subscriptions.length === 0) continue;

		const household = getHousehold(db, householdId);
		if (!household) continue;

		const notices = liveNotices(
			noticeEntries(db, householdId, now - LOOKBACK_MS),
			listTargets(db, householdId),
			household,
			now
		);
		if (notices.length === 0) continue;

		const names = babyNames(db, householdId);
		for (const notice of notices) {
			const unsent = subscriptions.filter((s) => !alreadySent(db, notice, s.endpoint));
			if (unsent.length === 0) continue;
			planned.push({ notice, babyName: names.get(notice.baby_id) ?? '', subscriptions: unsent });
		}
	}
	return planned;
}

function alreadySent(db: Db, notice: Notice, endpoint: string): boolean {
	return (
		db
			.prepare('SELECT 1 FROM push_sent WHERE entry_id = ? AND kind = ? AND endpoint = ?')
			.get(notice.entry_id, notice.kind, endpoint) != null
	);
}

function recordSent(db: Db, notice: Notice, endpoint: string, now: number): void {
	db.prepare(
		'INSERT OR REPLACE INTO push_sent (entry_id, kind, endpoint, sent_at) VALUES (?,?,?,?)'
	).run(notice.entry_id, notice.kind, endpoint, now);
}

export function pruneSent(db: Db, now: number): number {
	return db.prepare('DELETE FROM push_sent WHERE sent_at < ?').run(now - SENT_TTL_MS).changes;
}

/** What the Device is told, in the language that Member reads.

    The wording is the row's, not a new vocabulary: the bottle is *nearly out*,
    the Feed is *due*, the Wake Window is *up* — each says the Household's own
    number has come round and none of them says anything the app decided
    (ADR-0016). The Baby's name is in it because a notification with no name is
    a notification you have to open to understand — and it is safe to put there
    precisely because the payload is encrypted to the Device.

    Each of the two stated offsets gets its own sentence rather than a single
    one that quietly rounds: *due in 10 minutes* and *due now* are different
    facts, and so are *awake past her window* and *her window is up*. */
export function noticeText(
	kind: NoticeKind,
	babyName: string,
	offsetMinutes: number,
	locale: string | null
): { title: string; body: string } {
	const known = locale === 'de' || locale === 'ro' ? locale : 'en';
	const options = { locale: known } as const;
	const name = babyName;
	if (kind === 'feed') {
		return {
			title: m.push_feed_title({}, options),
			body:
				offsetMinutes > 0
					? m.push_feed_body_soon({ name, minutes: offsetMinutes }, options)
					: m.push_feed_body_now({ name }, options)
		};
	}
	if (kind === 'sleep') {
		return {
			title: m.push_sleep_title({}, options),
			body:
				offsetMinutes > 0
					? m.push_sleep_body_late({ name, minutes: offsetMinutes }, options)
					: m.push_sleep_body_now({ name }, options)
		};
	}
	return {
		title: m.push_bottle_title({}, options),
		body: m.push_bottle_body({ name }, options)
	};
}

export type Sender = (
	subscription: StoredSubscription,
	payload: string,
	/** How long the push service may hold it: what is left of the Notice, never
	    a flat quarter of an hour. A queued push that arrives after `until` would
	    announce a bottle whose Feed has already ended (ADR-0031). */
	ttlSeconds: number
) => Promise<PushResult>;

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

	for (const planned of notices) {
		const { notice } = planned;
		/* Seconds, rounded up and never zero: a TTL of 0 asks the push service to
		   deliver now or not at all, which is the right shape but throws away the
		   last second of a Notice that is still true. */
		const ttlSeconds = Math.max(1, Math.ceil((notice.until - now) / 1000));
		const jobs = planned.subscriptions.map(async (subscription) => {
			const text = noticeText(notice.kind, planned.babyName, notice.offset_minutes, subscription.locale);
			const payload = JSON.stringify({
				...text,
				tag: `${notice.kind}:${notice.entry_id}`,
				/* The worker's own deadline, because a push service is free to be
				   generous with a TTL and a phone can be handed a message it queued
				   before going into doze. */
				until: notice.until
			});
			const outcome = await send(subscription, payload, ttlSeconds);
			if (outcome.ok) {
				recordSent(db, notice, subscription.endpoint, now);
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
	return (subscription, payload, ttlSeconds) =>
		sendPush(subscription, payload, { keys, subject, now: now(), ttlSeconds });
}

/** Every thirty seconds, because ten minutes of warning that arrives nine and a
    half minutes early is the same notification, and the query costs nothing
    when nobody is subscribed. It is also the whole of the window in which a
    Feed stopped on somebody's phone can still be announced as running — the
    plan is re-read from the log on every tick. Unref'd like the backup timer:
    it must never be the reason the process will not exit. */
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
