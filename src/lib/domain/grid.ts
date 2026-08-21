/* The day grid — where the Entries of a day actually fall on a clock.

   The five stat cards answer *is this getting better*. This answers a
   different question the app could not answer before: *what does her day
   look like*. One column per day, an hour axis down the side, every Entry
   drawn in the slot it happened in.

   Three rules make the geometry honest:

   1. **A column is a day bucket, not a calendar day.** It runs from the
      Household's Day Start to the next one, exactly like every other day in
      this app, so the grid never disagrees with the stats or the export. It
      also costs nothing to get DST right: a column is defined by its two
      instants, and a block's position is its share of the span between them.
      A 23-hour day is simply a shorter column with one tick fewer. Wall
      hours stay what they have always been — a projection, printed on the
      axis, never compared with anything (ADR-0010).

   2. **Drawing overlaps, counting attributes.** `stats.ts` gives a Sleep to
      the bucket it *began* in, because "she slept eleven hours last night"
      belongs to the night it started. A grid draws time instead of counting
      days, so a session appears in every column it touches, clipped at the
      edges and flagged as continuing. This is the one place in the app that
      does not use start-bucket attribution, and it is deliberate.

   3. **Sleep is the ground.** A Sleep Feed overlaps its Sleep by definition
      (spec §3.4), so a packing algorithm that treats them as rivals draws the
      domain wrong. Every Entry takes the whole column; Sleep is the layer
      underneath, so the Feed is drawn as a band lying *inside* the Sleep,
      which is what it is.

   4. **A sitting is one block.** Two Feeds close together are one **Combined
      Feed** — one answer to *has she eaten* — and are drawn as one block
      stating both sources' values, divided where one handed over to the next.
      The gap rule is `stats.ts`'s, imported rather than restated, so the grid
      and the card beneath it can never group feeds differently.

   Everything here is pure: instants in, fractions out. The renderer does no
   arithmetic. */

import { addDays, dayStartInstant, MS, wallPartsOf } from './time';
import { FACET_OF, type FacetKey } from './filter';
import { feedContentKey, isFeed, isSession } from './entries';
import { FEED_ROUND_GAP_MS } from './stats';
import type { Entry } from './types';

/** One member of a block, positioned as a fraction *of the block*. A block
    with a single member runs 0 → 1; a Combined Feed has one per source. */
export interface BlockMember {
	entry: Entry;
	from: number;
	to: number;
	/** Which run of same-content Feeds this member belongs to. Consecutive
	    members sharing a run are one bigger feeding rather than a handover:
	    two bottles of the same formula are 140 ml, not 60 and 80. Everything
	    that is not a Feed is a run of one. */
	run: number;
}

/** A positioned Entry with a duration. Fractions are of the column's span. */
export interface GridBlock {
	/** The first Entry the block draws — its identity, facet and key. */
	entry: Entry;
	/** Everything the block draws, in order. One, except for a Combined Feed
	    (see `feedRounds`), which is several and states all of their values. */
	members: BlockMember[];
	facet: FacetKey;
	from: number;
	to: number;
	/** It began before this column did — draw a flat top and no radius. */
	clippedStart: boolean;
	/** It runs past this column's end. */
	clippedEnd: boolean;
	/** A Live Session, drawn as far as it has got. */
	running: boolean;
	/** Sleep, which takes the full width and sits behind everything. */
	ground: boolean;
	lane: number;
	lanes: number;
}

/** A positioned Entry with no duration — a nappy, a meal, a measurement, a
    milestone. It has one instant and that is the whole fact. */
export interface GridMark {
	entry: Entry;
	facet: FacetKey;
	at: number;
	lane: number;
	lanes: number;
}

export interface HourTick {
	/** Fraction down the column. */
	at: number;
	instant: number;
	/** The wall hour this tick lands on. DST can skip one or repeat one, and
	    that is the truth about the day rather than a bug in the axis. */
	hour: number;
	/** Zones whose DST shift is not a whole hour (Lord Howe) put the ticks off
	    the hour for half the year. Rare, and cheaper to state than to hide. */
	minute: number;
}

export interface GridColumn {
	key: string;
	start: number;
	end: number;
	isToday: boolean;
	/** Where now falls in this column, or null when it is not in it. */
	now: number | null;
	ticks: HourTick[];
	blocks: GridBlock[];
	marks: GridMark[];
	/** Everything touching the column in start order — the linear read a
	    screen reader gets, and the reason no Entry can hide behind another. */
	ordered: Entry[];
}

