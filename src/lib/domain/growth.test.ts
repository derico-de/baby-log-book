import { describe, expect, it } from 'vitest';
import { growthFor, smoothPath } from './growth';
import type { Entry } from './types';

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

const measure = (at: string, weight_g: number | null, height_mm: number | null = null, extra: Partial<Entry> = {}) =>
	entry({
		type: 'measurement',
		occurred_at: iso(at),
		payload: { weight_g, height_mm, head_mm: null },
		...extra
	});

const growth = (entries: Entry[]) => growthFor({ entries, babyId: 'b1' });

describe('the growth series', () => {
	it('is weight then height, over the whole log', () => {
		const series = growth([
			measure('2026-02-17T09:00:00Z', 3400, 510),
			measure('2026-05-17T09:00:00Z', 6100, 620),
			measure('2026-08-17T09:00:00Z', 8000, 690)
		]);
		expect(series.map((s) => s.kind)).toEqual(['weight', 'height']);
		expect(series[0].points.map((p) => p.value)).toEqual([3400, 6100, 8000]);
		expect(series[0].first.value).toBe(3400);
		expect(series[0].latest.value).toBe(8000);
		expect(series[1].points.map((p) => p.value)).toEqual([510, 620, 690]);
	});

	it('leaves out a measure nobody entered rather than plotting a zero', () => {
		const series = growth([measure('2026-05-17T09:00:00Z', 6100, null)]);
		expect(series.map((s) => s.kind)).toEqual(['weight']);
	});

	it('has no series at all when nothing was ever measured', () => {
		expect(growth([entry({ type: 'nappy', occurred_at: iso('2026-08-17T09:00:00Z') })])).toEqual([]);
	});

	it('sorts by when it happened, not by when it was typed in', () => {
		const series = growth([
			measure('2026-08-17T09:00:00Z', 8000),
			measure('2026-02-17T09:00:00Z', 3400)
		]);
		expect(series[0].points.map((p) => p.at)).toEqual([
			iso('2026-02-17T09:00:00Z'),
			iso('2026-08-17T09:00:00Z')
		]);
	});

	it('gives one instant to the last measurement logged for it', () => {
		/* Two Members entering the same check-up, or one correction typed twice.
		   A line cannot go backwards in time, so the instant holds one value. */
		const series = growth([
			measure('2026-05-17T09:00:00Z', 6100, null, { logged_at: 1 }),
			measure('2026-05-17T09:00:00Z', 6150, null, { logged_at: 2 })
		]);
		expect(series[0].points).toEqual([{ at: iso('2026-05-17T09:00:00Z'), value: 6150 }]);
	});

	it('ignores tombstones, merged rows and other Babies', () => {
		const series = growth([
			measure('2026-05-17T09:00:00Z', 6100, null, { deleted_at: 1 }),
			measure('2026-06-17T09:00:00Z', 6600, null, { merged_into: 'x' }),
			measure('2026-07-17T09:00:00Z', 7000, null, { baby_id: 'b2' }),
			measure('2026-08-17T09:00:00Z', 8000)
		]);
		expect(series[0].points.map((p) => p.value)).toEqual([8000]);
	});

	it('states the range, so the axis can be the range', () => {
		const series = growth([
			measure('2026-02-17T09:00:00Z', 3400),
			measure('2026-08-17T09:00:00Z', 8000)
		]);
		expect(series[0].min).toBe(3400);
		expect(series[0].max).toBe(8000);
	});
});

describe('the smooth path', () => {
	it('is nothing at all when there is nothing to draw', () => {
		expect(smoothPath([])).toBe('');
	});

	it('is a single move for a single measurement', () => {
		expect(smoothPath([{ x: 10, y: 20 }])).toBe('M 10 20');
	});

	it('joins every point it was given', () => {
		const d = smoothPath([
			{ x: 0, y: 100 },
			{ x: 50, y: 60 },
			{ x: 100, y: 20 }
		]);
		expect(d.startsWith('M 0 100')).toBe(true);
		expect(d).toContain('50 60');
		expect(d.endsWith('100 20')).toBe(true);
		expect(d.split('C')).toHaveLength(3); /* two segments */
	});

	it('never leaves the box its two ends make', () => {
		/* The whole reason this is monotone cubic and not Catmull–Rom: an
		   overshoot between two rising measurements is the app drawing a week
		   she lost weight in. */
		const points = [
			{ x: 0, y: 100 },
			{ x: 10, y: 99 },
			{ x: 90, y: 20 },
			{ x: 100, y: 19 }
		];
		const d = smoothPath(points);
		const numbers = d
			.replace(/[MC]/g, ' ')
			.trim()
			.split(/\s+/)
			.map(Number);
		/* Every control point's y stays inside the data's own range, which is
		   what keeps the curve inside it too. */
		const ys = numbers.filter((_, i) => i % 2 === 1);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(19);
		expect(Math.max(...ys)).toBeLessThanOrEqual(100);
	});

	it('flattens at a turning point rather than sailing past it', () => {
		const d = smoothPath([
			{ x: 0, y: 50 },
			{ x: 10, y: 20 },
			{ x: 20, y: 50 }
		]);
		/* The tangent at the peak is zero, so the control points either side of
		   it sit at its own height — the curve arrives flat and leaves flat. */
		expect(d).toContain('6.667 20 10 20');
		expect(d).toContain('C 13.333 20');
	});

	it('drops a point that would make the curve vertical', () => {
		const d = smoothPath([
			{ x: 0, y: 10 },
			{ x: 0, y: 40 },
			{ x: 10, y: 20 }
		]);
		expect(d.startsWith('M 0 10')).toBe(true);
		expect(d.split('C')).toHaveLength(2);
	});
});
