/* What the deployment wakes a Device to say (ADR-0031).

   The arithmetic lives here, so the notifier's own tests can stay about
   delivery. Every case is stated against instants a reader can check by eye:
   the Feed Interval is three hours, the Wake Window two, the Bottle Life one. */

import { describe, expect, it } from 'vitest';
import {
	liveNotices,
	noticeOffset,
	NOTICE_WINDOW_MS,
	MAX_NOTICE_OFFSET_S,
	type NoticeOffsets
} from './notices';
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
const TARGETS = [feedTarget, sleepTarget, bottleTarget];

/** Both Notices on, landing on the due instant itself. */
const ON: NoticeOffsets = { feed_notice_s: 0, sleep_notice_s: 0 };
const OFF: NoticeOffsets = { feed_notice_s: null, sleep_notice_s: null };

const kinds = (entries: Entry[], now: number, offsets: NoticeOffsets = ON) =>
	liveNotices(entries, TARGETS, offsets, now).map((n) => n.kind);

describe('a stated offset', () => {
	it('is seconds, and never negative — a Notice may not cross to the wrong side of its Target', () => {
		expect(noticeOffset(600)).toBe(600);
		expect(noticeOffset(-600)).toBe(0);
	});

	it('is null for anything that is not a number, which is the quiet side', () => {
		expect(noticeOffset(null)).toBeNull();
		expect(noticeOffset('')).toBeNull();
		expect(noticeOffset('later')).toBeNull();
		expect(noticeOffset(undefined)).toBeNull();
	});

	it('reads a form input, because that is where it is typed', () => {
		expect(noticeOffset('900')).toBe(900);
	});

	it('is capped, so nobody can be told about a Feed a day and a half from now', () => {
		expect(noticeOffset(99 * 3600)).toBe(MAX_NOTICE_OFFSET_S);
	});
});

describe('a Feed coming due', () => {
	/* Fed at 10:00, so the three-hour interval is up at 13:00. */
	const fed = entry({ id: 'f1', type: 'breast_feed', occurred_at: iso('2026-08-17T10:00:00Z'), ended_at: iso('2026-08-17T10:20:00Z') });

	it('says nothing before the interval is up', () => {
		expect(kinds([fed], iso('2026-08-17T12:59:00Z'))).toEqual([]);
	});

	it('speaks at the due instant, anchored to the Feed it was measured from', () => {
		const notices = liveNotices([fed], TARGETS, ON, iso('2026-08-17T13:00:00Z'));
		expect(notices).toEqual([
			{ kind: 'feed', baby_id: 'b1', entry_id: 'f1', offset_minutes: 0, until: iso('2026-08-17T13:15:00Z') }
		]);
	});

	it('stops after its window: a Feed two hours overdue is the next Feed’s problem', () => {
		expect(kinds([fed], iso('2026-08-17T13:14:00Z'))).toEqual(['feed']);
		expect(kinds([fed], iso('2026-08-17T13:15:00Z'))).toEqual([]);
		expect(kinds([fed], iso('2026-08-17T15:00:00Z'))).toEqual([]);
	});

	it('comes early by the offset the Household stated, and says how early', () => {
		const at = iso('2026-08-17T12:45:00Z');
		const notices = liveNotices([fed], TARGETS, { ...ON, feed_notice_s: 15 * 60 }, at);
		expect(notices.map((n) => [n.kind, n.offset_minutes])).toEqual([['feed', 15]]);
	});

	it('is silent when the Household has stated no offset at all', () => {
		expect(kinds([fed], iso('2026-08-17T13:00:00Z'), OFF)).toEqual([]);
	});

	/* Told a Feed is due while someone is feeding her, it would be noise — and a
	   bottle stays open until it is stopped, so this covers a Combined Feed. */
	it('stays quiet while a Feed is running', () => {
		const running = entry({ id: 'f2', type: 'bottle_feed', occurred_at: iso('2026-08-17T12:58:00Z') });
		expect(kinds([fed, running], iso('2026-08-17T13:00:00Z'))).toEqual([]);
	});

	it('re-anchors on the next Feed, so the reminder comes round again', () => {
		const next = entry({ id: 'f3', type: 'breast_feed', occurred_at: iso('2026-08-17T13:05:00Z'), ended_at: iso('2026-08-17T13:20:00Z') });
		const notices = liveNotices([fed, next], TARGETS, ON, iso('2026-08-17T16:05:00Z'));
		expect(notices.map((n) => n.entry_id)).toEqual(['f3']);
	});

	it('halves an offset longer than half the interval, rather than firing mid-feed', () => {
		const short: Target = { ...feedTarget, duration_s: 30 * 60 };
		const at = iso('2026-08-17T10:15:00Z');
		const notices = liveNotices([fed], [short], { ...ON, feed_notice_s: 25 * 60 }, at);
		expect(notices.map((n) => [n.kind, n.offset_minutes])).toEqual([['feed', 15]]);
	});

	it('needs a Target: a Baby with none is a Baby with nothing due', () => {
		expect(liveNotices([fed], [sleepTarget], ON, iso('2026-08-17T13:00:00Z'))).toEqual([]);
	});

	it('ignores a deleted Feed, which is not an anchor', () => {
		const gone = { ...fed, deleted_at: iso('2026-08-17T10:30:00Z') };
		expect(kinds([gone], iso('2026-08-17T13:00:00Z'))).toEqual([]);
	});
});

