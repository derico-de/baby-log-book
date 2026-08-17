/* Stats — a trend screen and only that. Spec §9.1.

   The home screen already answers *when did she last eat*; the timeline already
   answers *what happened yesterday*. The only question left is *is this getting
   better* — reassurance, not reporting and not handover.

   Eight bars, seven of which count. Today is drawn as an eighth, visibly
   in-progress bar and is excluded from the delta: including a half-finished day
   would tell you every single morning that things are getting worse. One rule
   covers both today and a running Sleep — show the truth so far, keep it out of
   the comparison.

   Computed client-side over the local replica, nothing cached. A year is ~7,300
   entries and under 2 MB, which folds in milliseconds. */

import { addDays, dayBucketOf, MS } from './time';
import { classifySleep } from './sleep';
import type { BottleFeedPayload, Entry, MealPayload, NappyPayload } from './types';
import { isFeed } from './entries';

export const WINDOW_DAYS = 7;

export type CardKind = 'sleep' | 'feeds' | 'nappies' | 'solids';

export interface DayBar {
	key: string;
	value: number;
	isToday: boolean;
}

export interface SleepSecondary {
	longestMs: number;
	nightMs: number;
	napMs: number;
}
export interface FeedsSecondary {
	/** Volume cannot be the primary bar: a breastfed Baby has no millilitres.
	    Null when no bottles exist in the window. */
	volumeMlToday: number | null;
	volumeMlAverage: number | null;
}
export interface NappiesSecondary {
	peeToday: number;
	poopToday: number;
}
export interface SolidsSecondary {
	/** "3 new Foods this week", derived from first exposure. */
	newFoods: number;
}

export interface StatsCard {
	kind: CardKind;
	/** Eight bars: the seven complete days, then today in progress. */
	bars: DayBar[];
	/** Today so far. */
	today: number;
	/** The mean over the seven complete days. */
	average: number;
	/** Complete seven against the seven before. Null when there is nothing
	    before to compare with — a delta against zero history is not a trend. */
	delta: number | null;
	secondary: SleepSecondary | FeedsSecondary | NappiesSecondary | SolidsSecondary;
}

