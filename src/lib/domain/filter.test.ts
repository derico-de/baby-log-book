import { describe, expect, it } from 'vitest';
import {
	EMPTY_FILTER,
	FACET_OF,
	filterEntries,
	firstExposure,
	highlightParts,
	isFiltered,
	matchesFilter,
	periodStart,
	searchableText,
	type FilterContext
} from './filter';
import type { Entry } from './types';

const BERLIN = 'Europe/Berlin';
const iso = (s: string) => Date.parse(s);

const ctx: FilterContext = {
	foods: new Map([
		['f-broc', 'Broccoli'],
		['f-yog', 'Yoghurt']
	]),
	members: new Map([
		['mum', 'Mama'],
		['oma', 'Oma']
	]),
	now: iso('2026-08-17T14:00:00Z'),
	dayStart: '05:00',
	zone: BERLIN
};

function entry(p: Partial<Entry> & { type: Entry['type']; occurred_at: number }): Entry {
	return {
		id: p.id ?? `e-${p.type}-${p.occurred_at}`,
		household_id: 'h1',
		baby_id: 'b1',
		ended_at: null,
		recording_zone: BERLIN,
		note: null,
		payload: {} as never,
		logged_by: 'mum',
		logged_at: p.occurred_at,
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null,
		...p
	} as Entry;
}

const broccoliMeal = entry({
	type: 'meal',
	occurred_at: iso('2026-08-15T10:00:00Z'),
	payload: { foods: [{ food_id: 'f-broc', amount: 'tasted', reaction: 'rash on the chin' }] }
});
const yoghurtMeal = entry({
	type: 'meal',
	occurred_at: iso('2026-08-16T10:00:00Z'),
	payload: { foods: [{ food_id: 'f-yog', amount: 'lots', reaction: null }] },
	logged_by: 'oma'
});
const feed = entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T09:00:00Z'), payload: { volume_ml: 120, leftover_ml: null, contents: 'formula' } });
const nappy = entry({
	type: 'nappy',
	occurred_at: iso('2026-08-17T08:00:00Z'),
	payload: { pee: true, poop: false, consistency: null, where: null }
});
const tooth = entry({
	type: 'milestone',
	occurred_at: iso('2026-07-01T03:00:00Z'),
	payload: { name: 'First tooth' }
});
const tummyTime = entry({ type: 'tummy_time', occurred_at: iso('2026-08-17T10:00:00Z'), payload: {} });
const ALL = [broccoliMeal, yoghurtMeal, feed, nappy, tooth, tummyTime];

describe('the facets', () => {
	it('collapse breast and bottle into one Feeds chip', () => {
		expect(FACET_OF.breast_feed).toBe('feed');
		expect(FACET_OF.bottle_feed).toBe('feed');
	});

	it('give Tummy time a chip of its own', () => {
		expect(FACET_OF.tummy_time).toBe('tummy');
		expect(filterEntries(ALL, { ...EMPTY_FILTER, types: ['tummy'] }, ctx)).toEqual([tummyTime]);
	});

	it('treat Milestone as an ordinary facet', () => {
		expect(FACET_OF.milestone).toBe('milestone');
		expect(filterEntries(ALL, { ...EMPTY_FILTER, types: ['milestone'] }, ctx)).toEqual([tooth]);
	});
});

describe('isFiltered', () => {
	it('is false for the unfiltered timeline and true for anything else', () => {
		expect(isFiltered(EMPTY_FILTER)).toBe(false);
		expect(isFiltered({ ...EMPTY_FILTER, types: ['feed'] })).toBe(true);
		expect(isFiltered({ ...EMPTY_FILTER, text: '  ' })).toBe(false);
		expect(isFiltered({ ...EMPTY_FILTER, period: 'last7' })).toBe(true);
	});
});

describe('the Food facet', () => {
	it('is the whole of the Food detail view — a pre-filtered timeline', () => {
		expect(filterEntries(ALL, { ...EMPTY_FILTER, foodId: 'f-broc' }, ctx)).toEqual([broccoliMeal]);
	});

	it('brings the reaction notes with it, because they are the rows', () => {
		expect(searchableText(broccoliMeal, ctx)).toContain('rash on the chin');
	});
});

