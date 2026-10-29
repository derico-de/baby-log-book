import { describe, expect, it } from 'vitest';
import { caretakingStaysIn } from './caretaking';
import type { Entry } from './types';

const NOW = Date.parse('2026-10-29T14:00:00Z');
const H = 60 * 60 * 1000;
const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';

function entry(p: Partial<Entry> & { logged_by: string; logged_at: number; recording_zone: string }): Entry {
	return {
		id: `${p.logged_by}-${p.logged_at}`,
		household_id: 'h1',
		baby_id: 'b1',
		type: 'nappy',
		occurred_at: p.logged_at,
		ended_at: null,
		note: null,
		payload: {} as never,
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null,
		...p
	} as Entry;
}

describe('caretaking that stays in the Household Zone', () => {
	it('stays while another Member logged from there in the last twelve hours', () => {
		const entries = [entry({ logged_by: 'mum', logged_at: NOW - 12 * H, recording_zone: BERLIN })];
		expect(caretakingStaysIn(BERLIN, entries, 'dad', NOW)).toBe(true);
	});

	it('has moved once their latest Entry was logged elsewhere', () => {
		const entries = [
			entry({ logged_by: 'mum', logged_at: NOW - 3 * H, recording_zone: BERLIN }),
			entry({ logged_by: 'mum', logged_at: NOW - H, recording_zone: NEW_YORK })
		];
		expect(caretakingStaysIn(BERLIN, entries, 'dad', NOW)).toBe(false);
	});

	it('has moved once nobody there has logged for longer than a night', () => {
		const entries = [entry({ logged_by: 'mum', logged_at: NOW - 12 * H - 1, recording_zone: BERLIN })];
		expect(caretakingStaysIn(BERLIN, entries, 'dad', NOW)).toBe(false);
	});

	it('never counts the asking Member', () => {
		const entries = [entry({ logged_by: 'dad', logged_at: NOW - H, recording_zone: BERLIN })];
		expect(caretakingStaysIn(BERLIN, entries, 'dad', NOW)).toBe(false);
	});

	it('stays while any one of the others is still there', () => {
		const entries = [
			entry({ logged_by: 'mum', logged_at: NOW - H, recording_zone: NEW_YORK }),
			entry({ logged_by: 'oma', logged_at: NOW - 2 * H, recording_zone: BERLIN })
		];
		expect(caretakingStaysIn(BERLIN, entries, 'dad', NOW)).toBe(true);
	});
});
