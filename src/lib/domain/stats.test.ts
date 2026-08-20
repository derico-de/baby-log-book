import { describe, expect, it } from 'vitest';
import { statsFor, type FeedsSecondary, type SleepSecondary, type SolidsSecondary } from './stats';
import type { Entry } from './types';

const BERLIN = 'Europe/Berlin';
const iso = (s: string) => Date.parse(s);
const NOW = iso('2026-08-17T14:00:00Z'); /* 16:00 Berlin, day bucket 2026-08-17 */
const LENS = { dayStart: '05:00', zone: BERLIN, babyId: 'b1', now: NOW };

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

const nappy = (at: string, pee = true, poop = false) =>
	entry({ type: 'nappy', occurred_at: iso(at), payload: { pee, poop, consistency: null } });
const bottle = (at: string, ml: number | null = 120, leftover: number | null = null) =>
	entry({
		type: 'bottle_feed',
		occurred_at: iso(at),
		payload: { volume_ml: ml, leftover_ml: leftover, contents: 'formula' }
	});
const meal = (at: string, foods: string[] = ['f1']) =>
	entry({
		type: 'meal',
		occurred_at: iso(at),
		payload: { foods: foods.map((food_id) => ({ food_id, amount: 'some', reaction: null })) }
	});
const sleep = (from: string, to: string | null) =>
	entry({ type: 'sleep', occurred_at: iso(from), ended_at: to == null ? null : iso(to) });

describe('the window', () => {
	it('is eight bars, the last of which is today', () => {
		const cards = statsFor({ ...LENS, entries: [nappy('2026-08-17T08:00:00Z')] });
		expect(cards).toHaveLength(1);
		expect(cards[0].bars).toHaveLength(8);
		expect(cards[0].bars.map((b) => b.key)).toEqual([
			'2026-08-10',
			'2026-08-11',
			'2026-08-12',
			'2026-08-13',
			'2026-08-14',
			'2026-08-15',
			'2026-08-16',
			'2026-08-17'
		]);
		expect(cards[0].bars.at(-1)).toMatchObject({ isToday: true, value: 1 });
	});

	it('excludes today from the delta', () => {
		// Including a half-finished day would tell you every single morning that
		// things are getting worse (spec §9.1).
		const complete = ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];
		const entries = [
			/* two a day across the complete days, and one so far today */
			...complete.flatMap((d) => [nappy(`${d}T08:00:00Z`), nappy(`${d}T14:00:00Z`)]),
			nappy('2026-08-10T08:00:00Z'),
			nappy('2026-08-10T14:00:00Z'),
			nappy('2026-08-17T08:00:00Z'),
			/* the seven days before, one a day */
			...['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'].map(
				(d) => nappy(`${d}T08:00:00Z`)
			)
		];
		const [card] = statsFor({ ...LENS, entries });
		expect(card.average).toBe(2);
		expect(card.today).toBe(1);
		expect(card.delta).toBe(1);
	});

	it('has no delta at all when there is no history to compare with', () => {
		const [card] = statsFor({ ...LENS, entries: [nappy('2026-08-16T08:00:00Z')] });
		expect(card.delta).toBeNull();
	});
});

describe('unlogged days', () => {
	it('leaves days nobody logged on out of the average', () => {
		/* Two a day on three logged days; the other four complete days are
		   untracked, not zero — the average is 2, not 6/7ths of it. */
		const entries = ['2026-08-14', '2026-08-15', '2026-08-16'].flatMap((d) => [
			nappy(`${d}T08:00:00Z`),
			nappy(`${d}T14:00:00Z`)
		]);
		const [card] = statsFor({ ...LENS, entries });
		expect(card.average).toBe(2);
	});

	it('still counts a logged day without the type as a real zero', () => {
		const entries = [
			nappy('2026-08-15T08:00:00Z'),
			nappy('2026-08-15T14:00:00Z'),
			/* A bottle makes the 16th a logged day — its zero nappies are real. */
			bottle('2026-08-16T08:00:00Z')
		];
		const nappies = statsFor({ ...LENS, entries }).find((c) => c.kind === 'nappies');
		expect(nappies?.average).toBe(1);
	});

	it('states no average at all on the first day of use', () => {
		const [card] = statsFor({ ...LENS, entries: [nappy('2026-08-17T08:00:00Z')] });
		expect(card.average).toBeNull();
		expect(card.delta).toBeNull();
	});

	it('measures the delta against the previous week’s logged days only', () => {
		const entries = [
			/* previous week: two logged days, one a day */
			nappy('2026-08-05T08:00:00Z'),
			nappy('2026-08-07T08:00:00Z'),
			/* this week: two logged complete days, two a day */
			...['2026-08-14', '2026-08-15'].flatMap((d) => [nappy(`${d}T08:00:00Z`), nappy(`${d}T14:00:00Z`)])
		];
		const [card] = statsFor({ ...LENS, entries });
		expect(card.delta).toBe(1);
	});
});

