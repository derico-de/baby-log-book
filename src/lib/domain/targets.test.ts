import { describe, expect, it } from 'vitest';
import {
	anchorInstant,
	bottleLife,
	bottleTargetOf,
	dueInstant,
	pastBottleRevision,
	headerState,
	planPastBottles,
	seedTargets,
	typicalFor
} from './targets';
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
const bottleTarget: Target = { ...feedTarget, id: 't3', activity: 'bottle', duration_s: 3600, anchor: 'bottle_start' };

describe('the age table', () => {
	it('seeds one Target per activity from the birth date', () => {
		const seeds = seedTargets('2026-06-17', iso('2026-08-17T12:00:00Z'), BERLIN);
		expect(seeds.map((s) => [s.activity, s.duration_s, s.anchor])).toEqual([
			['feed', 3 * 3600, 'feed_start'],
			['sleep', 75 * 60, 'sleep_end'],
			['bottle', 3600, 'bottle_start']
		]);
	});

	it('stops seeding a feed Target after twelve months, when solids take over', () => {
		const seeds = seedTargets('2025-01-17', iso('2026-08-17T12:00:00Z'), BERLIN);
		expect(seeds.map((s) => s.activity)).toEqual(['sleep', 'bottle']);
		expect(seeds[0].duration_s).toBe(5 * 3600);
	});

	it('offers a typical value as a static hint, never as a state', () => {
		expect(typicalFor('sleep', 3)).toBe(2 * 3600);
		expect(typicalFor('feed', 4)).toBe(3.5 * 3600);
		expect(typicalFor('feed', 13)).toBeNull();
	});

	it('gives the Bottle Life no age table, because milk does not care how old she is', () => {
		expect(typicalFor('bottle', 0)).toBe(3600);
		expect(typicalFor('bottle', 24)).toBe(3600);
	});
});

describe('the Bottle Life', () => {
	const now = iso('2026-08-17T14:10:00Z');

	it('counts down from the start of a bottle that is still open', () => {
		const open = entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T13:50:00Z') });
		const life = bottleLife(open, bottleTarget, now);
		expect(life?.dueAt).toBe(iso('2026-08-17T14:50:00Z'));
		expect(life?.remainingMs).toBe(40 * 60_000);
		expect(life?.past).toBe(false);
		expect(life?.pastMs).toBeNull();
	});

	it('keeps counting past the stated hour rather than stopping or hiding', () => {
		const open = entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T12:50:00Z') });
		const life = bottleLife(open, bottleTarget, now);
		expect(life?.past).toBe(true);
		expect(life?.pastMs).toBe(20 * 60_000);
		// Clamped, so no screen ever has to print a negative countdown.
		expect(life?.remainingMs).toBe(0);
	});

	it('says nothing once the Feed has an end — a stopped bottle is not one anyone will offer again', () => {
		const done = entry({
			type: 'bottle_feed',
			occurred_at: iso('2026-08-17T13:50:00Z'),
			ended_at: iso('2026-08-17T14:05:00Z')
		});
		expect(bottleLife(done, bottleTarget, now)).toBeNull();
	});

	it('says nothing about a breast feed, which has no bottle to go off', () => {
		const breast = entry({ type: 'breast_feed', occurred_at: iso('2026-08-17T13:50:00Z') });
		expect(bottleLife(breast, bottleTarget, now)).toBeNull();
	});

	it('says nothing about a deleted or merged-away row', () => {
		const at = iso('2026-08-17T13:50:00Z');
		expect(bottleLife(entry({ type: 'bottle_feed', occurred_at: at, deleted_at: now }), bottleTarget, now)).toBeNull();
		expect(bottleLife(entry({ type: 'bottle_feed', occurred_at: at, merged_into: 'x' }), bottleTarget, now)).toBeNull();
	});

	it('falls back to the seeded hour for a Baby added before the Target existed', () => {
		expect(bottleTargetOf([feedTarget, sleepTarget], 'b1')).toMatchObject({
			activity: 'bottle',
			duration_s: 3600,
			anchor: 'bottle_start',
			baby_id: 'b1'
		});
		expect(bottleTargetOf([feedTarget, bottleTarget], 'b1').id).toBe('t3');
	});

	it('anchors on the older of two open bottles, because that is the one running out first', () => {
		const combined = [
			entry({ id: 'later', type: 'bottle_feed', occurred_at: iso('2026-08-17T14:00:00Z') }),
			entry({ id: 'earlier', type: 'bottle_feed', occurred_at: iso('2026-08-17T13:40:00Z') })
		];
		expect(anchorInstant(bottleTarget, combined)).toBe(iso('2026-08-17T13:40:00Z'));
	});

	it('has no anchor once every bottle has been stopped', () => {
		const done = [
			entry({
				type: 'bottle_feed',
				occurred_at: iso('2026-08-17T13:40:00Z'),
				ended_at: iso('2026-08-17T13:55:00Z')
			})
		];
		expect(anchorInstant(bottleTarget, done)).toBeNull();
	});
});