export interface GridInput {
	entries: Entry[];
	babyId: string;
	/** Day keys, ascending. One for a single day, seven for a week. */
	keys: string[];
	dayStart: string;
	zone: string;
	now: number;
	/** Which types to draw. Undefined or empty means all of them. */
	facets?: FacetKey[];
	/** The slot an instant Entry occupies for the purpose of not being drawn
	    on top of its neighbour. Zero leaves marks stacked, which is what a
	    46px week column wants; a day column passes the height of one mark so
	    two close Entries sit side by side at their true times instead of one
	    being nudged to a time it did not happen at. */
	markSlotMs?: number;
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Hour ticks across a column, including the Day Start itself at the top.

    Walking in hour steps from the start instant — rather than constructing
    each wall hour — is what makes DST free: the axis stays linear in elapsed
    time and the labels simply skip or repeat, which is exactly what the day
    did. */
export function hourTicks(start: number, end: number, zone: string): HourTick[] {
	const span = end - start;
	if (span <= 0) return [];
	const ticks: HourTick[] = [];
	for (let t = start; t < end; t += MS.hour) {
		const p = wallPartsOf(t, zone);
		ticks.push({ at: (t - start) / span, instant: t, hour: p.h, minute: p.mi });
	}
	return ticks;
}

interface Packable {
	from: number;
	to: number;
	lane: number;
	lanes: number;
}

/** Side-by-side lanes for things that overlap, the way a calendar does it.

    Lanes are counted per cluster of transitively-overlapping items, so one
    busy afternoon never narrows the whole day. */
function packLanes(items: Packable[]): void {
	const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
	let cluster: Packable[] = [];
	let clusterEnd = -Infinity;
	const laneEnds: number[] = [];

	const flush = () => {
		for (const it of cluster) it.lanes = laneEnds.length;
		cluster = [];
		laneEnds.length = 0;
		clusterEnd = -Infinity;
	};

	for (const it of sorted) {
		if (cluster.length > 0 && it.from >= clusterEnd) flush();
		let lane = laneEnds.findIndex((e) => e <= it.from);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(0);
		}
		laneEnds[lane] = Math.max(laneEnds[lane], it.to);
		it.lane = lane;
		cluster.push(it);
		clusterEnd = Math.max(clusterEnd, it.to);
	}
	flush();
}

/** When a session ends, for drawing. A Live Session is drawn as far as it has
    got — the same "truth so far" rule the stat cards follow. An end before its
    start is a correction someone is midway through typing; it draws as an
    instant rather than as a negative block. */
function endOf(e: Entry, now: number): number {
	const end = e.ended_at ?? now;
	return Math.max(end, e.occurred_at);
}

/** A **Combined Feed** is one sitting of milk taken from more than one source —
    pumped breast milk, then formula — logged as the several Feeds it was rather
    than as one, and never merged (CONTEXT.md, ADR-0019). It follows from two
    Feeds close together and is never recorded as such, which is exactly what
    makes it a drawing question: two blocks a minute apart are one answer to
    *has she eaten*, and the grid should say so.

    The rule is `stats.ts`'s, imported rather than restated — the cards already
    count feeds as rounds, and a grid that drew a different grouping from the
    card underneath it would be the screen disagreeing with itself. */
function feedRounds(feeds: Entry[], now: number): Entry[][] {
	const rounds: Entry[][] = [];
	let edge = -Infinity;
	for (const e of feeds) {
		if (rounds.length === 0 || e.occurred_at - edge >= FEED_ROUND_GAP_MS) rounds.push([e]);
		else rounds[rounds.length - 1].push(e);
		edge = Math.max(edge, endOf(e, now));
	}
	return rounds;
}