describe('which cards appear', () => {
	it('shows nothing at all for an empty window', () => {
		expect(statsFor({ ...LENS, entries: [] })).toEqual([]);
	});

	it('gives a newborn no Solids card, with no age logic anywhere', () => {
		const cards = statsFor({ ...LENS, entries: [bottle('2026-08-16T08:00:00Z'), sleep('2026-08-16T20:00:00Z', '2026-08-17T04:00:00Z')] });
		expect(cards.map((c) => c.kind)).toEqual(['sleep', 'feeds']);
	});

	it('gives Milestones no card, however many there are', () => {
		const milestone = entry({
			type: 'milestone',
			occurred_at: iso('2026-08-16T03:00:00Z'),
			payload: { name: 'First tooth' }
		});
		expect(statsFor({ ...LENS, entries: [milestone] })).toEqual([]);
	});

	it('ignores tombstoned rows and other Babies', () => {
		const other = { ...nappy('2026-08-16T08:00:00Z'), baby_id: 'b2' };
		const deleted = { ...nappy('2026-08-16T09:00:00Z'), deleted_at: 1 };
		expect(statsFor({ ...LENS, entries: [other, deleted] })).toEqual([]);
	});
});

describe('the Sleep card', () => {
	it('attributes a night to the day it began', () => {
		const [card] = statsFor({ ...LENS, entries: [sleep('2026-08-16T18:00:00Z', '2026-08-17T04:00:00Z')] });
		const bar = card.bars.find((b) => b.key === '2026-08-16');
		expect(bar?.value).toBe(10 * 3600_000);
		expect(card.bars.find((b) => b.key === '2026-08-17')?.value).toBe(0);
	});

	it('counts a running Sleep up to now, so the bar grows live', () => {
		const [card] = statsFor({ ...LENS, entries: [sleep('2026-08-17T13:00:00Z', null)] });
		expect(card.today).toBe(3600_000);
	});

	it('splits Night Sleep from Naps and reports the longest stretch', () => {
		const [card] = statsFor({
			...LENS,
			entries: [
				sleep('2026-08-16T18:00:00Z', '2026-08-17T04:00:00Z') /* night, 10h */,
				sleep('2026-08-16T11:00:00Z', '2026-08-16T12:30:00Z') /* nap, 1h30 */
			]
		});
		const s = card.secondary as SleepSecondary;
		expect(s.nightMs).toBe(10 * 3600_000);
		expect(s.napMs).toBe(90 * 60_000);
		expect(s.longestMs).toBe(10 * 3600_000);
	});
});

