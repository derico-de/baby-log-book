import { describe, expect, it } from 'vitest';
import { feedEndRevision, planFeedEnds } from './feed-end';
import type { Entry, EntryType } from './types';

const AT = Date.parse('2026-08-17T12:00:00Z');
const min = (n: number) => n * 60_000;

function entry(id: string, type: EntryType, occurredAt: number, extra: Partial<Entry> = {}): Entry {
	return {
		id,
		household_id: 'h1',
		baby_id: 'b1',
		type,
		occurred_at: occurredAt,
		ended_at: null,
		recording_zone: 'Europe/Berlin',
		note: null,
		payload: {} as Entry['payload'],
		logged_by: 'mum',
		logged_at: occurredAt,
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null,
		...extra
	};
}

describe('planFeedEnds', () => {
	it('ends a running Feed at the new feeding s Occurred At', () => {
		const running = entry('f1', 'breast_feed', AT);
		const next = entry('f2', 'bottle_feed', AT + min(5));
		expect(planFeedEnds([running, next], [running, next])).toEqual([
			{ entry_id: 'f1', ended_at: AT + min(5), author_id: 'mum' }
		]);
	});

	it('leaves the running Feed alone when the new feeding predates it', () => {
		const running = entry('f2', 'breast_feed', AT);
		const backdated = entry('f1', 'bottle_feed', AT - min(90), { ended_at: AT - min(75) });
		expect(planFeedEnds([running], [running, backdated])).toEqual([]);
	});

	it('a Meal ends the running Feed too — a feeding is a Feed or a Meal', () => {
		const running = entry('f1', 'breast_feed', AT);
		const meal = entry('m1', 'meal', AT + min(20), { logged_by: 'oma' });
		expect(planFeedEnds([running], [running, meal])).toEqual([
			{ entry_id: 'f1', ended_at: AT + min(20), author_id: 'oma' }
		]);
	});

	it('attributes the end to the Member who logged the new feeding', () => {
		const running = entry('f1', 'breast_feed', AT, { logged_by: 'mum' });
		const next = entry('f2', 'bottle_feed', AT + min(5), { logged_by: 'oma' });
		expect(planFeedEnds([running], [running, next])[0].author_id).toBe('oma');
	});

	it('never ends a Feed at a Sleep or a nappy', () => {
		const running = entry('f1', 'breast_feed', AT);
		const sleep = entry('s1', 'sleep', AT + min(5));
		const nappy = entry('n1', 'nappy', AT + min(6));
		expect(planFeedEnds([running, sleep], [running, sleep, nappy])).toEqual([]);
	});

	it('ends each earlier Feed at the feeding that in fact followed it', () => {
		const a = entry('f1', 'breast_feed', AT);
		const b = entry('f2', 'bottle_feed', AT + min(10));
		const c = entry('f3', 'bottle_feed', AT + min(25));
		expect(planFeedEnds([a, b, c], [a, b, c])).toEqual([
			{ entry_id: 'f1', ended_at: AT + min(10), author_id: 'mum' },
			{ entry_id: 'f2', ended_at: AT + min(25), author_id: 'mum' }
		]);
	});

	it('leaves a sibling s Feed alone', () => {
		const hers = entry('f1', 'breast_feed', AT);
		const his = entry('f2', 'bottle_feed', AT + min(5), { baby_id: 'b2' });
		expect(planFeedEnds([hers, his], [hers, his])).toEqual([]);
	});

	it('breaks a tie on the entry id, so nothing ends both ways', () => {
		const a = entry('f1', 'breast_feed', AT);
		const b = entry('f2', 'bottle_feed', AT);
		expect(planFeedEnds([a, b], [a, b])).toEqual([
			{ entry_id: 'f1', ended_at: AT, author_id: 'mum' }
		]);
	});

	it('ignores a deleted or merged feeding on either side', () => {
		const running = entry('f1', 'breast_feed', AT);
		const deleted = entry('f2', 'bottle_feed', AT + min(5), { deleted_at: AT + min(6) });
		expect(planFeedEnds([running], [running, deleted])).toEqual([]);
		const gone = entry('f3', 'breast_feed', AT, { merged_into: 'f9' });
		expect(planFeedEnds([gone], [gone, entry('f4', 'bottle_feed', AT + min(5))])).toEqual([]);
	});

	it('ignores a Feed that already has an end', () => {
		const closed = entry('f1', 'breast_feed', AT, { ended_at: AT + min(2) });
		const next = entry('f2', 'bottle_feed', AT + min(5));
		expect(planFeedEnds([closed, next], [closed, next])).toEqual([]);
	});

	it('is stable when the same entry arrives twice in the candidates', () => {
		const running = entry('f1', 'breast_feed', AT);
		const next = entry('f2', 'bottle_feed', AT + min(5));
		expect(planFeedEnds([running, running], [running, next, next])).toEqual([
			{ entry_id: 'f1', ended_at: AT + min(5), author_id: 'mum' }
		]);
	});
});

describe('feedEndRevision', () => {
	it('names only the end, and carries the logging Member as its author', () => {
		const revision = feedEndRevision(
			{ entry_id: 'f1', ended_at: AT + min(5), author_id: 'oma' },
			{ household_id: 'h1', at: AT + min(6), device_id: 'server', id: 'feed-end:f1' }
		);
		expect(revision).toEqual({
			id: 'feed-end:f1',
			household_id: 'h1',
			kind: 'entry',
			entity_id: 'f1',
			fields: { ended_at: AT + min(5) },
			merge_at: AT + min(6),
			device_id: 'server',
			author_id: 'oma'
		});
	});
});
