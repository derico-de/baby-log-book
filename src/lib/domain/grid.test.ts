import { describe, expect, it } from 'vitest';
import { buildGrid, facetsPresent, hourTicks } from './grid';
import type { Entry } from './types';

const BERLIN = 'Europe/Berlin';
const iso = (s: string) => Date.parse(s);
/* 16:00 Berlin on 2026-08-17, which is day bucket 2026-08-17 at a 05:00 Day
   Start. */
const NOW = iso('2026-08-17T14:00:00Z');
const LENS = { dayStart: '05:00', zone: BERLIN, babyId: 'b1', now: NOW };

let n = 0;
function entry(p: Partial<Entry> & { type: Entry['type']; occurred_at: number }): Entry {
	return {
		id: `e${String(n++).padStart(3, '0')}`,
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

const sleep = (from: string, to: string | null) =>
	entry({ type: 'sleep', occurred_at: iso(from), ended_at: to == null ? null : iso(to) });
const tummy = (from: string, to: string | null) =>
	entry({ type: 'tummy_time', occurred_at: iso(from), ended_at: to == null ? null : iso(to) });
const bottle = (from: string, to: string | null = null) =>
	entry({
		type: 'bottle_feed',
		occurred_at: iso(from),
		ended_at: to == null ? null : iso(to),
		payload: { volume_ml: 120, leftover_ml: null, contents: 'formula' }
	});
const nappy = (at: string) =>
	entry({ type: 'nappy', occurred_at: iso(at), payload: { pee: true, poop: false, consistency: null, where: null } });
const meal = (at: string) =>
	entry({ type: 'meal', occurred_at: iso(at), payload: { foods: [{ food_id: 'f1', amount: 'some', reaction: null }] } });

const grid = (entries: Entry[], keys: string[], extra: Partial<Parameters<typeof buildGrid>[0]> = {}) =>
	buildGrid({ ...LENS, entries, keys, ...extra });

describe('a column is a day bucket', () => {
	it('runs from the Day Start to the next one', () => {
		const [col] = grid([], ['2026-08-17']);
		/* 05:00 Berlin is 03:00 UTC in August. */
		expect(col.start).toBe(iso('2026-08-17T03:00:00Z'));
		expect(col.end).toBe(iso('2026-08-18T03:00:00Z'));
	});

	it('positions an Entry by its share of the span', () => {
		/* 17:00 Berlin is twelve of the column's twenty-four hours in. */
		const [col] = grid([nappy('2026-08-17T15:00:00Z')], ['2026-08-17']);
		expect(col.marks[0].at).toBeCloseTo(0.5, 6);
	});

	it('knows which column now is in, and where', () => {
		const cols = grid([], ['2026-08-16', '2026-08-17']);
		expect(cols[0].isToday).toBe(false);
		expect(cols[0].now).toBeNull();
		expect(cols[1].isToday).toBe(true);
		/* 16:00 Berlin, eleven hours after a 05:00 Day Start. */
		expect(cols[1].now).toBeCloseTo(11 / 24, 6);
	});
});

describe('the hour axis', () => {
	it('opens on the Day Start and names every hour after it', () => {
		const [col] = grid([], ['2026-08-17']);
		expect(col.ticks).toHaveLength(24);
		expect(col.ticks[0]).toMatchObject({ at: 0, hour: 5, minute: 0 });
		expect(col.ticks[1].hour).toBe(6);
		expect(col.ticks.at(-1)!.hour).toBe(4);
	});

	it('draws a spring-forward day as twenty-three hours with a skipped label', () => {
		/* Europe/Berlin springs forward at 02:00 on 2026-03-29, inside the
		   05:00 → 05:00 bucket that begins on the 28th. */
		const [col] = buildGrid({ ...LENS, entries: [], keys: ['2026-03-28'], now: iso('2026-03-28T12:00:00Z') });
		expect(col.end - col.start).toBe(23 * 3_600_000);
		expect(col.ticks).toHaveLength(23);
		const hours = col.ticks.map((t) => t.hour);
		/* 01:00 is followed by 03:00 — the hour the day did not have. */
		expect(hours.slice(19, 22)).toEqual([0, 1, 3]);
	});

	it('draws an autumn day as twenty-five hours with a repeated label', () => {
		const [col] = buildGrid({ ...LENS, entries: [], keys: ['2026-10-24'], now: iso('2026-10-24T12:00:00Z') });
		expect(col.end - col.start).toBe(25 * 3_600_000);
		expect(col.ticks).toHaveLength(25);
		expect(col.ticks.map((t) => t.hour).filter((h) => h === 2)).toHaveLength(2);
	});

	it('states the minute for a zone whose ticks fall off the hour', () => {
		/* Lord Howe shifts by thirty minutes, so half the year the axis is on
		   the half hour and saying so is cheaper than hiding it. */
		const ticks = hourTicks(iso('2026-04-03T18:00:00Z'), iso('2026-04-04T18:30:00Z'), 'Australia/Lord_Howe');
		expect(ticks).toHaveLength(25);
		expect(ticks[0]).toMatchObject({ hour: 5, minute: 0 });
		expect(ticks.filter((t) => t.minute === 30)).not.toHaveLength(0);
	});
});

describe('sessions are drawn where the time is, not where the count goes', () => {
	it('splits a night Sleep across the columns it touches', () => {
		/* 22:00 Berlin to 06:30 the next morning: it begins in the 17th's
		   bucket and its tail runs into the 18th's. */
		const s = sleep('2026-08-17T20:00:00Z', '2026-08-18T04:30:00Z');
		const cols = grid([s], ['2026-08-17', '2026-08-18']);

		expect(cols[0].blocks).toHaveLength(1);
		expect(cols[0].blocks[0].clippedEnd).toBe(true);
		expect(cols[0].blocks[0].clippedStart).toBe(false);
		expect(cols[0].blocks[0].to).toBe(1);

		expect(cols[1].blocks).toHaveLength(1);
		expect(cols[1].blocks[0].clippedStart).toBe(true);
		expect(cols[1].blocks[0].from).toBe(0);
		expect(cols[1].blocks[0].to).toBeCloseTo(1.5 / 24, 6);
	});

	it('draws a running session as far as it has got', () => {
		const [col] = grid([sleep('2026-08-17T12:00:00Z', null)], ['2026-08-17']);
		expect(col.blocks[0].running).toBe(true);
		expect(col.blocks[0].clippedEnd).toBe(false);
		/* Started 14:00 Berlin, now is 16:00 Berlin. */
		expect(col.blocks[0].to).toBeCloseTo(11 / 24, 6);
	});

	it('does not draw a session that misses the column', () => {
		const [col] = grid([sleep('2026-08-15T12:00:00Z', '2026-08-15T13:00:00Z')], ['2026-08-17']);
		expect(col.blocks).toHaveLength(0);
	});

	it('survives an end typed before its start', () => {
		const [col] = grid([tummy('2026-08-17T12:00:00Z', '2026-08-17T11:00:00Z')], ['2026-08-17']);
		expect(col.blocks).toHaveLength(1);
		expect(col.blocks[0].to).toBeGreaterThanOrEqual(col.blocks[0].from);
	});
});

describe('sleep is the ground layer', () => {
	it('marks a Sleep as ground and a Feed as not', () => {
		const [col] = grid([sleep('2026-08-17T20:00:00Z', '2026-08-17T22:00:00Z'), bottle('2026-08-17T20:30:00Z', '2026-08-17T20:45:00Z')], [
			'2026-08-17'
		]);
		const ground = col.blocks.filter((b) => b.ground);
		const over = col.blocks.filter((b) => !b.ground);
		expect(ground).toHaveLength(1);
		expect(over).toHaveLength(1);
	});

	it('lets a Sleep Feed sit inside its Sleep rather than competing for a lane', () => {
		/* The overlap is the domain (spec §3.4): a Baby can take a bottle
		   without waking. Neither block narrows. */
		const [col] = grid(
			[sleep('2026-08-17T20:00:00Z', '2026-08-17T23:00:00Z'), bottle('2026-08-17T21:00:00Z', '2026-08-17T21:20:00Z')],
			['2026-08-17']
		);
		for (const b of col.blocks) {
			expect(b.lane).toBe(0);
			expect(b.lanes).toBe(1);
		}
	});

	it('splits lanes when two foreground sessions genuinely overlap', () => {
		const [col] = grid(
			[bottle('2026-08-17T12:00:00Z', '2026-08-17T12:30:00Z'), tummy('2026-08-17T12:10:00Z', '2026-08-17T12:40:00Z')],
			['2026-08-17']
		);
		expect(col.blocks.map((b) => b.lane).sort()).toEqual([0, 1]);
		expect(col.blocks.every((b) => b.lanes === 2)).toBe(true);
	});

	it('keeps one busy hour from narrowing the whole day', () => {
		const [col] = grid(
			[
				bottle('2026-08-17T08:00:00Z', '2026-08-17T08:30:00Z'),
				tummy('2026-08-17T08:10:00Z', '2026-08-17T08:40:00Z'),
				bottle('2026-08-17T15:00:00Z', '2026-08-17T15:20:00Z')
			],
			['2026-08-17']
		);
		const late = col.blocks.find((b) => b.entry.occurred_at === iso('2026-08-17T15:00:00Z'))!;
		expect(late.lanes).toBe(1);
	});
});

describe('marks', () => {
	it('stack when no slot is given — a week column has no room to spread', () => {
		const [col] = grid([nappy('2026-08-17T12:00:00Z'), meal('2026-08-17T12:05:00Z')], ['2026-08-17']);
		expect(col.marks.every((mk) => mk.lanes === 1)).toBe(true);
	});

	it('sit side by side at their true times when a slot is given', () => {
		const [col] = grid([nappy('2026-08-17T12:00:00Z'), meal('2026-08-17T12:05:00Z')], ['2026-08-17'], {
			markSlotMs: 25 * 60_000
		});
		expect(col.marks.map((mk) => mk.lane).sort()).toEqual([0, 1]);
		expect(col.marks.every((mk) => mk.lanes === 2)).toBe(true);
		/* Spread sideways, never nudged to a time they did not happen at. */
		expect(col.marks[0].at).toBeCloseTo(9 / 24, 6);
	});

	it('belongs to exactly one column', () => {
		const cols = grid([nappy('2026-08-18T02:59:00Z')], ['2026-08-17', '2026-08-18']);
		expect(cols[0].marks).toHaveLength(1);
		expect(cols[1].marks).toHaveLength(0);
	});
});

describe('what is drawn at all', () => {
	it('leaves out another Baby, a tombstone and a merged session', () => {
		const other = entry({ type: 'nappy', occurred_at: iso('2026-08-17T12:00:00Z'), baby_id: 'b2', payload: {} as never });
		const deleted = { ...nappy('2026-08-17T12:00:00Z'), deleted_at: NOW };
		const merged = { ...sleep('2026-08-17T12:00:00Z', '2026-08-17T13:00:00Z'), merged_into: 'e999' };
		const [col] = grid([other, deleted, merged, nappy('2026-08-17T13:00:00Z')], ['2026-08-17']);
		expect(col.marks).toHaveLength(1);
		expect(col.blocks).toHaveLength(0);
	});

	it('honours the facet filter', () => {
		const [col] = grid([sleep('2026-08-17T12:00:00Z', '2026-08-17T13:00:00Z'), nappy('2026-08-17T12:00:00Z')], ['2026-08-17'], {
			facets: ['sleep']
		});
		expect(col.blocks).toHaveLength(1);
		expect(col.marks).toHaveLength(0);
	});

	it('orders everything touching the column by when it happened', () => {
		const [col] = grid(
			[nappy('2026-08-17T15:00:00Z'), sleep('2026-08-17T06:00:00Z', '2026-08-17T07:00:00Z'), meal('2026-08-17T10:00:00Z')],
			['2026-08-17']
		);
		expect(col.ordered.map((e) => e.type)).toEqual(['sleep', 'meal', 'nappy']);
	});
});

describe('the legend admits only what has data', () => {
	it('lists present facets in palette order', () => {
		const facets = facetsPresent({
			...LENS,
			keys: ['2026-08-17'],
			entries: [nappy('2026-08-17T12:00:00Z'), sleep('2026-08-17T06:00:00Z', '2026-08-17T07:00:00Z')]
		});
		expect(facets).toEqual(['sleep', 'nappy']);
	});

	it('is empty when the window is', () => {
		expect(facetsPresent({ ...LENS, keys: ['2026-08-17'], entries: [] })).toEqual([]);
	});

	it('counts a Sleep whose tail alone reaches into the window', () => {
		const facets = facetsPresent({
			...LENS,
			keys: ['2026-08-17'],
			entries: [sleep('2026-08-16T20:00:00Z', '2026-08-17T04:00:00Z')]
		});
		expect(facets).toEqual(['sleep']);
	});
});
