/* Sleep: the type whose end is the whole point.

   Feeds are anchored by their start; a Sleep is defined by its end (spec §3.3).
   Nothing downstream depends on when a Feed ended, so a forgotten stop is
   harmless there — while a Sleep left running has destroyed the record it
   existed to make. That asymmetry is why only Sleeps get a recovery banner,
   and it is the whole subject of this file.

   Nothing here writes anything. The app never synthesises an end time for a
   session nobody stopped; it reports, and the parent judges. */

import { ageInMonths, crossesDayStart, dateKey, dayBucketOf, dayStartInstant, addDays, wallPartsOf, wallToInstant, MS } from './time';
import type { Entry } from './types';
import { isFeed } from './entries';

export interface HouseholdLens {
	dayStart: string;
	zone: string;
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

/** The Night Sleep is the one that crosses the Day Start; every other Sleep is
    a Nap (spec §7.2). A running Sleep is classified against `now`, so a stats
    bar can grow live. */
export function classifySleep(sleep: Entry, hh: HouseholdLens, now: number): 'night' | 'nap' {
	const end = sleep.ended_at ?? now;
	return crossesDayStart(sleep.occurred_at, end, hh.dayStart, hh.zone) ? 'night' : 'nap';
}

/** A Sleep Feed is a Feed overlapping a Sleep — derived from the overlap, never
    recorded, which is also what covers the manual path where a corrected Feed
    lands inside a Sleep without passing through the fan (spec §8.5). */
export function isSleepFeed(feed: Entry, entries: Entry[]): boolean {
	if (!isFeed(feed.type) || !live(feed)) return false;
	return entries.some(
		(s) =>
			s.type === 'sleep' &&
			live(s) &&
			s.baby_id === feed.baby_id &&
			feed.occurred_at >= s.occurred_at &&
			(s.ended_at == null || feed.occurred_at <= s.ended_at)
	);
}

/** The hidden, age-banded ceiling. Not editable and never shown: these are
    "no baby sleeps this long" figures rather than averages, so a celebrated
    first eight-hour night draws nothing (spec §6.6). */
export function staleCeilingMs(ageMonths: number): number {
	if (ageMonths < 3) return 8 * MS.hour;
	if (ageMonths < 6) return 11 * MS.hour;
	return 13 * MS.hour;
}

export interface StaleInput {
	sleep: Entry;
	entries: Entry[];
	now: number;
	birthDate: string;
	dayStart: string;
	zone: string;
	/** When a Member last said *Still asleep*. It restarts the clock, and it is
	    Device-local: an acknowledgement is not data anyone entered about the
	    Baby, and the app does not author revisions outside a Session Merge. */
	ackAt?: number | null;
}

export interface StaleState {
	stale: boolean;
	reason: 'ceiling' | 'meal' | null;
	/** The instant the backstop started counting from — the Sleep's start, or
	    the last acknowledgement. */
	since: number | null;
}

/** The backstop, not the primary defence. A running session is already visible
    from anywhere on every Member's Device; the banner is only for when nobody
    noticed, and a backstop can afford to be late — what it cannot afford is
    crying wolf nightly. */
export function staleSleepState(input: StaleInput): StaleState {
	const { sleep, entries, now, birthDate, zone, ackAt } = input;
	if (sleep.type !== 'sleep' || !live(sleep) || sleep.ended_at != null) {
		return { stale: false, reason: null, since: null };
	}

	const since = ackAt ?? sleep.occurred_at;

	/* One sound contradiction: a Meal. You cannot spoon solids into a sleeping
	   Baby, and it catches the forgotten afternoon nap of an older Baby the
	   same day — exactly the gap a 13h ceiling leaves.

	   A Feed is explicitly NOT a contradiction: a Feed overlapping a Sleep is a
	   Sleep Feed, normal and nightly. Nappies are excluded too. */
	const contradicted = entries.some(
		(e) =>
			e.type === 'meal' &&
			live(e) &&
			e.baby_id === sleep.baby_id &&
			e.occurred_at > since &&
			e.occurred_at <= now
	);
	if (contradicted) return { stale: true, reason: 'meal', since };

	const ceiling = staleCeilingMs(ageInMonths(birthDate, now, zone));
	if (now - since >= ceiling) return { stale: true, reason: 'ceiling', since };

	return { stale: false, reason: null, since };
}

/** Wall minutes-of-day of the ends of recent Night Sleeps. */
function recentNightWakes(sleep: Entry, entries: Entry[], hh: HouseholdLens, now: number): number[] {
	const cutoff = now - 14 * MS.day;
	const wakes: Array<{ at: number; minutes: number }> = [];
	for (const e of entries) {
		if (e.id === sleep.id || e.type !== 'sleep' || !live(e) || e.ended_at == null) continue;
		if (e.baby_id !== sleep.baby_id || e.ended_at < cutoff) continue;
		if (classifySleep(e, hh, now) !== 'night') continue;
		const p = wallPartsOf(e.ended_at, hh.zone);
		wakes.push({ at: e.ended_at, minutes: p.h * 60 + p.mi });
	}
	return wakes
		.sort((a, b) => b.at - a.at)
		.slice(0, 7)
		.map((w) => w.minutes);
}

/** The lower median, so the default is a time she has actually woken at rather
    than an average between two. */
function lowerMedian(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** What the stale-Sleep banner's picker opens on: her usual wake time, not now.
    "Now" is the honest we-know-nothing answer and is almost always wrong — she
    woke hours ago, which is why the banner appeared (spec §8.6). */
export function usualWakeInstant(
	sleep: Entry,
	entries: Entry[],
	now: number,
	hh: HouseholdLens
): number {
	const usual = lowerMedian(recentNightWakes(sleep, entries, hh, now));
	let minutes = usual;
	if (minutes == null) {
		/* No history to read. Two hours after the Day Start is a defensible
		   guess and, unlike an average, it cannot claim to be one. */
		const start = dayStartInstant(dateKey(wallPartsOf(now, hh.zone)), hh.dayStart, hh.zone);
		const p = wallPartsOf(start + 2 * MS.hour, hh.zone);
		minutes = p.h * 60 + p.mi;
	}

	const from = dayBucketOf(sleep.occurred_at, hh.dayStart, hh.zone);
	const to = addDays(dayBucketOf(now, hh.dayStart, hh.zone), 1);
	const candidates: number[] = [];
	for (let key = from; key <= to; key = addDays(key, 1)) {
		const { y, m, d } = { ...wallPartsOf(dayStartInstant(key, '00:00', hh.zone), hh.zone) };
		candidates.push(wallToInstant({ y, m, d, h: Math.floor(minutes / 60), mi: minutes % 60 }, hh.zone));
	}

	const plausible = candidates.filter((t) => t > sleep.occurred_at && t <= now);
	if (plausible.length > 0) return Math.max(...plausible);

	/* Neither her usual time nor the fallback falls inside this Sleep, which
	   happens on a long daytime Sleep. Offer the middle of it, rounded to five
	   minutes: visibly a guess, and never outside the session. */
	const middle = sleep.occurred_at + Math.floor((now - sleep.occurred_at) / 2);
	return Math.round(middle / (5 * MS.minute)) * 5 * MS.minute;
}
