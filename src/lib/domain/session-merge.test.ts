import { describe, expect, it } from 'vitest';
import { mergeRevision, planSessionMerges, redirectRevision } from './session-merge';
import type { Entry, PendingRevision } from './types';

const iso = (s: string) => Date.parse(s);

function open(id: string, type: Entry['type'], at: string, baby = 'b1'): Entry {
	return {
		id,
		household_id: 'h1',
		baby_id: baby,
		type,
		occurred_at: iso(at),
		ended_at: null,
		recording_zone: 'Europe/Berlin',
		note: null,
		payload: {} as never,
		logged_by: 'mum',
		logged_at: iso(at),
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null
	} as Entry;
}

describe('planSessionMerges', () => {
	it('reconciles two open Sleeps for one Baby, earliest start winning', () => {
		const plans = planSessionMerges([
			open('s-late', 'sleep', '2026-08-17T19:05:00Z'),
			open('s-early', 'sleep', '2026-08-17T19:00:00Z')
		]);
		expect(plans).toEqual([{ survivor_id: 's-early', loser_id: 's-late', baby_id: 'b1' }]);
	});

	it('leaves an open Feed beside an open Sleep alone — that is a Sleep Feed', () => {
		// The single most common night pattern in the app. A kind-agnostic
		// merge would tombstone one of them (spec §5.3).
		expect(
			planSessionMerges([
				open('s1', 'sleep', '2026-08-17T19:00:00Z'),
				open('f1', 'breast_feed', '2026-08-17T22:00:00Z')
			])
		).toEqual([]);
	});

	it('leaves two open Feeds alone — a combined feed is two Feeds, not one', () => {
		// Pumped breast milk, then formula, minutes apart. Merging them would
		// tombstone the second bottle and lose it from the day's volume
		// (ADR-0014).
		expect(
			planSessionMerges([
				open('f-breast-milk', 'bottle_feed', '2026-08-17T10:00:00Z'),
				open('f-formula', 'bottle_feed', '2026-08-17T10:12:00Z')
			])
		).toEqual([]);
	});

	it('leaves a breast feed beside a bottle feed alone too', () => {
		expect(
			planSessionMerges([
				open('f-breast', 'breast_feed', '2026-08-17T10:00:00Z'),
				open('f-bottle', 'bottle_feed', '2026-08-17T10:02:00Z')
			])
		).toEqual([]);
	});

	it('never merges across Babies', () => {
		expect(
			planSessionMerges([
				open('s1', 'sleep', '2026-08-17T19:00:00Z', 'b1'),
				open('s2', 'sleep', '2026-08-17T19:00:00Z', 'b2')
			])
		).toEqual([]);
	});

	it('needs no time window at all: hours apart is still a contradiction', () => {
		const plans = planSessionMerges([
			open('s1', 'sleep', '2026-08-17T09:00:00Z'),
			open('s2', 'sleep', '2026-08-17T19:00:00Z')
		]);
		expect(plans).toHaveLength(1);
	});

	it('is deterministic on identical starts, so two runs agree', () => {
		const a = planSessionMerges([
			open('s-b', 'sleep', '2026-08-17T19:00:00Z'),
			open('s-a', 'sleep', '2026-08-17T19:00:00Z')
		]);
		const b = planSessionMerges([
			open('s-a', 'sleep', '2026-08-17T19:00:00Z'),
			open('s-b', 'sleep', '2026-08-17T19:00:00Z')
		]);
		expect(a).toEqual(b);
		expect(a[0].survivor_id).toBe('s-a');
	});

	it('folds three open Sleeps into one survivor', () => {
		const plans = planSessionMerges([
			open('s3', 'sleep', '2026-08-17T19:10:00Z'),
			open('s1', 'sleep', '2026-08-17T19:00:00Z'),
			open('s2', 'sleep', '2026-08-17T19:05:00Z')
		]);
		expect(plans.map((p) => p.loser_id).sort()).toEqual(['s2', 's3']);
		expect(new Set(plans.map((p) => p.survivor_id))).toEqual(new Set(['s1']));
	});

	it('ignores sessions that are closed, tombstoned or already merged', () => {
		const closed = { ...open('s2', 'sleep', '2026-08-17T19:05:00Z'), ended_at: iso('2026-08-17T20:00:00Z') };
		const merged = { ...open('s3', 'sleep', '2026-08-17T19:06:00Z'), merged_into: 's1' };
		expect(planSessionMerges([open('s1', 'sleep', '2026-08-17T19:00:00Z'), closed, merged])).toEqual([]);
	});

	it('is idempotent: running it again on the merged state plans nothing', () => {
		const survivor = open('s1', 'sleep', '2026-08-17T19:00:00Z');
		const loser = { ...open('s2', 'sleep', '2026-08-17T19:05:00Z'), deleted_at: 1, merged_into: 's1' };
		expect(planSessionMerges([survivor, loser])).toEqual([]);
	});
});

describe('mergeRevision', () => {
	it('is attributed to the app rather than to a Member', () => {
		const rev = mergeRevision(
			{ survivor_id: 's1', loser_id: 's2', baby_id: 'b1' },
			{ household_id: 'h1', at: 1000, device_id: 'server', id: 'r1' }
		);
		expect(rev.author_id).toBeNull();
		expect(rev.fields).toEqual({ deleted_at: 1000, merged_into: 's1' });
	});
});

describe('redirectRevision', () => {
	const chain = new Map([
		['s3', 's2'],
		['s2', 's1']
	]);
	const stop = (entity: string): PendingRevision => ({
		id: 'r1',
		household_id: 'h1',
		kind: 'entry',
		entity_id: entity,
		fields: { ended_at: 5000 },
		merge_at: 5000,
		device_id: 'phone-b',
		author_id: 'oma'
	});

	it('lands a late stop on the survivor, following the chain transitively', () => {
		expect(redirectRevision(stop('s3'), chain).entity_id).toBe('s1');
	});

	it('leaves an unmerged session where it is', () => {
		expect(redirectRevision(stop('s9'), chain).entity_id).toBe('s9');
	});

	it('never redirects the merge revision itself', () => {
		// Following the redirect would tombstone the survivor instead.
		const merge: PendingRevision = {
			...stop('s2'),
			fields: { deleted_at: 1, merged_into: 's1' },
			author_id: null
		};
		expect(redirectRevision(merge, chain).entity_id).toBe('s2');
	});
});
