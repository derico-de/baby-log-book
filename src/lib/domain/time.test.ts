import { describe, expect, it } from 'vitest';
import {
	addDays,
	crossesDayStart,
	dayBucketOf,
	dayStartInstant,
	elapsed,
	offsetMinutes,
	splitDuration,
	wallPartsOf,
	wallToInstant
} from './time';

const BERLIN = 'Europe/Berlin';
const BUCHAREST = 'Europe/Bucharest';
const iso = (s: string) => Date.parse(s);

describe('offsetMinutes', () => {
	it('reads the zone, not a stored number', () => {
		expect(offsetMinutes(iso('2026-01-15T12:00:00Z'), BERLIN)).toBe(60);
		expect(offsetMinutes(iso('2026-08-15T12:00:00Z'), BERLIN)).toBe(120);
		expect(offsetMinutes(iso('2026-08-15T12:00:00Z'), 'UTC')).toBe(0);
	});
});

describe('dayStartInstant', () => {
	it('turns the Day Start hour into an instant in the Household Zone', () => {
		expect(dayStartInstant('2026-08-17', '05:00', BERLIN)).toBe(iso('2026-08-17T03:00:00Z'));
		expect(dayStartInstant('2026-01-17', '05:00', BERLIN)).toBe(iso('2026-01-17T04:00:00Z'));
	});

	it('reads the same hour differently in a different zone — one hour, two lenses', () => {
		expect(dayStartInstant('2026-08-17', '05:00', BUCHAREST)).toBe(iso('2026-08-17T02:00:00Z'));
	});

	it('resolves a skipped hour to the instant the clock jumps to', () => {
		// Berlin springs forward 2026-03-29 at 02:00 → 03:00. A Household with
		// Day Start 02:30 has no such wall time that morning; the boundary is
		// the transition, so it stays monotone (spec §7.5).
		expect(dayStartInstant('2026-03-29', '02:30', BERLIN)).toBe(iso('2026-03-29T01:00:00Z'));
	});

	it('resolves a repeated hour to the first occurrence', () => {
		// Berlin falls back 2026-10-25 at 03:00 → 02:00, so 02:30 happens twice.
		expect(dayStartInstant('2026-10-25', '02:30', BERLIN)).toBe(iso('2026-10-25T00:30:00Z'));
	});

	it('keeps the boundary strictly increasing day over day', () => {
		let previous = -Infinity;
		for (let d = 26; d <= 31; d++) {
			const t = dayStartInstant(`2026-03-${d}`, '02:30', BERLIN);
			expect(t).toBeGreaterThan(previous);
			previous = t;
		}
	});
});

describe('dayBucketOf', () => {
	it('files a 01:30 Feed under the night before', () => {
		// The whole job of the Day Start (spec §7.1).
		expect(dayBucketOf(iso('2026-08-17T23:30:00Z'), '05:00', BERLIN)).toBe('2026-08-17'); // 01:30 local, on the 18th
		expect(dayBucketOf(iso('2026-08-18T03:30:00Z'), '05:00', BERLIN)).toBe('2026-08-18'); // 05:30 local
	});

	it('puts the instant exactly at the Day Start in the new day', () => {
		expect(dayBucketOf(dayStartInstant('2026-08-18', '05:00', BERLIN), '05:00', BERLIN)).toBe(
			'2026-08-18'
		);
		expect(dayBucketOf(dayStartInstant('2026-08-18', '05:00', BERLIN) - 1, '05:00', BERLIN)).toBe(
			'2026-08-17'
		);
	});

	it('re-buckets the past when the Household Zone changes, by construction', () => {
		// Same instant, two lenses. Nothing is stamped at write time, which is
		// what makes changing the setting a re-read rather than a migration.
		const midnightish = iso('2026-08-18T02:30:00Z');
		expect(dayBucketOf(midnightish, '05:00', BERLIN)).toBe('2026-08-17'); // 04:30 Berlin
		expect(dayBucketOf(midnightish, '05:00', BUCHAREST)).toBe('2026-08-18'); // 05:30 Bucharest
	});
});

describe('elapsed', () => {
	it('is real time, never a wall-clock subtraction', () => {
		// A Sleep from 23:00 to 07:00 across spring-forward is 7 hours, because
		// the Baby slept 7 hours (spec §7.5).
		const down = wallToInstant({ y: 2026, m: 3, d: 28, h: 23, mi: 0 }, BERLIN);
		const up = wallToInstant({ y: 2026, m: 3, d: 29, h: 7, mi: 0 }, BERLIN);
		expect(elapsed(down, up)).toBe(7 * 3600_000);
	});

	it('is eight hours on an ordinary night', () => {
		const down = wallToInstant({ y: 2026, m: 3, d: 21, h: 23, mi: 0 }, BERLIN);
		const up = wallToInstant({ y: 2026, m: 3, d: 22, h: 7, mi: 0 }, BERLIN);
		expect(elapsed(down, up)).toBe(8 * 3600_000);
	});
});

describe('splitDuration', () => {
	it('splits into the hours and minutes a header prints', () => {
		expect(splitDuration(2 * 3600_000 + 10 * 60_000)).toEqual({ hours: 2, minutes: 10 });
		expect(splitDuration(50 * 60_000)).toEqual({ hours: 0, minutes: 50 });
		expect(splitDuration(-30_000)).toEqual({ hours: 0, minutes: 0 });
	});

	it('floors rather than rounds, so a figure never reads ahead of itself', () => {
		expect(splitDuration(119_000)).toEqual({ hours: 0, minutes: 1 });
	});
});

describe('crossesDayStart', () => {
	it('is what makes a Sleep a Night Sleep', () => {
		// The Night Sleep is the one that crosses the Day Start; every other
		// Sleep is a Nap (spec §7.2).
		const down = wallToInstant({ y: 2026, m: 8, d: 17, h: 20, mi: 0 }, BERLIN);
		const up = wallToInstant({ y: 2026, m: 8, d: 18, h: 6, mi: 30 }, BERLIN);
		expect(crossesDayStart(down, up, '05:00', BERLIN)).toBe(true);
	});

	it('leaves an afternoon nap a nap', () => {
		const down = wallToInstant({ y: 2026, m: 8, d: 17, h: 14, mi: 0 }, BERLIN);
		const up = wallToInstant({ y: 2026, m: 8, d: 17, h: 15, mi: 30 }, BERLIN);
		expect(crossesDayStart(down, up, '05:00', BERLIN)).toBe(false);
	});

	it('accepts the cost: a 19:00 bedtime that collapses at 23:00 is a Nap', () => {
		const down = wallToInstant({ y: 2026, m: 8, d: 17, h: 19, mi: 0 }, BERLIN);
		const up = wallToInstant({ y: 2026, m: 8, d: 17, h: 23, mi: 0 }, BERLIN);
		expect(crossesDayStart(down, up, '05:00', BERLIN)).toBe(false);
	});
});

describe('wallPartsOf and addDays', () => {
	it('projects an instant through the lens', () => {
		expect(wallPartsOf(iso('2026-08-17T03:05:00Z'), BERLIN)).toEqual({
			y: 2026,
			m: 8,
			d: 17,
			h: 5,
			mi: 5,
			s: 0
		});
	});

	it('walks calendar dates without touching a zone', () => {
		expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
	});
});