describe('free text', () => {
	it('scans the rendered detail, not only the Note', () => {
		expect(filterEntries(ALL, { ...EMPTY_FILTER, text: 'brocc' }, ctx)).toEqual([broccoliMeal]);
		expect(filterEntries(ALL, { ...EMPTY_FILTER, text: 'first tooth' }, ctx)).toEqual([tooth]);
	});

	it('finds who logged it', () => {
		expect(filterEntries(ALL, { ...EMPTY_FILTER, text: 'oma' }, ctx)).toEqual([yoghurtMeal]);
	});

	it('is case-insensitive', () => {
		expect(matchesFilter(broccoliMeal, { ...EMPTY_FILTER, text: 'BROCCOLI' }, ctx)).toBe(true);
	});
});

describe('the Member facet', () => {
	it('filters by who logged it', () => {
		expect(filterEntries(ALL, { ...EMPTY_FILTER, memberId: 'oma' }, ctx)).toEqual([yoghurtMeal]);
	});
});

describe('the period presets', () => {
	it('start at a day boundary, the same seven days the stats screen draws', () => {
		expect(periodStart('anytime', ctx)).toBeNull();
		expect(periodStart('last7', ctx)).toBe(iso('2026-08-11T03:00:00Z'));
		expect(periodStart('last30', ctx)).toBe(iso('2026-07-19T03:00:00Z'));
	});

	it('exclude what falls outside', () => {
		const recent = filterEntries(ALL, { ...EMPTY_FILTER, period: 'last7' }, ctx);
		expect(recent).not.toContain(tooth);
		expect(recent).toContain(feed);
	});
});

describe('filterEntries', () => {
	it('is reverse-chronological', () => {
		expect(filterEntries(ALL, EMPTY_FILTER, ctx).map((e) => e.occurred_at)).toEqual(
			[...ALL].map((e) => e.occurred_at).sort((a, b) => b - a)
		);
	});

	it('leaves tombstoned and merged rows off the timeline', () => {
		const deleted = entry({ type: 'sleep', occurred_at: iso('2026-08-17T12:00:00Z'), deleted_at: 1 });
		const merged = entry({ type: 'sleep', occurred_at: iso('2026-08-17T12:30:00Z'), merged_into: 'x' });
		expect(filterEntries([...ALL, deleted, merged], EMPTY_FILTER, ctx)).not.toContain(deleted);
		expect(filterEntries([...ALL, deleted, merged], EMPTY_FILTER, ctx)).not.toContain(merged);
	});

	it('combines facets conjunctively', () => {
		expect(
			filterEntries(ALL, { ...EMPTY_FILTER, types: ['meal'], memberId: 'mum', text: 'brocc' }, ctx)
		).toEqual([broccoliMeal]);
		expect(
			filterEntries(ALL, { ...EMPTY_FILTER, types: ['meal'], memberId: 'oma', text: 'brocc' }, ctx)
		).toEqual([]);
	});
});

describe('highlightParts', () => {
	it('marks every hit and nothing else', () => {
		expect(highlightParts('Broccoli and more broccoli', 'brocc')).toEqual([
			{ text: 'Brocc', hit: true },
			{ text: 'oli and more ', hit: false },
			{ text: 'brocc', hit: true },
			{ text: 'oli', hit: false }
		]);
	});

	it('is a single run when nothing is being searched for', () => {
		expect(highlightParts('Broccoli', '  ')).toEqual([{ text: 'Broccoli', hit: false }]);
	});
});

describe('firstExposure', () => {
	it('is the earliest Meal containing that Food for that Baby', () => {
		const later = entry({
			type: 'meal',
			occurred_at: iso('2026-08-17T10:00:00Z'),
			payload: { foods: [{ food_id: 'f-broc', amount: 'some', reaction: null }] }
		});
		expect(firstExposure([broccoliMeal, later], 'f-broc', 'b1')).toBe(broccoliMeal.occurred_at);
	});

	it('moves when a forgotten earlier Meal is added, which is why it is not stored', () => {
		const forgotten = entry({
			type: 'meal',
			occurred_at: iso('2026-08-01T10:00:00Z'),
			payload: { foods: [{ food_id: 'f-broc', amount: 'tasted', reaction: null }] }
		});
		expect(firstExposure([broccoliMeal, forgotten], 'f-broc', 'b1')).toBe(forgotten.occurred_at);
	});

	it('is null for a Food this Baby has never had', () => {
		expect(firstExposure([broccoliMeal], 'f-yog', 'b1')).toBeNull();
		expect(firstExposure([broccoliMeal], 'f-broc', 'b2')).toBeNull();
	});
});
