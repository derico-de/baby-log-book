import { describe, expect, it } from 'vitest';
import {
	anchorInstant,
	bottleLife,
	bottlesNearingEnd,
	bottleTargetOf,
	BOTTLE_CHIME_LEAD_MS,
	dueInstant,
	pastBottleRevision,
	headerState,
	napTargetOf,
	nightPeriodOf,
	nightStartValue,
	planPastBottles,
	seedTargets,
	typicalFor,
	MS
} from './targets';
import { wallToInstant } from './time';
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
			['bottle', 3600, 'bottle_start'],
			['nap', 90 * 60, 'sleep_start']
		]);
	});

	it('stops seeding a feed Target after twelve months, when solids take over', () => {
		const seeds = seedTargets('2025-01-17', iso('2026-08-17T12:00:00Z'), BERLIN);
		expect(seeds.map((s) => s.activity)).toEqual(['sleep', 'bottle', 'nap']);
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

	it('gives the Nap Length no age table either — one nap varies more than one age does', () => {
		expect(typicalFor('nap', 0)).toBe(90 * 60);
		expect(typicalFor('nap', 24)).toBe(90 * 60);
	});
});

describe('the Nap Length', () => {
	it('falls back to the seeded hour and a half for a Baby added before the Target existed', () => {
		expect(napTargetOf([feedTarget, sleepTarget], 'b1')).toMatchObject({
			baby_id: 'b1',
			activity: 'nap',
			duration_s: 90 * 60,
			anchor: 'sleep_start'
		});
	});

	it('is the stored Target once a Parent has typed one', () => {
		const nap: Target = { ...feedTarget, id: 't4', activity: 'nap', duration_s: 45 * 60, anchor: 'sleep_start' };
		expect(napTargetOf([feedTarget, nap], 'b1')).toBe(nap);
	});

	it('measures from the start of the Sleep she is in, never from one that ended', () => {
		const ended = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-17T08:00:00Z'),
			ended_at: iso('2026-08-17T09:00:00Z')
		});
		const open = entry({ type: 'sleep', occurred_at: iso('2026-08-17T13:00:00Z') });
		expect(anchorInstant({ anchor: 'sleep_start' }, [ended, open])).toBe(iso('2026-08-17T13:00:00Z'));
		expect(anchorInstant({ anchor: 'sleep_start' }, [ended])).toBeNull();
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

describe('a bottle nearing its end', () => {
	/* The bottle Target is an hour, so a bottle started at 13:00 is due at 14:00
	   and its last ten minutes begin at 13:50. */
	const started = iso('2026-08-17T13:00:00Z');
	const open = entry({ id: 'f1', type: 'bottle_feed', occurred_at: started });

	it('says nothing until the last ten minutes have begun', () => {
		expect(bottlesNearingEnd([open], [bottleTarget], iso('2026-08-17T13:49:00Z'))).toEqual([]);
	});

	it('names the bottle once the last ten minutes have begun', () => {
		expect(bottlesNearingEnd([open], [bottleTarget], iso('2026-08-17T13:51:00Z'))).toEqual(['f1']);
	});

	it('says nothing about a bottle already past its Life — that Feed is over', () => {
		expect(bottlesNearingEnd([open], [bottleTarget], iso('2026-08-17T14:01:00Z'))).toEqual([]);
	});

	it('says nothing at the due instant itself', () => {
		expect(bottlesNearingEnd([open], [bottleTarget], iso('2026-08-17T14:00:00Z'))).toEqual([]);
	});

	it('touches nothing that is not an open bottle', () => {
		const stopped = entry({ type: 'bottle_feed', occurred_at: started, ended_at: started + 60_000 });
		const breast = entry({ type: 'breast_feed', occurred_at: started });
		const deleted = entry({ type: 'bottle_feed', occurred_at: started, deleted_at: started });
		const merged = entry({ type: 'bottle_feed', occurred_at: started, merged_into: 'f9' });
		const at = iso('2026-08-17T13:55:00Z');
		expect(bottlesNearingEnd([stopped, breast, deleted, merged], [bottleTarget], at)).toEqual([]);
	});

	it('counts against the seeded hour for a Baby with no stored bottle Target', () => {
		const at = iso('2026-08-17T13:55:00Z');
		expect(bottlesNearingEnd([open], [feedTarget, sleepTarget], at)).toEqual(['f1']);
	});

	it('reads each Baby against their own Target, and speaks for both', () => {
		const sibling = entry({ id: 'f2', type: 'bottle_feed', occurred_at: iso('2026-08-17T13:30:00Z') });
		sibling.baby_id = 'b2';
		const short: Target = { ...bottleTarget, id: 't9', baby_id: 'b2', duration_s: 1800 };
		const at = iso('2026-08-17T13:55:00Z');
		expect(bottlesNearingEnd([open, sibling], [bottleTarget, short], at)).toEqual(['f1', 'f2']);
	});

	it('never sounds at the start of a Life shorter than the lead: the warning is halved instead', () => {
		/* Ten minutes of warning on a ten-minute Life would be the feed itself. */
		const short: Target = { ...bottleTarget, duration_s: 600 };
		expect(bottlesNearingEnd([open], [short], started + 60_000)).toEqual([]);
		expect(bottlesNearingEnd([open], [short], started + 6 * 60_000)).toEqual(['f1']);
	});

	it('says nothing when the Household has typed a Life of nothing', () => {
		const none: Target = { ...bottleTarget, duration_s: 0 };
		expect(bottlesNearingEnd([open], [none], iso('2026-08-17T13:55:00Z'))).toEqual([]);
	});

	it('warns ten minutes ahead', () => {
		expect(BOTTLE_CHIME_LEAD_MS).toBe(10 * 60_000);
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
		/* No Night Period unless a case states one: the header must read the
		   same as it did before the setting existed (ADR-0032). */
		night: null,
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
		expect(h.feed.progress).toBeNull();
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
		// 2h10 of a 3h interval has run — the share the header's bar fills to.
		expect(h.feed.progress).toBeCloseTo(130 / 180);
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
		// The bar is full and stays full: the figure reports how far past.
		expect(h.feed.progress).toBe(1);
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

	it('does not show a Wake Window while a Sleep runs — the bar fills toward the Nap Length instead', () => {
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
		expect(h.sleep.kind).toBe('nap');
		// No nap Target is stored here, so the seeded hour and a half counts
		// from the instant she went down (ADR-0046).
		expect(h.sleep.dueAt).toBe(iso('2026-08-17T14:35:00Z'));
		expect(h.sleep.remainingMs).toBe(25 * 60_000);
		expect(h.sleep.overdue).toBe(false);
		expect(h.sleep.progress).toBeCloseTo(65 / 90);
	});

	it('reads the Nap Length the Household typed', () => {
		const nap: Target = { ...feedTarget, id: 't4', activity: 'nap', duration_s: 45 * 60, anchor: 'sleep_start' };
		const h = headerState({
			...base,
			targets: [...base.targets, nap],
			entries: [entry({ type: 'sleep', occurred_at: iso('2026-08-17T13:40:00Z') })]
		});
		expect(h.sleep.dueAt).toBe(iso('2026-08-17T14:25:00Z'));
		expect(h.sleep.progress).toBeCloseTo(30 / 45);
	});

	it('pins the bar full once a Nap runs past its length, and says how long by', () => {
		const h = headerState({
			...base,
			entries: [entry({ type: 'sleep', occurred_at: iso('2026-08-17T12:00:00Z') })]
		});
		expect(h.sleep.kind).toBe('nap');
		expect(h.sleep.overdue).toBe(true);
		expect(h.sleep.overdueMs).toBe(40 * 60_000);
		expect(h.sleep.remainingMs).toBe(0);
		expect(h.sleep.progress).toBe(1);
	});

	it('measures a Sleep that crossed the Day Start against it, with no Night Period stated', () => {
		// Down at 02:00 Berlin and still asleep at 16:10: the crossing alone
		// makes it a Night Sleep (spec §7.2), and the 05:00 it crossed is the
		// end of what it was allowed.
		const h = headerState({
			...base,
			entries: [entry({ type: 'sleep', occurred_at: wallToInstant({ y: 2026, m: 8, d: 17, h: 2, mi: 0 }, BERLIN) })]
		});
		expect(h.sleep.kind).toBe('night');
		expect(h.sleep.dueAt).toBe(wallToInstant({ y: 2026, m: 8, d: 17, h: 5, mi: 0 }, BERLIN));
		expect(h.sleep.overdue).toBe(true);
		expect(h.sleep.progress).toBe(1);
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
		// 80 of the Wake Window's 120 minutes have run.
		expect(h.sleep.progress).toBeCloseTo(80 / 120);
	});

	it('counts today s nappies, split, with no target of any kind', () => {
		const h = headerState({
			...base,
			entries: [
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T06:00:00Z'),
					payload: { pee: true, poop: false, consistency: null, where: null }
				}),
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T09:00:00Z'),
					payload: { pee: true, poop: true, consistency: 'soft', where: null }
				}),
				/* yesterday, before the 05:00 boundary */
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T02:00:00Z'),
					payload: { pee: true, poop: false, consistency: null, where: null }
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
					payload: { pee: false, poop: true, consistency: null, where: null }
				}),
				entry({
					type: 'nappy',
					occurred_at: iso('2026-08-17T09:00:00Z'),
					payload: { pee: true, poop: false, consistency: null, where: null }
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
					payload: { pee: true, poop: false, consistency: null, where: null }
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

describe('a Feed due inside the Night Period', () => {
	// The Household states 21:00, and the Night ends at its Day Start — 07:00
	// here, not the 05:00 the rest of this file uses, because the pair is one
	// setting and the end is the Day Start (ADR-0032).
	const night = { start: '21:00', end: '07:00' };
	const at = (d: number, h: number, mi = 0) =>
		wallToInstant({ y: 2026, m: 8, d, h, mi }, BERLIN);
	const base = {
		dayStart: '07:00',
		zone: BERLIN,
		night,
		babyId: 'b1',
		targets: [feedTarget, sleepTarget]
	};

	it('comes due at the Day Start instead — the whole of what the setting does', () => {
		// Fed at 21:00 on a three-hour interval: midnight, and nobody has stated
		// an interval they mean to keep to at midnight.
		const h = headerState({
			...base,
			now: at(17, 22),
			entries: [entry({ type: 'breast_feed', occurred_at: at(17, 21) })]
		});
		expect(h.feed.dueAt).toBe(at(18, 7));
		expect(h.feed.remainingMs).toBe(9 * MS.hour);
		expect(h.feed.overdue).toBe(false);
		// The bar runs to the morning, not to the Target: one of ten hours.
		expect(h.feed.progress).toBeCloseTo(1 / 10);
	});

	it('holds the interval while the night has not begun — the bedtime Feed is still to come', () => {
		// Fed at 20:45 on a three-hour interval, read at 20:50: the due lands at
		// 23:45, inside the stated Night, but the evening is still running. The
		// morning is not the answer until the night is (ADR-0040).
		const fed = entry({ type: 'bottle_feed', occurred_at: at(17, 20, 45), ended_at: at(17, 20, 55) });
		const before = headerState({ ...base, now: at(17, 20, 50), entries: [fed] });
		expect(before.feed.dueAt).toBe(at(17, 23, 45));
		expect(before.feed.overdue).toBe(false);
		// The same log read at 22:00: the night has begun, that Feed was the
		// bedtime one, and the same due now belongs to the morning.
		const after = headerState({ ...base, now: at(17, 22), entries: [fed] });
		expect(after.feed.dueAt).toBe(at(18, 7));
	});

	it('holds the interval once the night has begun while the bedtime Feed is still to come', () => {
		// Fed at 18:35 on three hours, read at 21:30: the due at 21:35 is inside
		// the Night and the Night has begun — but the last Feed is two and a
		// half hours before the stated hour and the due is half an hour past
		// it. She is fed once more before anybody sleeps, so the interval
		// stands, and past 21:35 it is overdue like any other (ADR-0043).
		const fed = entry({ type: 'bottle_feed', occurred_at: at(17, 18, 35), ended_at: at(17, 18, 45) });
		const h = headerState({ ...base, now: at(17, 21, 30), entries: [fed] });
		expect(h.feed.dueAt).toBe(at(17, 21, 35));
		expect(h.feed.overdue).toBe(false);
		const later = headerState({ ...base, now: at(17, 22), entries: [fed] });
		expect(later.feed.dueAt).toBe(at(17, 21, 35));
		expect(later.feed.overdue).toBe(true);
		expect(later.feed.overdueMs).toBe(25 * MS.minute);
		// Once that bedtime Feed is logged, its own due is the morning's.
		const bedtime = entry({ type: 'bottle_feed', occurred_at: at(17, 21, 40), ended_at: at(17, 21, 50) });
		const fedAgain = headerState({ ...base, now: at(17, 22), entries: [fed, bedtime] });
		expect(fedAgain.feed.dueAt).toBe(at(18, 7));
	});

	it('reads the stated hour as nearer the last Feed at a tie', () => {
		// Fed at 19:30 on three hours: the hour is ninety minutes after the last
		// Feed and ninety minutes before the due. The last Feed is the bedtime
		// one — a Household whose bedtime Feed is at 19:30 is not fed at 22:30.
		const fed = entry({ type: 'breast_feed', occurred_at: at(17, 19, 30), ended_at: at(17, 19, 50) });
		expect(headerState({ ...base, now: at(17, 21, 30), entries: [fed] }).feed.dueAt).toBe(at(18, 7));
	});

	it('moves a night waking to the same morning', () => {
		const h = headerState({
			...base,
			now: at(18, 3, 30),
			entries: [entry({ type: 'bottle_feed', occurred_at: at(18, 3) })]
		});
		expect(h.feed.dueAt).toBe(at(18, 7));
	});

	it('leaves a daytime Feed to its own interval', () => {
		const h = headerState({
			...base,
			now: at(18, 13),
			entries: [entry({ type: 'breast_feed', occurred_at: at(18, 12) })]
		});
		expect(h.feed.dueAt).toBe(at(18, 15));
	});

	it('is still overdue past the Day Start, and says how long by', () => {
		const h = headerState({
			...base,
			now: at(18, 7, 20),
			entries: [entry({ type: 'breast_feed', occurred_at: at(17, 21) })]
		});
		expect(h.feed.overdue).toBe(true);
		expect(h.feed.overdueMs).toBe(20 * MS.minute);
	});

	it('fills a running Night Sleep s bar toward the Day Start — the night the Household already keeps', () => {
		// Down at 19:30 and read at 23:30: the Sleep has reached the night, so
		// its allowance ends at 07:00 and four of those eleven and a half hours
		// have run.
		const h = headerState({ ...base, now: at(17, 23, 30), entries: [entry({ type: 'sleep', occurred_at: at(17, 19, 30) })] });
		expect(h.sleep.kind).toBe('night');
		expect(h.sleep.dueAt).toBe(at(18, 7));
		expect(h.sleep.remainingMs).toBe(7.5 * 3600_000);
		expect(h.sleep.overdue).toBe(false);
		expect(h.sleep.progress).toBeCloseTo(4 / 11.5);
	});

	it('reads a bedtime as a Nap until the evening reaches the stated hour', () => {
		// The same 19:30 Sleep read at 20:30: the night has not begun, so an
		// hour of the hour-and-a-half Nap Length has run (ADR-0033).
		const h = headerState({ ...base, now: at(17, 20, 30), entries: [entry({ type: 'sleep', occurred_at: at(17, 19, 30) })] });
		expect(h.sleep.kind).toBe('nap');
		expect(h.sleep.dueAt).toBe(at(17, 21));
		expect(h.sleep.progress).toBeCloseTo(60 / 90);
	});

	it('is still asleep past the Day Start, and says how long by', () => {
		const h = headerState({ ...base, now: at(18, 7, 30), entries: [entry({ type: 'sleep', occurred_at: at(17, 19, 30) })] });
		expect(h.sleep.kind).toBe('night');
		expect(h.sleep.overdue).toBe(true);
		expect(h.sleep.overdueMs).toBe(30 * 60_000);
		expect(h.sleep.progress).toBe(1);
	});

	it('measures a small-hours Sleep against the same Day Start', () => {
		// Back down at 03:40, inside the night: the allowance ends at 07:00,
		// not an hour and a half later. The Day Start is the bucket boundary
		// and not her wake time, which is the cost ADR-0046 carries.
		const h = headerState({ ...base, now: at(18, 4, 40), entries: [entry({ type: 'sleep', occurred_at: at(18, 3, 40) })] });
		expect(h.sleep.kind).toBe('night');
		expect(h.sleep.dueAt).toBe(at(18, 7));
		expect(h.sleep.progress).toBeCloseTo(60 / 200);
	});

	it('does not touch the Wake Window — a night is not a reason to stay asleep', () => {
		// The Sleep Target is two hours and the Sleep ended at 23:00, so the next
		// one is due at 01:00 whatever the Night Period says (ADR-0032).
		const h = headerState({
			...base,
			now: at(17, 23, 30),
			entries: [
				entry({ type: 'sleep', occurred_at: at(17, 21), ended_at: at(17, 23) })
			]
		});
		expect(h.sleep.dueAt).toBe(at(18, 1));
	});

	it('does not touch a Bottle Life — milk does not keep longer in the dark', () => {
		const started = at(17, 22);
		const open = entry({ type: 'bottle_feed', occurred_at: started });
		expect(bottleLife(open, bottleTarget, at(17, 22, 30))?.dueAt).toBe(at(17, 23));
	});
});

describe('nightPeriodOf', () => {
	it('pairs the stated hour with the Day Start', () => {
		expect(nightPeriodOf({ night_start: '21:00', day_start: '07:00' })).toEqual({
			start: '21:00',
			end: '07:00'
		});
	});

	it('is none until a Household states one', () => {
		expect(nightPeriodOf({ night_start: null, day_start: '07:00' })).toBeNull();
		expect(nightPeriodOf(null)).toBeNull();
	});

	it('is none when the two hours are the same — an empty Night is no Night', () => {
		expect(nightPeriodOf({ night_start: '07:00', day_start: '07:00' })).toBeNull();
	});
});

describe('a stated Night Start', () => {
	it('takes an hour and nothing else', () => {
		expect(nightStartValue('21:00')).toBe('21:00');
		expect(nightStartValue('07:30')).toBe('07:30');
	});

	it('reads anything that is not an hour as no Night Period', () => {
		expect(nightStartValue(null)).toBeNull();
		expect(nightStartValue('')).toBeNull();
		expect(nightStartValue('9:00')).toBeNull();
		expect(nightStartValue('24:00')).toBeNull();
		expect(nightStartValue(2100)).toBeNull();
	});
});
