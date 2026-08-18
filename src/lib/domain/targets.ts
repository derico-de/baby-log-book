/* Schedules. ADR-0006, spec §6.5 and §8.4.

   A schedule in v1 is one number per activity per Baby and no machinery: a
   Target is stated, never learned, and nothing is ever materialised. Every
   due figure below is a display-time fold.

   The due-instant computation lives HERE, in one function that the sticky
   header calls — so the v2 notifier calls the same function rather than
   reimplementing it, which is the whole reason push notifications need no
   schema change (spec §2). */

import { dayBucketOf, ageInMonths, withinLastDay, MS } from './time';
import type { Activity, Entry, NappyPayload, Target } from './types';
import { isFeed } from './entries';

/** The age table (spec §6.5) — seeds only, never re-applied. After twelve
    months solids take over and a feed target stops meaning anything. */
const FEED_BANDS: Array<{ untilMonths: number; seconds: number }> = [
	{ untilMonths: 3, seconds: 3 * 3600 },
	{ untilMonths: 6, seconds: 3.5 * 3600 },
	{ untilMonths: 12, seconds: 4 * 3600 }
];

/** The Bottle Life has no age table: how long the milk in a bottle stays good
    does not depend on how old she is. One band, so `typicalFor` and
    `seedTargets` need no special case, and the value is the household's to
    change (ADR-0016). */
const BOTTLE_BANDS: Array<{ untilMonths: number; seconds: number }> = [
	{ untilMonths: Infinity, seconds: 3600 }
];

const SLEEP_BANDS: Array<{ untilMonths: number; seconds: number }> = [
	{ untilMonths: 1, seconds: 45 * 60 },
	{ untilMonths: 3, seconds: 75 * 60 },
	{ untilMonths: 6, seconds: 2 * 3600 },
	{ untilMonths: 9, seconds: 2.5 * 3600 },
	{ untilMonths: 12, seconds: 3 * 3600 },
	{ untilMonths: 18, seconds: 4 * 3600 },
	{ untilMonths: Infinity, seconds: 5 * 3600 }
];

/** The current band's typical value, rendered as a static hint beside the
    field in Schedule settings. No state, no dismissal flag to sync, and never
    on the home screen. */
export function typicalFor(activity: Activity, ageMonths: number): number | null {
	const bands = activity === 'feed' ? FEED_BANDS : activity === 'bottle' ? BOTTLE_BANDS : SLEEP_BANDS;
	for (const band of bands) if (ageMonths < band.untilMonths) return band.seconds;
	return null;
}

export const ANCHOR_FOR: Record<Activity, Target['anchor']> = {
	feed: 'feed_start',
	sleep: 'sleep_end',
	bottle: 'bottle_start'
};

export const ACTIVITIES = ['feed', 'sleep', 'bottle'] as const;

/** Seeded once at Baby creation, never re-derived and never averaged from the
    log (ADR-0006). */
export function seedTargets(birthDate: string, at: number, zone: string): Array<Omit<Target, 'id' | 'household_id' | 'baby_id' | 'deleted_at'>> {
	const months = ageInMonths(birthDate, at, zone);
	const seeds: Array<Omit<Target, 'id' | 'household_id' | 'baby_id' | 'deleted_at'>> = [];
	for (const activity of ACTIVITIES) {
		const seconds = typicalFor(activity, months);
		if (seconds == null) continue;
		seeds.push({ activity, duration_s: seconds, anchor: ANCHOR_FOR[activity] });
	}
	return seeds;
}

/** THE due-instant computation. A Target is a duration plus an anchor, which
    is enough to compute a due instant — and because Targets sync as
    revisions, every Device computes the *same* instant without coordinating. */
