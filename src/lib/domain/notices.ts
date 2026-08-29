/* What the deployment wakes a Device to say, and exactly when. ADR-0031.

   Three Notices, one fold. A Notice is never a new number: it is a Target the
   Household already stated, reached — the bottle nearly out (ADR-0029), the
   Feed Interval up, the Wake Window up. Which is why this file computes
   nothing of its own and imports `dueInstant`, `bottleTargetOf` and
   `anchorEntry` unchanged from `$domain/targets`; the notifier and the sticky
   header can only ever agree.

   Two properties every Notice has, and both exist because a push travels
   through somebody else's servers and arrives when it arrives:

     - It is anchored to an **Entry**, so "said once" survives a restart and
       needs no clock. The bottle, the previous Feed, the last Sleep.
     - It has an **`until`**, the instant it stops being true. That is the
       push's TTL, so a push service holding a queued message drops it rather
       than popping *bottle nearly out* over a Feed that was stopped twenty
       minutes ago, and it is re-checked in the worker before anything is
       shown. A late notification is not a notification, it is a lie. */

import { bottleTargetOf, bottlesNearingEnd, dueInstant, feedDueInstant, nightPeriodOf, anchorEntry } from './targets';
import type { NightPeriod } from './time';
import { MAX_NOTICE_OFFSET_S, type Entry, type Target } from './types';

