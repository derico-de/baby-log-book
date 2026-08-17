import { describe, expect, it } from 'vitest';
import { milestoneInstant, milestoneSuggestions, STARTER_MILESTONE_KEYS } from './milestones';
import type { Entry } from './types';

const BERLIN = 'Europe/Berlin';
const HOUSEHOLD = { dayStart: '05:00', zone: BERLIN };
const iso = (s: string) => Date.parse(s);

function milestone(name: string, at: string, extra: Partial<Entry> = {}): Entry {
	return {
		id: `m-${name}-${at}`,
		household_id: 'h1',
		baby_id: 'b1',
		type: 'milestone',
		occurred_at: iso(at),
		ended_at: null,
		recording_zone: BERLIN,
		note: null,
		payload: { name },
		logged_by: 'mum',
		logged_at: iso(at),
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null,
		...extra
	} as Entry;
}

const STARTERS = ['First smile', 'First laugh', 'First tooth'];

describe('the starter list', () => {
	it('has ten suggestions and neither of the two rejected ones', () => {
		expect(STARTER_MILESTONE_KEYS).toHaveLength(10);
		expect(STARTER_MILESTONE_KEYS.join(' ')).not.toMatch(/slept|night|month/i);
	});
});

describe('milestoneSuggestions', () => {
	it('is derived from the Milestones themselves, newest first', () => {
		const suggestions = milestoneSuggestions(
			[milestone('Rolled off the sofa', '2026-07-01T10:00:00Z'), milestone('New tooth', '2026-08-01T10:00:00Z')],
			STARTERS
		);
		expect(suggestions.slice(0, 2)).toEqual(['New tooth', 'Rolled off the sofa']);
	});

	it('cannot drift, because correcting the entry corrects the suggestion', () => {
		// A catalogue would keep the orphan; this list has nowhere to keep it.
		const corrected = [milestone('First toth', '2026-08-01T10:00:00Z', { deleted_at: 1 }), milestone('First tooth', '2026-08-01T10:00:00Z')];
		expect(milestoneSuggestions(corrected, [])).toEqual(['First tooth']);
	});

	it('offers the starters that have not been used', () => {
		const suggestions = milestoneSuggestions([milestone('First smile', '2026-06-01T10:00:00Z')], STARTERS);
		expect(suggestions).toEqual(['First smile', 'First laugh', 'First tooth']);
	});

	it('matches a used name case-insensitively but keeps it as it was typed', () => {
		const suggestions = milestoneSuggestions([milestone('first TOOTH', '2026-08-01T10:00:00Z')], STARTERS);
		expect(suggestions).toContain('first TOOTH');
		expect(suggestions.filter((s) => s.toLowerCase() === 'first tooth')).toHaveLength(1);
	});

	it('ignores an empty name', () => {
		expect(milestoneSuggestions([milestone('   ', '2026-08-01T10:00:00Z')], [])).toEqual([]);
	});
});

describe('milestoneInstant', () => {
	const now = iso('2026-08-17T14:00:00Z');

	it('is the moment of logging when it happened today', () => {
		expect(milestoneInstant(null, now, HOUSEHOLD)).toBe(now);
		expect(milestoneInstant('2026-08-17', now, HOUSEHOLD)).toBe(now);
	});

	it('is the Day Start of the date when back-dated, so it heads its day', () => {
		expect(milestoneInstant('2026-08-14', now, HOUSEHOLD)).toBe(iso('2026-08-14T03:00:00Z'));
	});

	it('is still an instant, never a date', () => {
		expect(typeof milestoneInstant('2026-08-14', now, HOUSEHOLD)).toBe('number');
	});
});