describe('a past bottle', () => {
	const now = iso('2026-08-17T14:10:00Z');

	it('ends an open bottle Feed at the due instant, not at now', () => {
		const open = entry({ id: 'f1', type: 'bottle_feed', occurred_at: iso('2026-08-17T12:50:00Z') });
		expect(planPastBottles([open], [bottleTarget], now)).toEqual([
			{ entry_id: 'f1', ended_at: iso('2026-08-17T13:50:00Z') }
		]);
	});

	it('leaves a bottle alone while its life is still running', () => {
		const open = entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T13:50:00Z') });
		expect(planPastBottles([open], [bottleTarget], now)).toEqual([]);
	});

	it('touches nothing that is not an open bottle', () => {
		const at = iso('2026-08-17T10:00:00Z');
		const stopped = entry({ type: 'bottle_feed', occurred_at: at, ended_at: at + 600_000 });
		const breast = entry({ type: 'breast_feed', occurred_at: at });
		const sleep = entry({ type: 'sleep', occurred_at: at });
		const deleted = entry({ type: 'bottle_feed', occurred_at: at, deleted_at: now });
		expect(planPastBottles([stopped, breast, sleep, deleted], [bottleTarget], now)).toEqual([]);
	});

	it('runs out against the seeded hour for a Baby with no stored bottle Target', () => {
		const open = entry({ id: 'f1', type: 'bottle_feed', occurred_at: iso('2026-08-17T12:50:00Z') });
		expect(planPastBottles([open], [feedTarget, sleepTarget], now)).toEqual([
			{ entry_id: 'f1', ended_at: iso('2026-08-17T13:50:00Z') }
		]);
	});

	it('is app-attributed, like a Session Merge', () => {
		const revision = pastBottleRevision(
			{ entry_id: 'f1', ended_at: iso('2026-08-17T13:50:00Z') },
			{ household_id: 'h1', at: now, device_id: 'server', id: 'bottle-past:f1' }
		);
		expect(revision.author_id).toBeNull();
		expect(revision.fields).toEqual({ ended_at: iso('2026-08-17T13:50:00Z') });
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

	it('surfaces the running Feed — the latest started when two are open at once', () => {
		const h = headerState({
			...base,
			entries: [
				entry({ type: 'breast_feed', occurred_at: iso('2026-08-17T12:00:00Z') }),
				entry({ type: 'bottle_feed', occurred_at: iso('2026-08-17T12:30:00Z') })
			]
		});
		expect(h.feed.running?.occurred_at).toBe(iso('2026-08-17T12:30:00Z'));
	});

	it('reports no running Feed once every Feed has ended, and a Meal never runs', () => {
		const h = headerState({
			...base,
			entries: [
				entry({
					type: 'bottle_feed',
					occurred_at: iso('2026-08-17T12:00:00Z'),
					ended_at: iso('2026-08-17T12:20:00Z')
				}),
				entry({ type: 'meal', occurred_at: iso('2026-08-17T13:00:00Z') })
			]
		});
		expect(h.feed.running).toBeNull();
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
		expect(h.nappies).toEqual({ total: 2, pee: 2, poop: 1, lastPoopAt: iso('2026-08-17T09:00:00Z') });
	});

	it('remembers the last poop past the Day Start — the gap is the fact', () => {
		// Today's count says 1 nappy and 0 poops; lastPoopAt still points at
		// yesterday's, because "she hasn't pooped since yesterday" is exactly
		// what the header exists to state.
		const h = headerState({
			...base,
			entries: [
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-16T15:00:00Z'),
					payload: { pee: false, poop: true, consistency: null }
				}),
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T09:00:00Z'),
					payload: { pee: true, poop: false, consistency: null }
				})
			]
		});
		expect(h.nappies.total).toBe(1);
		expect(h.nappies.poop).toBe(0);
		expect(h.nappies.lastPoopAt).toBe(iso('2026-08-16T15:00:00Z'));
	});

	it('reports no last poop when none was ever logged', () => {
		const h = headerState({
			...base,
			entries: [
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T09:00:00Z'),
					payload: { pee: true, poop: false, consistency: null }
				})
			]
		});
		expect(h.nappies.lastPoopAt).toBeNull();
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
