/* Schedules. ADR-0006, spec §6.5 and §8.4.

   A schedule in v1 is one number per activity per Baby and no machinery: a
   Target is stated, never learned, and nothing is ever materialised. Every
   due figure below is a display-time fold.

   The due-instant computation lives HERE, in one function that the sticky
   header calls — so the v2 notifier calls the same function rather than
   reimplementing it, which is the whole reason push notifications need no
   schema change (spec §2). */

import { dayBucketOf, ageInMonths, pastNight, withinLastDay, MS, type NightPeriod } from './time';
import type { Activity, Entry, Household, NappyPayload, PendingRevision, Target } from './types';
import { isFeed, isHour } from './entries';

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

/** A stated Night Start, read from anywhere: a Revision field, a form input, a
    column. Anything that is not an hour is `null` — *this Household keeps no
    Night Period* — which is the quiet side, and the side an older or newer
    client should land on (ADR-0032). */
export function nightStartValue(value: unknown): string | null {
	return isHour(value) ? (value as string) : null;
}

/** The Night Period a Household keeps, or null.

    Built here and nowhere else, because the pair is not two settings: the
    Household states when the Night *begins*, and it ends at the Day Start —
    the boundary that already settles both ends of the night (ADR-0032). A
    Night that begins at the hour it ends is no Night at all, which is how a
    Household turns it off by hand rather than by clearing a field. */
export function nightPeriodOf(
	household: Pick<Household, 'night_start' | 'day_start'> | null | undefined
): NightPeriod | null {
	const start = household?.night_start;
	if (!start || start === household?.day_start) return null;
	return { start, end: household.day_start };
}

/** The due instant of a **Feed**, which is the one Target the Night Period
    moves: a Feed that would come due at 01:00 comes due at the Day Start
    instead, because nobody has stated an interval they mean to keep to at 1am
    (ADR-0032).

    Only the Feed. A Wake Window is *how long she is comfortably awake* and
    says nothing about the hour; a Bottle Life is how long milk stays good, and
    milk does not keep longer because it is dark. Both would be a different
    claim, so both keep `dueInstant` unchanged. */