describe('a Wake Window running out', () => {
	/* Woke at 11:00, so the two-hour window is up at 13:00. */
	const slept = entry({
		id: 's1',
		type: 'sleep',
		occurred_at: iso('2026-08-17T10:00:00Z'),
		ended_at: iso('2026-08-17T11:00:00Z')
	});

	it('says nothing while the window is still open', () => {
		expect(kinds([slept], iso('2026-08-17T12:59:00Z'))).toEqual([]);
	});

	it('speaks when the window is up, anchored to the Sleep it was measured from', () => {
		const notices = liveNotices([slept], TARGETS, ON, iso('2026-08-17T13:00:00Z'));
		expect(notices).toEqual([
			{ kind: 'sleep', baby_id: 'b1', entry_id: 's1', offset_minutes: 0, until: iso('2026-08-17T13:15:00Z') }
		]);
	});

	it('waits out the grace the Household stated, and says how long she is over', () => {
		expect(kinds([slept], iso('2026-08-17T13:20:00Z'), { ...ON, sleep_notice_s: 30 * 60 })).toEqual([]);
		const notices = liveNotices([slept], TARGETS, { ...ON, sleep_notice_s: 30 * 60 }, iso('2026-08-17T13:30:00Z'));
		expect(notices.map((n) => [n.kind, n.offset_minutes])).toEqual([['sleep', 30]]);
	});

	it('is silent when the Household has stated no offset at all', () => {
		expect(kinds([slept], iso('2026-08-17T13:00:00Z'), OFF)).toEqual([]);
	});

	/* A Wake Window is time not covered by a Sleep, so while she is asleep it
	   simply does not apply (spec §8.5). */
	it('stays quiet while she is asleep', () => {
		const napping = entry({ id: 's2', type: 'sleep', occurred_at: iso('2026-08-17T12:30:00Z') });
		expect(kinds([slept, napping], iso('2026-08-17T13:00:00Z'))).toEqual([]);
	});

	it('re-anchors on the next Sleep', () => {
		const next = entry({
			id: 's3',
			type: 'sleep',
			occurred_at: iso('2026-08-17T12:00:00Z'),
			ended_at: iso('2026-08-17T12:30:00Z')
		});
		const notices = liveNotices([slept, next], TARGETS, ON, iso('2026-08-17T14:30:00Z'));
		expect(notices.map((n) => n.entry_id)).toEqual(['s3']);
	});

	it('stops after its window', () => {
		expect(kinds([slept], iso('2026-08-17T13:15:00Z'))).toEqual([]);
	});
});

describe('a bottle nearly out', () => {
	/* Poured at 13:00 against an hour's Life: the last ten minutes begin at
	   13:50 and the Feed ends at 14:00 (ADR-0017). */
	const open = entry({ id: 'b1e', type: 'bottle_feed', occurred_at: iso('2026-08-17T13:00:00Z') });

	it('carries the bottle’s own due instant as its deadline, so a late push is dropped', () => {
		const notices = liveNotices([open], TARGETS, ON, iso('2026-08-17T13:55:00Z'));
		expect(notices).toEqual([
			{ kind: 'bottle', baby_id: 'b1', entry_id: 'b1e', offset_minutes: 5, until: iso('2026-08-17T14:00:00Z') }
		]);
	});

	/* The whole of the fix: a Feed somebody stopped has no bottle left to offer,
	   so there is nothing to say about it — however many ticks fall in the
	   window the countdown used to be inside. */
	it('says nothing once the Feed has been stopped', () => {
		const stopped = { ...open, ended_at: iso('2026-08-17T13:52:00Z') };
		expect(kinds([stopped], iso('2026-08-17T13:55:00Z'))).toEqual([]);
	});

	it('says nothing once the bottle is past its Life', () => {
		expect(kinds([open], iso('2026-08-17T14:00:00Z'))).toEqual([]);
	});

	it('does not depend on the two stated offsets — its lead is fixed (ADR-0029)', () => {
		expect(kinds([open], iso('2026-08-17T13:55:00Z'), OFF)).toEqual(['bottle']);
	});
});

describe('the whole Household', () => {
	it('speaks for every Baby, not just the one on somebody’s screen', () => {
		const mine = entry({ id: 'f1', type: 'breast_feed', occurred_at: iso('2026-08-17T10:00:00Z'), ended_at: iso('2026-08-17T10:20:00Z') });
		const sibling = entry({ id: 'f2', type: 'breast_feed', occurred_at: iso('2026-08-17T10:00:00Z'), ended_at: iso('2026-08-17T10:20:00Z') });
		sibling.baby_id = 'b2';
		const theirs: Target = { ...feedTarget, id: 't9', baby_id: 'b2' };
		const notices = liveNotices([mine, sibling], [...TARGETS, theirs], ON, iso('2026-08-17T13:00:00Z'));
		expect(notices.map((n) => n.baby_id).sort()).toEqual(['b1', 'b2']);
	});

	it('says a bottle is nearly out without also saying a Feed is due', () => {
		/* Fed at 10:00 — the interval is up at 13:00 — and a bottle poured at
		   12:05 whose hour is nearly up. The bottle is open, so the Feed Notice
		   holds its tongue: somebody is feeding her. */
		const fed = entry({ id: 'f1', type: 'breast_feed', occurred_at: iso('2026-08-17T10:00:00Z'), ended_at: iso('2026-08-17T10:20:00Z') });
		const bottle = entry({ id: 'f2', type: 'bottle_feed', occurred_at: iso('2026-08-17T12:05:00Z') });
		expect(kinds([fed, bottle], iso('2026-08-17T12:56:00Z'))).toEqual(['bottle']);
	});

	it('holds the window it grants a Notice to a quarter of an hour', () => {
		expect(NOTICE_WINDOW_MS).toBe(15 * 60_000);
	});
});