export const NOTICE_KINDS = ['bottle', 'feed', 'sleep'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface Notice {
	kind: NoticeKind;
	baby_id: string;
	/** The Entry this Notice is about, and with `kind` the key that keeps it
	    from being said twice. */
	entry_id: string;
	/** How far from the due instant this Notice is, in whole minutes, and
	    always the offset the Household stated: the text says it out loud rather
	    than making someone open the app to find out. Zero for a Notice that
	    lands on the due instant itself. */
	offset_minutes: number;
	/** The instant it stops being true. */
	until: number;
}

/** How long a Feed or Sleep Notice stays worth saying once it has come true.

    A Feed that is due stays due, and a Baby past her Wake Window stays past
    it — so without a window the notifier would have to decide *by hand* not to
    repeat itself forever, and the once-per-Entry record is pruned by age
    (ADR-0030). A fifteen-minute window makes the arithmetic say it instead: a
    Notice nobody could be woken for inside a quarter of an hour has stopped
    being the reminder it was and becomes the next Feed's problem.

    Not a setting. What *is* a setting is when the window opens (§ the
    offsets), which is the question a Household actually has an opinion
    about. */
export const NOTICE_WINDOW_MS = 15 * 60_000;

/** How far from the due instant each Notice is said, stated by the Household
    (ADR-0031). Seconds, never negative, and `null` means *do not say it*.

    The two run in opposite directions because the two facts do: a Feed is
    worth a head start, and a Wake Window that has just this second run out is
    not yet worth waking anyone for. */
export interface NoticeOffsets {
	/** Before the Feed Interval is up. */
	feed_notice_s: number | null;
	/** After the Wake Window is up. */
	sleep_notice_s: number | null;
}

/** Everything about the Household this fold reads: the two offsets, and the
    hours a Feed's due instant is computed against.

    The whole Household row satisfies it, which is what the notifier passes —
    so the Night Period cannot be applied on the phone and forgotten on the
    server (ADR-0032). */
export interface NoticeHousehold extends NoticeOffsets {
	night_start: string | null;
	day_start: string;
	zone: string;
}

export { MAX_NOTICE_OFFSET_S };

/** A stated offset, read from anywhere: a Revision field, a form input, a
    column. Anything that is not a number is `null` — *do not say it* — which
    is the quiet side, and the side an older or newer client should land on.

    A negative offset would move a Notice to the wrong side of its own Target,
    and both edges are held here rather than at the two storage edges, so the
    replica and the server can only ever agree about what was stated. */
export function noticeOffset(value: unknown): number | null {
	if (value == null || value === '') return null;
	const seconds = Number(value);
	if (!Number.isFinite(seconds)) return null;
	return Math.min(MAX_NOTICE_OFFSET_S, Math.max(0, Math.round(seconds)));
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

const minutes = (ms: number) => Math.round(ms / 60_000);

function targetFor(targets: Target[], babyId: string, activity: Target['activity']): Target | null {
	return (
		targets.find((t) => t.baby_id === babyId && t.activity === activity && t.deleted_at == null) ?? null
	);
}

/** Every Baby the given Entries speak about. Derived rather than passed: a Baby
    with nothing logged has no anchor, so there is nothing to be due. */
function babyIds(entries: Entry[]): string[] {
	const seen = new Set<string>();
	for (const e of entries) if (live(e)) seen.add(e.baby_id);
	return [...seen];
}

/** The bottles inside their last stretch — ADR-0029's fold, given an `until`.

    `until` is the bottle's own due instant, which is the moment the server ends
    the Feed (ADR-0017). Past it there is no bottle left to offer, so a push
    that has not arrived yet must never arrive at all. */
function bottleNotices(entries: Entry[], targets: Target[], now: number): Notice[] {
	const notices: Notice[] = [];
	for (const id of bottlesNearingEnd(entries, targets, now)) {
		const entry = entries.find((e) => e.id === id);
		if (!entry) continue;
		const target = bottleTargetOf(
			targets.filter((t) => t.baby_id === entry.baby_id),
			entry.baby_id
		);
		const dueAt = dueInstant(target, entry.occurred_at);
		notices.push({
			kind: 'bottle',
			baby_id: entry.baby_id,
			entry_id: entry.id,
			offset_minutes: minutes(dueAt - now),
			until: dueAt
		});
	}
	return notices;
}

/** The Feed Interval, come round.

    Silent while a Feed is running: *a feed is due* said to someone who is
    feeding her is noise, and a bottle stays open until it is stopped or its
    Life ends it, so this covers the whole of a Combined Feed too. Anchored to
    the previous Feed — the same Entry the header measures from — so the next
    Feed logged replaces the anchor and the Notice comes round again. */
function feedNotices(
	entries: Entry[],
	targets: Target[],
	leadS: number | null,
	night: NightPeriod | null,
	zone: string,
	now: number
): Notice[] {
	if (leadS == null) return [];
	const lead = Math.max(0, leadS) * 1000;
	const notices: Notice[] = [];
	for (const babyId of babyIds(entries)) {
		const mine = entries.filter((e) => live(e) && e.baby_id === babyId);
		const target = targetFor(targets, babyId, 'feed');
		if (!target || target.duration_s <= 0) continue;
		if (mine.some((e) => e.ended_at == null && (e.type === 'breast_feed' || e.type === 'bottle_feed')))
			continue;
		const anchor = anchorEntry({ anchor: 'feed_start' }, mine);
		if (!anchor) continue;
		/* Clamped to half the interval, exactly as the Bottle Chime's lead is: a
		   Household that typed a short interval and a long lead is asking to be
		   told a Feed is due while she is still on the last one. */
		const at =
			feedDueInstant(target, anchor.occurred_at, night, zone, now) -
			Math.min(lead, (target.duration_s * 1000) / 2);
		if (now < at || now >= at + NOTICE_WINDOW_MS) continue;
		notices.push({
			kind: 'feed',
			baby_id: babyId,
			entry_id: anchor.id,
			offset_minutes: minutes(Math.min(lead, (target.duration_s * 1000) / 2)),
			until: at + NOTICE_WINDOW_MS
		});
	}
	return notices;
}

/** The Wake Window, run out.

    Silent while she is asleep — a Wake Window is *time not covered by a Sleep*
    (spec §8.5), so it simply does not apply — and anchored to the Sleep it is
    measured from, which is the Entry whose end started the window. */
function sleepNotices(entries: Entry[], targets: Target[], graceS: number | null, now: number): Notice[] {
	if (graceS == null) return [];
	const grace = Math.max(0, graceS) * 1000;
	const notices: Notice[] = [];
	for (const babyId of babyIds(entries)) {
		const mine = entries.filter((e) => live(e) && e.baby_id === babyId);
		const target = targetFor(targets, babyId, 'sleep');
		if (!target || target.duration_s <= 0) continue;
		if (mine.some((e) => e.type === 'sleep' && e.ended_at == null)) continue;
		const anchor = anchorEntry({ anchor: 'sleep_end' }, mine);
		if (!anchor || anchor.ended_at == null) continue;
		const at = dueInstant(target, anchor.ended_at) + grace;
		if (now < at || now >= at + NOTICE_WINDOW_MS) continue;
		notices.push({
			kind: 'sleep',
			baby_id: babyId,
			entry_id: anchor.id,
			offset_minutes: minutes(grace),
			until: at + NOTICE_WINDOW_MS
		});
	}
	return notices;
}

/** Everything true right now, for every Baby in the Household — not just the
    one whose name is at the top of somebody's screen.

    Pure, so the notifier's only remaining job is delivery: who is subscribed,
    what language they read, and the record that keeps a Notice from being said
    twice (ADR-0030). */
export function liveNotices(
	entries: Entry[],
	targets: Target[],
	household: NoticeHousehold,
	now: number
): Notice[] {
	return [
		...bottleNotices(entries, targets, now),
		...feedNotices(
			entries,
			targets,
			household.feed_notice_s,
			nightPeriodOf(household),
			household.zone,
			now
		),
		...sleepNotices(entries, targets, household.sleep_notice_s, now)
	];
}