export function feedDueInstant(
	target: Target,
	anchorAt: number,
	night: NightPeriod | null,
	zone: string
): number {
	return pastNight(dueInstant(target, anchorAt), night, zone);
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

/** The Entry a Target measures from: the previous Feed, the last Sleep, or the
    bottle that is still open. Three anchors, because "she sleeps every 3h" is
    not a Wake Window — how long she stays comfortably awake is a different
    anchor, and getting it wrong would have made the sleep number useless.

    The Entry rather than only its instant, because a Notice has to be said
    once per anchor and the anchor's id is the only key that survives a server
    restart (ADR-0031). */
export function anchorEntry(target: Pick<Target, 'anchor'>, entries: Entry[]): Entry | null {
	if (target.anchor === 'bottle_start') {
		/* The bottle still open, not the last one poured. A bottle that has been
		   stopped is a bottle nobody is going to offer again, so it has no life
		   left to count; two open at once is a Combined Feed, and the older of
		   them is the one running out first. */
		let earliest: Entry | null = null;
		for (const e of entries) {
			if (!live(e) || e.type !== 'bottle_feed' || e.ended_at != null) continue;
			if (earliest == null || e.occurred_at < earliest.occurred_at) earliest = e;
		}
		return earliest;
	}
	if (target.anchor === 'feed_start') {
		let latest: Entry | null = null;
		for (const e of entries) {
			if (!live(e) || !isFeed(e.type)) continue;
			if (latest == null || e.occurred_at > latest.occurred_at) latest = e;
		}
		return latest;
	}
	let latest: Entry | null = null;
	for (const e of entries) {
		if (!live(e) || e.type !== 'sleep' || e.ended_at == null) continue;
		if (latest == null || e.ended_at > latest.ended_at!) latest = e;
	}
	return latest;
}

/** The instant that anchor sits at — a Sleep is measured from its end, and
    everything else from its start. */
export function anchorInstant(target: Pick<Target, 'anchor'>, entries: Entry[]): number | null {
	const entry = anchorEntry(target, entries);
	if (!entry) return null;
	return target.anchor === 'sleep_end' ? entry.ended_at : entry.occurred_at;
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

/** How long before a bottle's Life runs out the Bottle Chime sounds. Fixed,
    and deliberately not a fourth Target: it is not an interval anyone is
    keeping to — it is how much warning is useful, and ten minutes is enough to
    offer the rest of a bottle before its Life is up (ADR-0029).

    Clamped to half the Life below, so a Household that has typed a short
    number still gets a chime that means *nearly out* rather than one that
    sounds as the feed starts. */
export const BOTTLE_CHIME_LEAD_MS = 10 * 60_000;

/** The open bottles now inside their last stretch — the ids the Bottle Chime
    sounds for, once each.

    It says nothing about how long a bottle has left beyond *this one is nearly
    out*: the row already prints the countdown, and this exists so a Member who
    put the bottle down is reminded to offer the rest while there is still time
    (ADR-0029). Past bottles are excluded — their Feed is over, and the server
    has already ended it (ADR-0017).

    Every Baby in the Household, not just the one the timeline is showing: the
    bottle that is running out is running out whichever name is at the top of
    the screen. */
export function bottlesNearingEnd(
	entries: Entry[],
	targets: Target[],
	now: number,
	leadMs: number = BOTTLE_CHIME_LEAD_MS
): string[] {
	const ids: string[] = [];
	for (const e of entries) {
		if (e.type !== 'bottle_feed' || e.ended_at != null || !live(e)) continue;
		const target = bottleTargetOf(
			targets.filter((t) => t.baby_id === e.baby_id),
			e.baby_id
		);
		if (target.duration_s <= 0) continue;
		const lead = Math.min(leadMs, (target.duration_s * 1000) / 2);
		const remaining = dueInstant(target, e.occurred_at) - now;
		if (remaining > 0 && remaining <= lead) ids.push(e.id);
	}
	return ids;
}

export interface PastBottle {
	entry_id: string;
	/** The bottle's due instant — the Feed ends when the bottle did, not when
	    the server noticed. */
	ended_at: number;
}

/** Which open bottles have outlived their Bottle Life (ADR-0017).

    A bottle past its stated duration is a bottle nobody is going to offer
    again, so the Feed it belongs to has ended — at the due instant, the one
    moment every Device computes identically from the synced Target. Bottles
    only: a running breast feed has nothing that goes off. */
export function planPastBottles(sessions: Entry[], targets: Target[], now: number): PastBottle[] {
	const plans: PastBottle[] = [];
	for (const e of sessions) {
		if (e.type !== 'bottle_feed' || e.ended_at != null || !live(e)) continue;
		const target = bottleTargetOf(targets, e.baby_id);
		if (target.duration_s <= 0) continue;
		const dueAt = dueInstant(target, e.occurred_at);
		if (dueAt <= now) plans.push({ entry_id: e.id, ended_at: dueAt });
	}
	return plans;
}

/** The revision a past bottle appends. App-attributed like a Session Merge
    (`author_id` null): no person pressed stop, and the history should say so
    honestly. It stops the Feed at a fact — the due instant of a Target a
    Member typed — never at a guess. */
export function pastBottleRevision(
	plan: PastBottle,
	ctx: { household_id: string; at: number; device_id: string; id: string }
): PendingRevision {
	return {
		id: ctx.id,
		household_id: ctx.household_id,
		kind: 'entry',
		entity_id: plan.entry_id,
		fields: { ended_at: plan.ended_at },
		merge_at: ctx.at,
		device_id: ctx.device_id,
		author_id: null
	};
}

export interface FeedHeader {
	/** The running Feed, if there is one — a breast timer or a still-open
	    bottle, the Live Session everyone's Device can see. With two open at
	    once (a Combined Feed across Devices), the latest started is the one
	    being fed right now. */
	running: Entry | null;
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
	/** Counts are today's; `lastPoopAt` looks past the Day Start, because "she
	    hasn't pooped since yesterday" is exactly the fact it exists to state. */
	nappies: { total: number; pee: number; poop: number; lastPoopAt: number | null };
}

export interface HeaderInput {
	entries: Entry[];
	targets: Target[];
	now: number;
	dayStart: string;
	zone: string;
	/** The Household's Night Period, or null when it keeps none. Passed rather
	    than derived so the header reads the same setting the notifier does. */
	night: NightPeriod | null;
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
	const { now, dayStart, zone, night, babyId } = input;
	const mine = input.entries.filter((e) => live(e) && e.baby_id === babyId);

	const feedTarget = targetFor(input.targets, 'feed');
	const sleepTarget = targetFor(input.targets, 'sleep');

	/* --- feeds: anchored by their start, always counting ----------------- */
	const lastFeedAt = anchorInstant({ anchor: 'feed_start' } as Target, mine);
	const runningFeed =
		mine
			.filter((e) => isFeed(e.type) && e.ended_at == null)
			.sort((a, b) => b.occurred_at - a.occurred_at)[0] ?? null;
	const feed: FeedHeader = {
		running: runningFeed,
		lastAt: lastFeedAt,
		elapsedMs: lastFeedAt == null ? null : now - lastFeedAt,
		absolute: lastFeedAt != null && !withinLastDay(lastFeedAt, now),
		dueAt: null,
		remainingMs: null,
		overdue: false,
		overdueMs: null
	};
	if (lastFeedAt != null && feedTarget) {
		feed.dueAt = feedDueInstant(feedTarget, lastFeedAt, night, zone);
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
	let lastPoopAt: number | null = null;
	for (const e of mine) {
		if (e.type !== 'nappy') continue;
		const p = e.payload as NappyPayload;
		if (p.poop && (lastPoopAt == null || e.occurred_at > lastPoopAt)) lastPoopAt = e.occurred_at;
		if (dayBucketOf(e.occurred_at, dayStart, zone) !== today) continue;
		total += 1;
		if (p.pee) pee += 1;
		if (p.poop) poop += 1;
	}

	return { feed, sleep, nappies: { total, pee, poop, lastPoopAt } };
}

export { MS };
