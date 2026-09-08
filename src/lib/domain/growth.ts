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

import { dayBucketOf } from './time';
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

export interface BirthMeasurementInput {
	entries: Entry[];
	babyId: string;
	/** `YYYY-MM-DD`, the Baby's own. */
	birthDate: string;
	dayStart: string;
	zone: string;
}

/** The measurement taken on the day she was born, or null.

    Birth weight is not a new kind of thing and gets no field of its own: it is
    a measurement, on a day, exactly like the one taken at the four-month
    check-up. Which one it is falls out of the Baby's birth date — derived, like
    first exposure and the Night-versus-Nap split, so it cannot drift out of
    step with a birth date somebody corrects.

    Later-logged wins when a day somehow holds two, which is the fold's own
    rule and the same one `growthFor` applies to a shared instant. */
export function birthMeasurementOf(input: BirthMeasurementInput): Entry | null {
	let found: Entry | null = null;
	for (const e of input.entries) {
		if (e.type !== 'measurement' || !live(e) || e.baby_id !== input.babyId) continue;
		if (dayBucketOf(e.occurred_at, input.dayStart, input.zone) !== input.birthDate) continue;
		if (found == null || e.logged_at >= found.logged_at) found = e;
	}
	return found;
}

export interface PlotPoint {
	x: number;
	y: number;
}

const sign = (x: number) => (x < 0 ? -1 : 1);

/** A smooth curve through the points, and never past them.

    Monotone cubic interpolation, not the Catmull–Rom spline that is the usual
    one line of code: Catmull–Rom overshoots around an uneven gap, so a Baby
    weighed at 4.1 kg and then 4.2 kg would be drawn dipping to 4.05 in
    between. On a growth chart an invented dip is not a rendering artefact — it
    is the app saying she lost weight. This one cannot overshoot: between two
    points the curve stays between their two values.

    Two details are what make it read as a curve rather than as a bent
    polyline, which matters most on the handful of points a real Baby has:

      - **The interior tangent is the weighted harmonic-style limit**, not the
        mean of the two secants. Check-ups are unevenly spaced — birth, six
        days, six weeks, four months — and a plain mean lets the short gap
        speak as loudly as the long one, which puts a visible kink at every
        point where the spacing changes.
      - **The two ends carry a parabolic tangent** rather than their own
        secant: the end segment bends the way the three points nearest it do,
        so a series starting at birth leaves birth on a curve instead of on a
        straight run-in. Still monotone — the formula cannot exceed three times
        the end secant, which is the condition that guarantees it.

    Two points are drawn as the straight line they are. Nothing is knowable
    about the shape between two measurements, and a curve invented there would
    be the one lie this function exists to avoid.

    Points must be ascending in x; equal x values are dropped, since a curve
    cannot be vertical. */
export function smoothPath(points: PlotPoint[]): string {
	const p = points.filter((pt, i) => i === 0 || pt.x > points[i - 1].x);
	if (p.length === 0) return '';
	const round = (n: number) => Number(n.toFixed(3));
	const move = `M ${round(p[0].x)} ${round(p[0].y)}`;
	if (p.length === 1) return move;

	const n = p.length;
	const gap = (i: number) => p[i + 1].x - p[i].x;
	const secant = (i: number) => (p[i + 1].y - p[i].y) / gap(i);

	const tangent: number[] = new Array(n);
	for (let i = 1; i < n - 1; i++) {
		const before = secant(i - 1);
		const after = secant(i);
		/* Weighted by the *opposite* gap, so the shorter interval — the one that
		   knows more about the slope here — carries more of the tangent. */
		const weighted = (before * gap(i) + after * gap(i - 1)) / (gap(i - 1) + gap(i));
		/* A turning point, or a flat secant either side, gives a flat tangent:
		   that is what stops the curve sailing past a peak or a trough. */
		tangent[i] =
			(sign(before) + sign(after)) *
				Math.min(Math.abs(before), Math.abs(after), Math.abs(weighted) / 2) || 0;
	}
	tangent[0] = n === 2 ? secant(0) : (3 * secant(0) - tangent[1]) / 2;
	tangent[n - 1] = n === 2 ? secant(0) : (3 * secant(n - 2) - tangent[n - 2]) / 2;

	const parts = [move];
	for (let i = 0; i < n - 1; i++) {
		const dx = gap(i) / 3;
		parts.push(
			`C ${round(p[i].x + dx)} ${round(p[i].y + tangent[i] * dx)}` +
				` ${round(p[i + 1].x - dx)} ${round(p[i + 1].y - tangent[i + 1] * dx)}` +
				` ${round(p[i + 1].x)} ${round(p[i + 1].y)}`
		);
	}
	return parts.join(' ');
}