describe('the Feeds card', () => {
	it('counts feeds and leaves volume out entirely when there are no bottles', () => {
		const breast = entry({ type: 'breast_feed', occurred_at: iso('2026-08-16T08:00:00Z'), payload: { side: 'left' } });
		const [card] = statsFor({ ...LENS, entries: [breast] });
		expect(card.bars.find((b) => b.key === '2026-08-16')?.value).toBe(1);
		expect(card.secondary).toEqual({ volumeMlToday: null, volumeMlAverage: null });
	});

	it('adds volume as a secondary number once bottles exist', () => {
		const [card] = statsFor({
			...LENS,
			entries: [bottle('2026-08-17T08:00:00Z', 120), bottle('2026-08-17T11:00:00Z', 90), bottle('2026-08-16T08:00:00Z', 100)]
		});
		const s = card.secondary as FeedsSecondary;
		expect(s.volumeMlToday).toBe(210);
		/* One logged complete day at 100 ml — unlogged days do not dilute it. */
		expect(s.volumeMlAverage).toBe(100);
	});

	it('carries each day’s volume on the bars once bottles exist', () => {
		const [card] = statsFor({
			...LENS,
			entries: [bottle('2026-08-17T08:00:00Z', 120), bottle('2026-08-16T08:00:00Z', 100)]
		});
		expect(card.bars.find((b) => b.key === '2026-08-17')?.volumeMl).toBe(120);
		expect(card.bars.find((b) => b.key === '2026-08-16')?.volumeMl).toBe(100);
		/* A bottle-feeding week states zero on a bottleless day, not nothing. */
		expect(card.bars.find((b) => b.key === '2026-08-15')?.volumeMl).toBe(0);
	});

	it('puts no volume on the bars of a breastfed week', () => {
		const breast = entry({ type: 'breast_feed', occurred_at: iso('2026-08-16T08:00:00Z'), payload: { side: 'left' } });
		const [card] = statsFor({ ...LENS, entries: [breast] });
		expect(card.bars.every((b) => b.volumeMl === undefined)).toBe(true);
	});

	it('counts what she drank, not what was poured', () => {
		// 180 ml offered with 30 ml left in the bottle is 150 ml of milk.
		const [card] = statsFor({
			...LENS,
			entries: [bottle('2026-08-17T08:00:00Z', 180, 30), bottle('2026-08-17T11:00:00Z', 90, 0)]
		});
		expect((card.secondary as FeedsSecondary).volumeMlToday).toBe(240);
	});

	it('counts a combined feed as the two bottles it was', () => {
		// Pumped breast milk, then formula: two Feeds, two volumes, both real.
		const [card] = statsFor({
			...LENS,
			entries: [
				entry({
					type: 'bottle_feed',
					occurred_at: iso('2026-08-17T08:00:00Z'),
					payload: { volume_ml: 60, leftover_ml: null, contents: 'breast_milk' }
				}),
				bottle('2026-08-17T08:12:00Z', 120)
			]
		});
		expect(card.today).toBe(2);
		expect((card.secondary as FeedsSecondary).volumeMlToday).toBe(180);
	});

	it('does not count a breast feed as zero millilitres', () => {
		const breast = entry({ type: 'breast_feed', occurred_at: iso('2026-08-17T08:00:00Z'), payload: { side: 'both' } });
		const [card] = statsFor({ ...LENS, entries: [breast, bottle('2026-08-17T09:00:00Z', 150)] });
		expect((card.secondary as FeedsSecondary).volumeMlToday).toBe(150);
		expect(card.today).toBe(2);
	});
});

describe('the Solids card', () => {
	it('counts new Foods this week from first exposure', () => {
		const cards = statsFor({
			...LENS,
			entries: [
				meal('2026-06-01T10:00:00Z', ['carrot']) /* long before the window */,
				meal('2026-08-15T10:00:00Z', ['carrot', 'broccoli']),
				meal('2026-08-16T10:00:00Z', ['yoghurt'])
			]
		});
		const card = cards.find((c) => c.kind === 'solids');
		expect((card?.secondary as SolidsSecondary).newFoods).toBe(2);
	});

	it('does not call a Food new because an earlier Meal was corrected away', () => {
		const cards = statsFor({
			...LENS,
			entries: [
				{ ...meal('2026-06-01T10:00:00Z', ['carrot']), deleted_at: 1 },
				meal('2026-08-15T10:00:00Z', ['carrot'])
			]
		});
		expect((cards.find((c) => c.kind === 'solids')?.secondary as SolidsSecondary).newFoods).toBe(1);
	});
});

describe('the Nappies card', () => {
	it('splits pee and poop for today', () => {
		const [card] = statsFor({
			...LENS,
			entries: [nappy('2026-08-17T08:00:00Z', true, false), nappy('2026-08-17T10:00:00Z', true, true)]
		});
		expect(card.secondary).toEqual({ peeToday: 2, poopToday: 1 });
	});
});