export function buildGrid(input: GridInput): GridColumn[] {
	const { babyId, dayStart, zone, now, keys } = input;
	const markSlotMs = input.markSlotMs ?? 0;
	const wanted = input.facets && input.facets.length > 0 ? new Set(input.facets) : null;

	const mine = input.entries.filter(
		(e) => live(e) && e.baby_id === babyId && (wanted == null || wanted.has(FACET_OF[e.type]))
	);
	/* Sorted once, so every column's `ordered` list falls out in order and the
	   lane packing starts from a stable sequence. */
	mine.sort((a, b) => a.occurred_at - b.occurred_at || (a.id < b.id ? -1 : 1));

	/* Grouped once, over the whole log rather than per column, so a Combined
	   Feed that straddles a Day Start is the same sitting on both sides of it.
	   Everything that is not a Feed is a group of one. */
	const rounds = feedRounds(
		mine.filter((e) => isFeed(e.type)),
		now
	);
	const roundOf = new Map<string, Entry[]>();
	for (const round of rounds) roundOf.set(round[0].id, round);
	const groups: Entry[][] = [];
	for (const e of mine) {
		if (!isFeed(e.type)) groups.push([e]);
		else if (roundOf.has(e.id)) groups.push(roundOf.get(e.id)!);
	}

	return keys.map((key) => {
		const start = dayStartInstant(key, dayStart, zone);
		const end = dayStartInstant(addDays(key, 1), dayStart, zone);
		const span = Math.max(1, end - start);

		const blocks: GridBlock[] = [];
		const marks: GridMark[] = [];
		const ordered: Entry[] = [];

		for (const group of groups) {
			const first = group[0];
			const last = group[group.length - 1];
			const facet = FACET_OF[first.type];
			if (isSession(first.type)) {
				const opens = first.occurred_at;
				const stop = endOf(last, now);
				/* Touching, not contained: a night Sleep is drawn in both the column
				   it started in and the one its tail runs into. A zero-length
				   session still counts as touching the column it sits in. */
				const touches = opens < end && (stop > start || (stop === start && opens >= start));
				if (!touches) continue;
				const width = Math.max(1, stop - opens);
				let run = 0;
				let runKey = '';
				blocks.push({
					entry: first,
					members: group.map((e, index) => {
						/* Consecutive, not global: the sitting is a sequence, and
						   breast → formula → breast is three things in the order they
						   happened rather than two things reordered. */
						const key = feedContentKey(e);
						if (index > 0 && key !== runKey) run += 1;
						runKey = key;
						return {
							entry: e,
							from: (e.occurred_at - opens) / width,
							to: (endOf(e, now) - opens) / width,
							run
						};
					}),
					facet,
					from: clamp01((opens - start) / span),
					to: clamp01((stop - start) / span),
					clippedStart: opens < start,
					clippedEnd: stop > end,
					running: last.ended_at == null,
					ground: facet === 'sleep',
					lane: 0,
					lanes: 1
				});
				for (const e of group) ordered.push(e);
			} else {
				const e = first;
				if (e.occurred_at < start || e.occurred_at >= end) continue;
				marks.push({
					entry: e,
					facet,
					at: clamp01((e.occurred_at - start) / span),
					lane: 0,
					lanes: 1
				});
				ordered.push(e);
			}
		}

		/* Three independent packings. Sleeps only ever collide after a
		   correction someone has half-finished, but when they do the lanes are
		   what stops one hiding the other. */
		packLanes(blocks.filter((b) => b.ground));
		packLanes(blocks.filter((b) => !b.ground));
		if (markSlotMs > 0) {
			const slot = markSlotMs / span;
			const packable = marks.map((mk) => ({ from: mk.at, to: mk.at + slot, lane: 0, lanes: 1 }));
			packLanes(packable);
			packable.forEach((p, i) => {
				marks[i].lane = p.lane;
				marks[i].lanes = p.lanes;
			});
		}

		ordered.sort((a, b) => a.occurred_at - b.occurred_at || (a.id < b.id ? -1 : 1));

		return {
			key,
			start,
			end,
			isToday: now >= start && now < end,
			now: now >= start && now < end ? (now - start) / span : null,
			ticks: hourTicks(start, end, zone),
			blocks,
			marks,
			ordered
		};
	});
}

/** The facets with something to draw in this window — the legend's admission
    test, and the same rule the stat cards follow: a type with no data in the
    window has no chip, so nothing on the screen is an empty category. */
export function facetsPresent(input: Omit<GridInput, 'facets' | 'markSlotMs'>): FacetKey[] {
	const columns = buildGrid({ ...input, markSlotMs: 0 });
	const seen = new Set<FacetKey>();
	for (const col of columns) {
		for (const b of col.blocks) seen.add(b.facet);
		for (const mk of col.marks) seen.add(mk.facet);
	}
	/* In the palette's own order, so the legend never reshuffles itself as the
	   week changes. */
	return (['sleep', 'feed', 'nappy', 'meal', 'tummy', 'measure', 'milestone'] as const).filter((f) =>
		seen.has(f)
	);
}
