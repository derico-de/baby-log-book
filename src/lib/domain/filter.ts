/* Filtering — which is also history, and also the Food detail view.
   Spec §8.7, variant A.

   Free text is a substring scan over the local replica, NOT an index: the
   whole log is already on the Device and a month is ~240 entries. It matches
   Notes *plus the rendered detail of a row* — Food names, a Milestone Name, who
   logged it — because that is what someone typing "broccoli" means. */

import { addDays, dayBucketOf, dayStartInstant } from './time';
import type { Entry, EntryType, MealPayload, MilestonePayload } from './types';

/** Breast and Bottle collapse into one Feeds facet: nobody at 3am thinks
    "breast OR bottle". */
export const FACET_KEYS = ['feed', 'sleep', 'nappy', 'meal', 'tummy', 'measure', 'milestone'] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export const FACET_OF: Record<EntryType, FacetKey> = {
	breast_feed: 'feed',
	bottle_feed: 'feed',
	meal: 'meal',
	sleep: 'sleep',
	nappy: 'nappy',
	measurement: 'measure',
	milestone: 'milestone',
	tummy_time: 'tummy'
};

/** Three preset chips, and no date picker in v1. */
export type Period = 'anytime' | 'last7' | 'last30';

export interface Filter {
	/** Empty means every type — the unfiltered timeline. */
	types: FacetKey[];
	foodId: string | null;
	memberId: string | null;
	text: string;
	period: Period;
}

export const EMPTY_FILTER: Filter = {
	types: [],
	foodId: null,
	memberId: null,
	text: '',
	period: 'anytime'
};

export function isFiltered(filter: Filter): boolean {
	return (
		filter.types.length > 0 ||
		filter.foodId != null ||
		filter.memberId != null ||
		filter.text.trim().length > 0 ||
		filter.period !== 'anytime'
	);
}

export interface FilterContext {
	/** Food id → name, for the free-text scan over rendered detail. */
	foods: Map<string, string>;
	members: Map<string, string>;
	now: number;
	dayStart: string;
	zone: string;
}

const PERIOD_DAYS: Record<Period, number | null> = { anytime: null, last7: 7, last30: 30 };

/** The first instant a period covers: whole day buckets, so "last 7 days" means
    the same seven days the stats screen draws. */
export function periodStart(period: Period, ctx: FilterContext): number | null {
	const days = PERIOD_DAYS[period];
	if (days == null) return null;
	const today = dayBucketOf(ctx.now, ctx.dayStart, ctx.zone);
	return dayStartInstant(addDays(today, -(days - 1)), ctx.dayStart, ctx.zone);
}

/** Everything about a row that a reader can see, flattened for the substring
    scan: the Note, the Food names, a Milestone Name, and who logged it. */
export function searchableText(entry: Entry, ctx: FilterContext): string {
	const parts: string[] = [];
	if (entry.note) parts.push(entry.note);
	if (entry.type === 'meal') {
		for (const f of (entry.payload as MealPayload).foods) {
			const name = ctx.foods.get(f.food_id);
			if (name) parts.push(name);
			if (f.reaction) parts.push(f.reaction);
		}
	}
	if (entry.type === 'milestone') parts.push((entry.payload as MilestonePayload).name);
	const who = ctx.members.get(entry.logged_by);
	if (who) parts.push(who);
	return parts.join(' ');
}

function matchesText(entry: Entry, needle: string, ctx: FilterContext): boolean {
	return searchableText(entry, ctx).toLocaleLowerCase().includes(needle);
}

export function matchesFilter(entry: Entry, filter: Filter, ctx: FilterContext): boolean {
	if (filter.types.length > 0 && !filter.types.includes(FACET_OF[entry.type])) return false;

	if (filter.foodId != null) {
		if (entry.type !== 'meal') return false;
		const foods = (entry.payload as MealPayload).foods;
		if (!foods.some((f) => f.food_id === filter.foodId)) return false;
	}

	if (filter.memberId != null && entry.logged_by !== filter.memberId) return false;

	const from = periodStart(filter.period, ctx);
	if (from != null && entry.occurred_at < from) return false;

	const needle = filter.text.trim().toLocaleLowerCase();
	if (needle.length > 0 && !matchesText(entry, needle, ctx)) return false;

	return true;
}

/** The filtered timeline: reverse-chronological, tombstones excluded. A
    tombstoned Entry is kept forever but it is not on the timeline — undo brings
    it back by appending a revision, not by unhiding it here. */
export function filterEntries(entries: Entry[], filter: Filter, ctx: FilterContext): Entry[] {
	return entries
		.filter((e) => e.deleted_at == null && e.merged_into == null && matchesFilter(e, filter, ctx))
		.sort((a, b) => b.occurred_at - a.occurred_at);
}

/** Splits text into runs so the UI can wrap the hit in a `<mark>` — the one
    place a highlight borrows the hue, because it marks a word and not a type. */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return [{ text, hit: false }];

	const parts: Array<{ text: string; hit: boolean }> = [];
	const haystack = text.toLocaleLowerCase();
	let index = 0;
	for (;;) {
		const at = haystack.indexOf(needle, index);
		if (at === -1) break;
		if (at > index) parts.push({ text: text.slice(index, at), hit: false });
		parts.push({ text: text.slice(at, at + needle.length), hit: true });
		index = at + needle.length;
	}
	if (index < text.length) parts.push({ text: text.slice(index), hit: false });
	return parts;
}

/** First exposure is derived, never stored: the earliest Meal containing that
    Food for that Baby. A stored flag would drift the moment an entry is
    corrected, deleted, or a forgotten earlier Meal is added — and it would lie
    about precisely the thing you would consult it for (spec §3.4). */
export function firstExposure(entries: Entry[], foodId: string, babyId: string): number | null {
	let earliest: number | null = null;
	for (const e of entries) {
		if (e.type !== 'meal' || e.deleted_at != null || e.baby_id !== babyId) continue;
		if (!(e.payload as MealPayload).foods.some((f) => f.food_id === foodId)) continue;
		if (earliest == null || e.occurred_at < earliest) earliest = e.occurred_at;
	}
	return earliest;
}