export function dueInstant(target: Target, anchorAt: number): number {
	return anchorAt + target.duration_s * 1000;
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

/** The instant a Target measures from: the previous Feed's start, the last
    Sleep's end, or the start of the bottle that is still open. Three anchors,
    because "she sleeps every 3h" is not a Wake Window — how long she stays
    comfortably awake is a different anchor, and getting it wrong would have
    made the sleep number useless. */
export function anchorInstant(target: Target, entries: Entry[]): number | null {
	if (target.anchor === 'bottle_start') {
		/* The bottle still open, not the last one poured. A bottle that has been
		   stopped is a bottle nobody is going to offer again, so it has no life
		   left to count; two open at once is a Combined Feed, and the older of
		   them is the one running out first. */
		let earliest: number | null = null;
		for (const e of entries) {
			if (!live(e) || e.type !== 'bottle_feed' || e.ended_at != null) continue;
			if (earliest == null || e.occurred_at < earliest) earliest = e.occurred_at;
		}
		return earliest;
	}
	if (target.anchor === 'feed_start') {
		let latest: number | null = null;
		for (const e of entries) {
			if (!live(e) || !isFeed(e.type)) continue;
			if (latest == null || e.occurred_at > latest) latest = e.occurred_at;
		}
		return latest;
	}
	let latest: number | null = null;
	for (const e of entries) {
		if (!live(e) || e.type !== 'sleep' || e.ended_at == null) continue;
		if (latest == null || e.ended_at > latest) latest = e.ended_at;
	}
	return latest;
}

/** The Bottle Life a Household has stated, or the seeded hour if this Baby
    predates the field. Synthetic, never written: a Target that only exists
    because nobody has changed it is still a display-time fold (ADR-0006). */
export function bottleTargetOf(targets: Target[], babyId: string): Target {
	const stored = targets.find((t) => t.activity === 'bottle' && t.deleted_at == null);
	if (stored) return stored;
	return {
		id: '',
		household_id: '',
		baby_id: babyId,
		activity: 'bottle',
		duration_s: typicalFor('bottle', 0) ?? 3600,
		anchor: 'bottle_start',
		deleted_at: null
	};
}

export interface BottleLife {
	startedAt: number;
	dueAt: number;
	/** Clamped at zero, so the countdown never reads as a negative number. */
	remainingMs: number;
	past: boolean;
	pastMs: number | null;
}

/** The countdown on one started bottle, computed for the row that shows it.

    Per row rather than per Baby, because a Combined Feed can have two bottles
    open at once and a single figure could not say which one it meant.

    Null once the Feed has an end: the app counts the life of a bottle someone
    might still offer, and a stopped Feed is not that. It counts from the
    Feed's start, which is the only instant the model has — a bottle poured
    earlier, or one that came back out of the fridge, reads *younger* here than
    the milk really is (ADR-0016). */
export function bottleLife(entry: Entry, target: Target, now: number): BottleLife | null {
	if (entry.type !== 'bottle_feed' || entry.ended_at != null || !live(entry)) return null;
	if (target.duration_s <= 0) return null;
	const dueAt = dueInstant(target, entry.occurred_at);
	const remaining = dueAt - now;
	return {
		startedAt: entry.occurred_at,
		dueAt,
		remainingMs: Math.max(0, remaining),
		past: remaining < 0,
		pastMs: remaining < 0 ? -remaining : null
	};
}

export interface FeedHeader {
	lastAt: number | null;
	elapsedMs: number | null;
	/** True past a day: the figure has stopped being a number anyone reads, so
	    the header prints the absolute time instead. */
	absolute: boolean;
	dueAt: number | null;
	remainingMs: number | null;
	overdue: boolean;
	overdueMs: number | null;
}

export interface SleepHeader {
	/** The running Sleep, if there is one — the Live Session everyone's Device
	    can see. */
	running: Entry | null;
	asleepMs: number | null;
	/** Awake time is "time not covered by a Sleep", so a Sleep Feed does not
	    make her awake (spec §8.5). Null while a Sleep runs: the Wake Window is
	    simply not shown when it cannot apply. */
	awakeMs: number | null;
	dueAt: number | null;
	remainingMs: number | null;
	overdue: boolean;
	overdueMs: number | null;
}

export interface HeaderState {
	feed: FeedHeader;
	sleep: SleepHeader;
	nappies: { total: number; pee: number; poop: number };
}

export interface HeaderInput {
	entries: Entry[];
	targets: Target[];
	now: number;
	dayStart: string;
	zone: string;
	/** Required, and not defaulted: multi-baby is in the data model from day
	    one, and a header that guessed which Baby it was about would report a
	    sibling's Feed as this one's. */
	babyId: string;
}

function targetFor(targets: Target[], activity: Activity): Target | null {
	return targets.find((t) => t.activity === activity && t.deleted_at == null) ?? null;
}

/** Everything the sticky header prints, computed from the replica on every
    paint. Nothing here is stored and nothing here is written. */
export function headerState(input: HeaderInput): HeaderState {
	const { now, dayStart, zone, babyId } = input;
	const mine = input.entries.filter((e) => live(e) && e.baby_id === babyId);

	const feedTarget = targetFor(input.targets, 'feed');
	const sleepTarget = targetFor(input.targets, 'sleep');

	/* --- feeds: anchored by their start, always counting ----------------- */
	const lastFeedAt = anchorInstant({ anchor: 'feed_start' } as Target, mine);
	const feed: FeedHeader = {
		lastAt: lastFeedAt,
		elapsedMs: lastFeedAt == null ? null : now - lastFeedAt,
		absolute: lastFeedAt != null && !withinLastDay(lastFeedAt, now),
		dueAt: null,
		remainingMs: null,
		overdue: false,
		overdueMs: null
	};
	if (lastFeedAt != null && feedTarget) {
		feed.dueAt = dueInstant(feedTarget, lastFeedAt);
		const remaining = feed.dueAt - now;
		feed.remainingMs = Math.max(0, remaining);
		feed.overdue = remaining < 0;
		feed.overdueMs = remaining < 0 ? -remaining : null;
	}

	/* --- sleep: defined by its end -------------------------------------- */
	const running =
		mine
			.filter((e) => e.type === 'sleep' && e.ended_at == null)
			.sort((a, b) => a.occurred_at - b.occurred_at)[0] ?? null;

	const sleep: SleepHeader = {
		running,
		asleepMs: running ? now - running.occurred_at : null,
		awakeMs: null,
		dueAt: null,
		remainingMs: null,
		overdue: false,
		overdueMs: null
	};
	if (!running) {
		const lastSleepEnd = anchorInstant({ anchor: 'sleep_end' } as Target, mine);
		if (lastSleepEnd != null) {
			sleep.awakeMs = now - lastSleepEnd;
			if (sleepTarget) {
				sleep.dueAt = dueInstant(sleepTarget, lastSleepEnd);
				const remaining = sleep.dueAt - now;
				sleep.remainingMs = Math.max(0, remaining);
				sleep.overdue = remaining < 0;
				sleep.overdueMs = remaining < 0 ? -remaining : null;
			}
		}
	}

	/* --- nappies: a plain count, and deliberately no target -------------- */
	const today = dayBucketOf(now, dayStart, zone);
	let total = 0;
	let pee = 0;
	let poop = 0;
	for (const e of mine) {
		if (e.type !== 'nappy') continue;
		if (dayBucketOf(e.occurred_at, dayStart, zone) !== today) continue;
		const p = e.payload as NappyPayload;
		total += 1;
		if (p.pee) pee += 1;
		if (p.poop) poop += 1;
	}

	return { feed, sleep, nappies: { total, pee, poop } };
}

export { MS };
