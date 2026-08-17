import { describe, expect, it } from 'vitest';
import { anchorInstant, dueInstant, headerState, seedTargets, typicalFor } from './targets';
import type { Entry, Target } from './types';

const BERLIN = 'Europe/Berlin';
const iso = (s: string) => Date.parse(s);

function entry(p: Partial<Entry> & { type: Entry['type']; occurred_at: number }): Entry {
	return {
		id: p.id ?? `e-${p.occurred_at}`,
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

const feedTarget: Target = {
	id: 't1',
	household_id: 'h1',
	baby_id: 'b1',
	activity: 'feed',
	duration_s: 3 * 3600,
	anchor: 'feed_start',
	deleted_at: null
};
const sleepTarget: Target = { ...feedTarget, id: 't2', activity: 'sleep', duration_s: 2 * 3600, anchor: 'sleep_end' };

describe('the age table', () => {
	it('seeds one Target per activity from the birth date', () => {
		const seeds = seedTargets('2026-06-17', iso('2026-08-17T12:00:00Z'), BERLIN);
		expect(seeds.map((s) => [s.activity, s.duration_s, s.anchor])).toEqual([
			['feed', 3 * 3600, 'feed_start'],
			['sleep', 75 * 60, 'sleep_end']
		]);
	});

	it('stops seeding a feed Target after twelve months, when solids take over', () => {
		const seeds = seedTargets('2025-01-17', iso('2026-08-17T12:00:00Z'), BERLIN);
		expect(seeds.map((s) => s.activity)).toEqual(['sleep']);
		expect(seeds[0].duration_s).toBe(5 * 3600);
	});

	it('offers a typical value as a static hint, never as a state', () => {
		expect(typicalFor('sleep', 3)).toBe(2 * 3600);
		expect(typicalFor('feed', 4)).toBe(3.5 * 3600);
		expect(typicalFor('feed', 13)).toBeNull();
	});
});

describe('dueInstant', () => {
	it('is a duration added to its anchor, and lives in exactly one place', () => {
		// v2 push notifications call this same function rather than
		// reimplementing it (spec §2).
		expect(dueInstant(feedTarget, iso('2026-08-17T10:00:00Z'))).toBe(iso('2026-08-17T13:00:00Z'));
	});

	it('measures a Feed from the previous Feed s start and a Wake Window from the last Sleep s end', () => {
		const feeds = [entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T10:00:00Z') })];
		const sleeps = [
			entry({
				type: 'sleep',
				occurred_at: iso('2026-08-17T11:00:00Z'),
				ended_at: iso('2026-08-17T12:30:00Z')
			})
		];
		expect(anchorInstant(feedTarget, [...feeds, ...sleeps])).toBe(iso('2026-08-17T10:00:00Z'));
		expect(anchorInstant(sleepTarget, [...feeds, ...sleeps])).toBe(iso('2026-08-17T12:30:00Z'));
	});

	it('has no anchor at all when nothing has been logged', () => {
		expect(anchorInstant(feedTarget, [])).toBeNull();
	});
});

describe('headerState', () => {
	const now = iso('2026-08-17T14:10:00Z');
	const base = {
		now,
		dayStart: '05:00',
		zone: BERLIN,
		babyId: 'b1',
		targets: [feedTarget, sleepTarget]
	};

	it('never computes a due instant from nothing', () => {
		// Empty state: no Feed logged yet means no elapsed figure and no due
		// figure (spec §8.4).
		const h = headerState({ ...base, entries: [] });
		expect(h.feed.lastAt).toBeNull();
		expect(h.feed.elapsedMs).toBeNull();
		expect(h.feed.dueAt).toBeNull();
		expect(h.feed.overdue).toBe(false);
	});

	it('reports elapsed since the last Feed and when the next is due', () => {
		const h = headerState({
			...base,
			entries: [entry({ type: 'breast_feed', occurred_at: iso('2026-08-17T12:00:00Z') })]
		});
		expect(h.feed.elapsedMs).toBe(2 * 3600_000 + 10 * 60_000);
		expect(h.feed.dueAt).toBe(iso('2026-08-17T15:00:00Z'));
		expect(h.feed.overdue).toBe(false);
		expect(h.feed.remainingMs).toBe(50 * 60_000);
	});

	it('shifts colour once when overdue, and there is no second state to shift to', () => {
		const h = headerState({
			...base,
			entries: [entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T10:00:00Z') })]
		});
		expect(h.feed.overdue).toBe(true);
		expect(h.feed.overdueMs).toBe(70 * 60_000);
	});

	it('replaces elapsed with an absolute time past a day', () => {
		const h = headerState({
			...base,
			entries: [entry({ type: 'bottle_feed', occurred_at: iso('2026-08-16T12:00:00Z') })]
		});
		expect(h.feed.absolute).toBe(true);
		expect(h.feed.lastAt).toBe(iso('2026-08-16T12:00:00Z'));
	});

	it('keeps the feed clock running while she sleeps', () => {
		// A Baby who has slept three hours still has not eaten for three hours
		// — precisely the fact the app was opened for (spec §8.4).
		const h = headerState({
			...base,
			entries: [
				entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T10:00:00Z') }),
				entry({ type: 'sleep', occurred_at: iso('2026-08-17T11:00:00Z') })
			]
		});
		expect(h.sleep.running).not.toBeNull();
		expect(h.feed.elapsedMs).toBe(4 * 3600_000 + 10 * 60_000);
		expect(h.feed.overdue).toBe(true);
	});

	it('does not show a Wake Window while a Sleep runs', () => {
		const h = headerState({
			...base,
			entries: [
				entry({
					type: 'sleep',
					occurred_at: iso('2026-08-17T13:05:00Z'),
					ended_at: null
				})
			]
		});
		expect(h.sleep.asleepMs).toBe(65 * 60_000);
		expect(h.sleep.awakeMs).toBeNull();
		expect(h.sleep.dueAt).toBeNull();
	});

	it('shows awake time and when she is due down once she is up', () => {
		const h = headerState({
			...base,
			entries: [
				entry({
					type: 'sleep',
					occurred_at: iso('2026-08-17T11:00:00Z'),
					ended_at: iso('2026-08-17T12:50:00Z')
				})
			]
		});
		expect(h.sleep.running).toBeNull();
		expect(h.sleep.awakeMs).toBe(80 * 60_000);
		expect(h.sleep.dueAt).toBe(iso('2026-08-17T14:50:00Z'));
		expect(h.sleep.overdue).toBe(false);
	});

	it('counts today s nappies, split, with no target of any kind', () => {
		const h = headerState({
			...base,
			entries: [
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T06:00:00Z'),
					payload: { pee: true, poop: false, consistency: null }
				}),
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T09:00:00Z'),
					payload: { pee: true, poop: true, consistency: 'soft' }
				}),
				/* yesterday, before the 05:00 boundary */
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T02:00:00Z'),
					payload: { pee: true, poop: false, consistency: null }
				})
			]
		});
		expect(h.nappies).toEqual({ total: 2, pee: 2, poop: 1 });
	});

	it('ignores tombstoned and merged-away rows', () => {
		const h = headerState({
			...base,
			entries: [
				entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T13:00:00Z'), deleted_at: 1 }),
				entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T12:00:00Z') })
			]
		});
		expect(h.feed.lastAt).toBe(iso('2026-08-17T12:00:00Z'));
	});

	it('reports nothing about a Baby it was not asked about', () => {
		const other = entry({ type: 'bottle_feed', occurred_at: now - 1000 });
		other.baby_id = 'b2';
		const h = headerState({ ...base, entries: [other] });
		expect(h.feed.lastAt).toBeNull();
	});
});