export interface StatsInput {
	entries: Entry[];
	babyId: string;
	now: number;
	dayStart: string;
	zone: string;
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

function dayKeys(today: string, count: number, endingAt = 0): string[] {
	const keys: string[] = [];
	for (let i = count - 1 + endingAt; i >= endingAt; i--) keys.push(addDays(today, -i));
	return keys;
}

/** A Sleep is attributed to the bucket its start falls in — the same rule every
    other Entry follows, so "she slept eleven hours last night" lands on the
    night it began rather than being split across a boundary. */
function sleepMs(e: Entry, now: number): number {
	const end = e.ended_at ?? now;
	return Math.max(0, end - e.occurred_at);
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The four cards, in the order the screen draws them. A card appears only when
    its entry type has data in the window, which makes age-appropriateness free:
    a newborn's screen has no Solids card, and no age logic exists anywhere. */
export function statsFor(input: StatsInput): StatsCard[] {
	const { babyId, now, dayStart, zone } = input;
	const today = dayBucketOf(now, dayStart, zone);
	const windowKeys = [...dayKeys(today, WINDOW_DAYS, 1), today];
	const previousKeys = dayKeys(today, WINDOW_DAYS, WINDOW_DAYS + 1);
	const inWindow = new Set(windowKeys);
	const inPrevious = new Set(previousKeys);

	const mine = input.entries.filter((e) => live(e) && e.baby_id === babyId);

	/* One pass, bucketing every Entry once. */
	type Acc = {
		sleepMs: Map<string, number>;
		feeds: Map<string, number>;
		nappies: Map<string, number>;
		meals: Map<string, number>;
		volume: Map<string, number>;
	};
	const empty = (): Acc => ({
		sleepMs: new Map(),
		feeds: new Map(),
		nappies: new Map(),
		meals: new Map(),
		volume: new Map()
	});
	const acc = empty();
	const previous = empty();

	let hasSleep = false;
	let hasFeed = false;
	let hasNappy = false;
	let hasMeal = false;
	let hasBottle = false;
	let longestMs = 0;
	let nightMs = 0;
	let napMs = 0;
	let peeToday = 0;
	let poopToday = 0;
	const firstSeen = new Map<string, number>();

	const bump = (map: Map<string, number>, key: string, by: number) =>
		map.set(key, (map.get(key) ?? 0) + by);

	for (const e of mine) {
		const key = dayBucketOf(e.occurred_at, dayStart, zone);
		const current = inWindow.has(key);
		const earlier = inPrevious.has(key);
		const target = current ? acc : earlier ? previous : null;

		if (e.type === 'meal') {
			/* First exposure is derived, so the Solids secondary reads the whole
			   log rather than the window: a Food is only new if it is new. */
			for (const f of (e.payload as MealPayload).foods) {
				const at = firstSeen.get(f.food_id);
				if (at == null || e.occurred_at < at) firstSeen.set(f.food_id, e.occurred_at);
			}
		}

		if (!target) continue;

		switch (e.type) {
			case 'sleep': {
				const ms = sleepMs(e, now);
				bump(target.sleepMs, key, ms);
				if (current) {
					hasSleep = true;
					if (ms > longestMs) longestMs = ms;
					/* The whole window, today included: this is the truth so far, and
					   only the delta excludes today. */
					if (classifySleep(e, { dayStart, zone }, now) === 'night') nightMs += ms;
					else napMs += ms;
				}
				break;
			}
			case 'nappy': {
				bump(target.nappies, key, 1);
				if (current) {
					hasNappy = true;
					if (key === today) {
						const p = e.payload as NappyPayload;
						if (p.pee) peeToday += 1;
						if (p.poop) poopToday += 1;
					}
				}
				break;
			}
			case 'meal':
				bump(target.meals, key, 1);
				if (current) hasMeal = true;
				break;
			default:
				if (isFeed(e.type)) {
					bump(target.feeds, key, 1);
					if (current) hasFeed = true;
					if (e.type === 'bottle_feed') {
						const volume = (e.payload as BottleFeedPayload).volume_ml;
						if (volume != null) {
							bump(target.volume, key, volume);
							if (current) hasBottle = true;
						}
					}
				}
		}
	}

	const bars = (map: Map<string, number>): DayBar[] =>
		windowKeys.map((key) => ({ key, value: map.get(key) ?? 0, isToday: key === today }));

	const completeAverage = (map: Map<string, number>) =>
		mean(windowKeys.filter((k) => k !== today).map((k) => map.get(k) ?? 0));

	const deltaOf = (current: Map<string, number>, before: Map<string, number>): number | null => {
		if (before.size === 0) return null;
		return completeAverage(current) - mean(previousKeys.map((k) => before.get(k) ?? 0));
	};

	const cards: StatsCard[] = [];

	if (hasSleep) {
		cards.push({
			kind: 'sleep',
			bars: bars(acc.sleepMs),
			today: acc.sleepMs.get(today) ?? 0,
			average: completeAverage(acc.sleepMs),
			delta: deltaOf(acc.sleepMs, previous.sleepMs),
			secondary: { longestMs, nightMs, napMs } satisfies SleepSecondary
		});
	}

	if (hasFeed) {
		cards.push({
			kind: 'feeds',
			bars: bars(acc.feeds),
			today: acc.feeds.get(today) ?? 0,
			average: completeAverage(acc.feeds),
			delta: deltaOf(acc.feeds, previous.feeds),
			secondary: {
				volumeMlToday: hasBottle ? (acc.volume.get(today) ?? 0) : null,
				volumeMlAverage: hasBottle ? completeAverage(acc.volume) : null
			} satisfies FeedsSecondary
		});
	}

	if (hasNappy) {
		cards.push({
			kind: 'nappies',
			bars: bars(acc.nappies),
			today: acc.nappies.get(today) ?? 0,
			average: completeAverage(acc.nappies),
			delta: deltaOf(acc.nappies, previous.nappies),
			secondary: { peeToday, poopToday } satisfies NappiesSecondary
		});
	}

	if (hasMeal) {
		const from = windowKeys[0];
		let newFoods = 0;
		for (const at of firstSeen.values()) {
			const key = dayBucketOf(at, dayStart, zone);
			if (key >= from && key <= today) newFoods += 1;
		}
		cards.push({
			kind: 'solids',
			bars: bars(acc.meals),
			today: acc.meals.get(today) ?? 0,
			average: completeAverage(acc.meals),
			delta: deltaOf(acc.meals, previous.meals),
			secondary: { newFoods } satisfies SolidsSecondary
		});
	}

	return cards;
}

export { MS };
