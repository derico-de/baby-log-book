/* Growth — the one trend that is not a week.

   Every other stat on this screen is a rolling seven days, because every other
   question is *is this week going better than the last*. Weight and height are
   not that question. A Baby is weighed at a check-up, which is monthly at
   best, so seven bars of a measurement would be seven empty days and one
   column — a chart that is right and says nothing.

   So growth reads the whole log instead: every measurement there has ever
   been, drawn as a line from the first to the latest. That is also the only
   honest shape for it — a bar chart of weights invites reading the *bar* as
   the quantity, and 6 kg is not twice as much baby as 3 kg in any sense
   anybody means. A line says *this is where she has got to*, which is what a
   growth chart is for.

   Nothing here is a percentile and nothing here is a judgement. The app draws
   the numbers somebody entered and says how long ago they entered them; a
   red-line-against-the-WHO-curve is a doctor's job and would be this app
   telling a parent at 3am that something is wrong.

   Pure: entries in, points and an SVG path string out. */

import type { Entry, MeasurementPayload } from './types';

export type GrowthKind = 'weight' | 'height';

/** Canonical units throughout — grams and millimetres, exactly as stored
    (spec §3.4). They become kilograms and centimetres at display, and not one
    step earlier. */
export interface GrowthPoint {
	at: number;
	value: number;
}

export interface GrowthSeries {
	kind: GrowthKind;
	/** Ascending by instant, one point per instant. Never empty: a series with
	    nothing in it is not returned at all. */
	points: GrowthPoint[];
	first: GrowthPoint;
	latest: GrowthPoint;
	min: number;
	max: number;
}

export interface GrowthInput {
	entries: Entry[];
	babyId: string;
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

/** Weight and height over the whole log, in that order — the order a
    paediatrician says them in, and the order the cards are drawn.

    A series appears only when something was measured, which is the same
    admission rule the trend cards follow: a Household that has never entered a
    height has no height card rather than an empty one. */
export function growthFor(input: GrowthInput): GrowthSeries[] {
	const mine = input.entries
		.filter((e) => e.type === 'measurement' && live(e) && e.baby_id === input.babyId)
		.sort((a, b) => a.occurred_at - b.occurred_at || a.logged_at - b.logged_at);

	const out: GrowthSeries[] = [];
	for (const kind of ['weight', 'height'] as const) {
		/* Two measurements at the same instant is one of them corrected twice
		   over, or two Members entering the same check-up. A line cannot go
		   backwards in time, so the later-logged one wins the instant — the same
		   last-writer rule the fold itself uses. */
		const byInstant = new Map<number, number>();
		for (const e of mine) {
			const p = e.payload as MeasurementPayload;
			const value = kind === 'weight' ? p.weight_g : p.height_mm;
			if (value == null) continue;
			byInstant.set(e.occurred_at, value);
		}
		if (byInstant.size === 0) continue;

		const points = [...byInstant.entries()]
			.map(([at, value]) => ({ at, value }))
			.sort((a, b) => a.at - b.at);
		const values = points.map((p) => p.value);
		out.push({
			kind,
			points,
			first: points[0],
			latest: points[points.length - 1],
			min: Math.min(...values),
			max: Math.max(...values)
		});
	}
	return out;
}

export interface PlotPoint {
	x: number;
	y: number;
}

/** A smooth curve through the points, and never past them.

    Monotone cubic interpolation (Fritsch–Carlson), not the Catmull–Rom spline
    that is the usual one line of code: Catmull–Rom overshoots around an uneven
    gap, so a Baby weighed at 4.1 kg and then 4.2 kg would be drawn dipping to
    4.05 in between. On a growth chart an invented dip is not a rendering
    artefact — it is the app saying she lost weight. This one cannot overshoot:
    between two points the curve stays between their two values.

    Points must be ascending in x; equal x values are dropped, since a curve
    cannot be vertical. */
export function smoothPath(points: PlotPoint[]): string {
	const p = points.filter((pt, i) => i === 0 || pt.x > points[i - 1].x);
	if (p.length === 0) return '';
	const round = (n: number) => Number(n.toFixed(3));
	const move = `M ${round(p[0].x)} ${round(p[0].y)}`;
	if (p.length === 1) return move;

	const n = p.length;
	/* Secant slopes, then a tangent per point, then each tangent limited so no
	   segment can leave the box its two ends make. */
	const slope: number[] = [];
	for (let i = 0; i < n - 1; i++) slope.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x));

	const tangent: number[] = new Array(n);
	tangent[0] = slope[0];
	tangent[n - 1] = slope[n - 2];
	for (let i = 1; i < n - 1; i++) {
		/* A turning point gets a flat tangent — that is what stops the curve
		   sailing past a peak or a trough. */
		tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
	}
	for (let i = 0; i < n - 1; i++) {
		if (slope[i] === 0) {
			tangent[i] = 0;
			tangent[i + 1] = 0;
			continue;
		}
		const a = tangent[i] / slope[i];
		const b = tangent[i + 1] / slope[i];
		const s = a * a + b * b;
		if (s > 9) {
			const t = 3 / Math.sqrt(s);
			tangent[i] = t * a * slope[i];
			tangent[i + 1] = t * b * slope[i];
		}
	}

	const parts = [move];
	for (let i = 0; i < n - 1; i++) {
		const dx = (p[i + 1].x - p[i].x) / 3;
		parts.push(
			`C ${round(p[i].x + dx)} ${round(p[i].y + tangent[i] * dx)}` +
				` ${round(p[i + 1].x - dx)} ${round(p[i + 1].y - tangent[i + 1] * dx)}` +
				` ${round(p[i + 1].x)} ${round(p[i + 1].y)}`
		);
	}
	return parts.join(' ');
}
