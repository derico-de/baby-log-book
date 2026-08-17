import { describe, expect, it } from 'vitest';
import { BOM, buildExport, csvCell, exportFileName, isoWithOffset, toCsv, type ExportInput } from './export';
import type { Entry, Revision } from './types';

const BERLIN = 'Europe/Berlin';
const iso = (s: string) => Date.parse(s);

let n = 0;
function entry(p: Partial<Entry> & { type: Entry['type']; occurred_at: number }): Entry {
	return {
		id: `e${n++}`,
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

const revision: Revision = {
	id: 'r1',
	household_id: 'h1',
	kind: 'entry',
	entity_id: 'e1',
	fields: { volume_ml: 150 },
	merge_at: iso('2026-08-17T10:00:00Z'),
	device_id: 'phone-a',
	author_id: 'oma',
	seq: 42
};

const input: ExportInput = {
	household: { id: 'h1', name: 'Zuhause', day_start: '05:00', zone: BERLIN },
	babies: [{ id: 'b1', household_id: 'h1', name: 'Lina', birth_date: '2026-02-17', deleted_at: null }],
	members: [
		{ id: 'mum', household_id: 'h1', display_name: 'Mama', role: 'parent', removed_at: null, locale: 'de' },
		{ id: 'oma', household_id: 'h1', display_name: 'Oma', role: 'caregiver', removed_at: null, locale: 'ro' }
	],
	foods: [{ id: 'f-broc', household_id: 'h1', name: 'Brokkoli', deleted_at: null }],
	targets: [
		{ id: 't1', household_id: 'h1', baby_id: 'b1', activity: 'feed', duration_s: 10800, anchor: 'feed_start', deleted_at: null }
	],
	entries: [],
	revisions: [revision],
	exportedAt: iso('2026-08-17T12:00:00Z'),
	appVersion: '1.0.0',
	gitSha: 'abc1234'
};

describe('csvCell', () => {
	it('quotes what has to be quoted', () => {
		expect(csvCell('plain')).toBe('plain');
		expect(csvCell('a,b')).toBe('"a,b"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell(null)).toBe('');
		expect(csvCell(true)).toBe('true');
	});

	it('defuses a value a spreadsheet would run as a formula', () => {
		expect(csvCell('=1+1')).toBe('"=1+1"');
		expect(csvCell('-broccoli')).toBe('"-broccoli"');
	});

	it('leaves an integer alone, which is what makes a comma delimiter safe', () => {
		// Canonical units are integer ml, g and mm, so there are no decimals to
		// collide with the DE/RO decimal comma.
		expect(csvCell(150)).toBe('150');
	});
});

describe('toCsv', () => {
	it('starts with a BOM, or Excel mangles umlauts and diacritics', () => {
		const csv = toCsv(['name'], [['Brokkoli'], ['Piure de morcovi']]);
		expect(csv.startsWith(BOM)).toBe(true);
		expect(csv).toContain('Brokkoli');
	});
});

describe('isoWithOffset', () => {
	it('carries its own offset', () => {
		expect(isoWithOffset(iso('2026-08-16T00:14:00Z'), BERLIN)).toBe('2026-08-16T02:14:00+02:00');
		expect(isoWithOffset(iso('2026-01-16T00:14:00Z'), BERLIN)).toBe('2026-01-16T01:14:00+01:00');
		expect(isoWithOffset(null, BERLIN)).toBe('');
	});
});

describe('buildExport', () => {
	it('writes one file per entry type plus the reference tables', () => {
		expect(Object.keys(buildExport(input)).sort()).toEqual([
			'babies.csv',
			'bottle_feeds.csv',
			'breast_feeds.csv',
			'foods.csv',
			'household.csv',
			'meal_foods.csv',
			'meals.csv',
			'measurements.csv',
			'members.csv',
			'milestones.csv',
			'nappies.csv',
			'revisions.csv',
			'sleeps.csv',
			'targets.csv'
		]);
	});

	it('splits a Meal from its Foods, because a Meal does not fit one row', () => {
		const meal = entry({
			type: 'meal',
			occurred_at: iso('2026-08-15T10:00:00Z'),
			payload: { foods: [{ food_id: 'f-broc', amount: 'tasted', reaction: 'rash' }] }
		});
		const files = buildExport({ ...input, entries: [meal] });
		expect(files['meals.csv']).toContain(meal.id);
		expect(files['meal_foods.csv']).toContain('Brokkoli');
		expect(files['meal_foods.csv']).toContain('rash');
		/* Repeating the Meal across N rows would corrupt every count. */
		expect(files['meals.csv'].trim().split('\r\n')).toHaveLength(2);
	});

	it('derives first exposure on the way out', () => {
		const first = entry({
			type: 'meal',
			occurred_at: iso('2026-08-10T10:00:00Z'),
			payload: { foods: [{ food_id: 'f-broc', amount: 'tasted', reaction: null }] }
		});
		const again = entry({
			type: 'meal',
			occurred_at: iso('2026-08-15T10:00:00Z'),
			payload: { foods: [{ food_id: 'f-broc', amount: 'lots', reaction: null }] }
		});
		const rows = buildExport({ ...input, entries: [again, first] })['meal_foods.csv'].trim().split('\r\n');
		expect(rows[1]).toContain('true'); /* the earlier Meal */
		expect(rows[2]).toContain('false');
	});

	it('includes soft-deleted entries and flags them', () => {
		// An export that silently drops rows the app still holds is lying about
		// being complete.
		const deleted = entry({
			type: 'nappy',
			occurred_at: iso('2026-08-16T08:00:00Z'),
			payload: { pee: true, poop: false, consistency: null },
			deleted_at: iso('2026-08-16T08:05:00Z')
		});
		const csv = buildExport({ ...input, entries: [deleted] })['nappies.csv'];
		expect(csv).toContain(deleted.id);
		expect(csv).toContain('2026-08-16T10:05:00+02:00');
	});

	it('carries the lens, without which the numbers have lost their meaning', () => {
		const csv = buildExport(input)['household.csv'];
		expect(csv).toContain('Europe/Berlin');
		expect(csv).toContain('05:00');
		expect(csv).toContain('abc1234');
	});

	it('names the app rather than leaving a blank where a Session Merge was', () => {
		const merge: Revision = { ...revision, id: 'r2', author_id: null, seq: 43 };
		const csv = buildExport({ ...input, revisions: [merge] })['revisions.csv'];
		expect(csv).toContain(',app,');
	});

	it('uses stable English headers whatever the Member s language', () => {
		const files = buildExport(input);
		expect(files['sleeps.csv'].split('\r\n')[0]).toContain('occurred_at,occurred_at_zone,recording_zone');
		expect(files['sleeps.csv']).not.toContain('Aufgewacht');
	});

	it('reports a Sleep as night or nap, and its duration in minutes', () => {
		const night = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-16T18:00:00Z'),
			ended_at: iso('2026-08-17T04:00:00Z')
		});
		const csv = buildExport({ ...input, entries: [night] })['sleeps.csv'];
		expect(csv).toContain(',600,night');
	});
});

describe('exportFileName', () => {
	it('is the date someone will look for in a Downloads folder', () => {
		expect(exportFileName(iso('2026-08-17T22:30:00Z'), BERLIN)).toBe('baby-log-book-2026-08-18.zip');
	});
});
