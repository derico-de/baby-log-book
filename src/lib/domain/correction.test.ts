import { describe, expect, it } from 'vitest';
import { correctionAsksFirst } from './correction';
import type { Entry } from './types';

const NOW = Date.parse('2026-09-16T14:00:00Z');
const H = 60 * 60 * 1000;

function entry(p: Partial<Entry> & { type: Entry['type']; occurred_at: number }): Entry {
	return {
		id: 'e1',
		household_id: 'h1',
		baby_id: 'b1',
		ended_at: null,
		recording_zone: 'Europe/Berlin',
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

describe('a correction that asks first', () => {
	it('saves an entry from the last two hours straight through', () => {
		expect(correctionAsksFirst(entry({ type: 'nappy', occurred_at: NOW - 2 * H }), NOW)).toBe(false);
		expect(correctionAsksFirst(entry({ type: 'nappy', occurred_at: NOW }), NOW)).toBe(false);
	});

	it('asks about anything older', () => {
		expect(correctionAsksFirst(entry({ type: 'nappy', occurred_at: NOW - 2 * H - 1 }), NOW)).toBe(true);
		expect(correctionAsksFirst(entry({ type: 'milestone', occurred_at: NOW - 40 * H }), NOW)).toBe(true);
	});

	it('reads a finished session from its end, so last night s sleep is this morning s row', () => {
		const sleep = entry({ type: 'sleep', occurred_at: NOW - 9 * H, ended_at: NOW - 20 * 60 * 1000 });
		expect(correctionAsksFirst(sleep, NOW)).toBe(false);
	});

	it('reads a running session from its start, like everything else', () => {
		/* The rows the fan and the stale banner speak for never come through the
		   edit sheet, so a session still open hours later is one nobody stopped. */
		expect(correctionAsksFirst(entry({ type: 'sleep', occurred_at: NOW - 9 * H }), NOW)).toBe(true);
		expect(correctionAsksFirst(entry({ type: 'sleep', occurred_at: NOW - 30 * 60 * 1000 }), NOW)).toBe(false);
	});
});
