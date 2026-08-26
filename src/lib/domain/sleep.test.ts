import { describe, expect, it } from 'vitest';
import { classifySleep, isSleepFeed, staleCeilingMs, staleSleepState, usualWakeInstant } from './sleep';
import type { Entry } from './types';

const BERLIN = 'Europe/Berlin';
const iso = (s: string) => Date.parse(s);
const HOUSEHOLD = { dayStart: '05:00', zone: BERLIN, night: null };

function entry(p: Partial<Entry> & { type: Entry['type']; occurred_at: number }): Entry {
	return {
		id: p.id ?? `e-${p.type}-${p.occurred_at}`,
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

describe('classifySleep', () => {
	it('calls the Sleep that crosses the Day Start the Night Sleep', () => {
		const night = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-17T18:00:00Z'),
			ended_at: iso('2026-08-18T04:30:00Z')
		});
		expect(classifySleep(night, HOUSEHOLD, iso('2026-08-18T08:00:00Z'))).toBe('night');
	});

	it('calls everything else a Nap', () => {
		const nap = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-17T12:00:00Z'),
			ended_at: iso('2026-08-17T13:30:00Z')
		});
		expect(classifySleep(nap, HOUSEHOLD, iso('2026-08-17T14:00:00Z'))).toBe('nap');
	});

	it('classifies a running Sleep against now, so a bar can grow live', () => {
		const running = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		expect(classifySleep(running, HOUSEHOLD, iso('2026-08-17T21:00:00Z'))).toBe('nap');
		expect(classifySleep(running, HOUSEHOLD, iso('2026-08-18T04:00:00Z'))).toBe('night');
	});

	// The Household states when its night begins; it ends at the Day Start
	// (ADR-0032, ADR-0033).
	const KEEPS_NIGHT = { ...HOUSEHOLD, night: { start: '20:00', end: '05:00' } };

	it('calls the bedtime that collapses a Night Sleep, once the Household states a Night', () => {
		// 19:00 to 23:00 Berlin: it never reaches the Day Start, and used to be
		// filed as a Nap.
		const bedtime = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-17T17:00:00Z'),
			ended_at: iso('2026-08-17T21:00:00Z')
		});
		expect(classifySleep(bedtime, HOUSEHOLD, iso('2026-08-17T22:00:00Z'))).toBe('nap');
		expect(classifySleep(bedtime, KEEPS_NIGHT, iso('2026-08-17T22:00:00Z'))).toBe('night');
	});

	it('leaves the afternoon Nap a Nap', () => {
		const nap = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-17T12:00:00Z') /* 14:00 Berlin */,
			ended_at: iso('2026-08-17T13:30:00Z')
		});
		expect(classifySleep(nap, KEEPS_NIGHT, iso('2026-08-17T14:00:00Z'))).toBe('nap');
	});

	it('turns a running bedtime as the evening reaches the stated hour', () => {
		const running = entry({ type: 'sleep', occurred_at: iso('2026-08-17T17:00:00Z') /* 19:00 */ });
		expect(classifySleep(running, KEEPS_NIGHT, iso('2026-08-17T17:30:00Z'))).toBe('nap');
		expect(classifySleep(running, KEEPS_NIGHT, iso('2026-08-17T18:00:00Z') /* 20:00 */)).toBe('night');
	});

	it('calls the small-hours stretch a Night Sleep too', () => {
		// She went back down at 01:00 and was up again at 03:00: inside the
		// night from end to end, and never near the Day Start.
		const stretch = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-17T23:00:00Z'),
			ended_at: iso('2026-08-18T01:00:00Z')
		});
		expect(classifySleep(stretch, KEEPS_NIGHT, iso('2026-08-18T06:00:00Z'))).toBe('night');
	});
});

describe('isSleepFeed', () => {
	const sleep = entry({
		type: 'sleep',
		occurred_at: iso('2026-08-17T19:00:00Z'),
		ended_at: iso('2026-08-18T04:00:00Z')
	});

	it('is derived from the overlap and never recorded', () => {
		const dreamFeed = entry({ type: 'breast_feed', occurred_at: iso('2026-08-17T22:00:00Z') });
		expect(isSleepFeed(dreamFeed, [sleep])).toBe(true);
	});

	it('covers the manual path, where a corrected Feed lands inside a Sleep', () => {
		// Nothing passed through the fan here, and it still counts.
		const corrected = entry({ type: 'bottle_feed', occurred_at: iso('2026-08-18T02:14:00Z') });
		expect(isSleepFeed(corrected, [sleep])).toBe(true);
	});

	it('is false for a Feed outside every Sleep', () => {
		const awakeFeed = entry({ type: 'bottle_feed', occurred_at: iso('2026-08-18T07:00:00Z') });
		expect(isSleepFeed(awakeFeed, [sleep])).toBe(false);
	});

	it('counts a Feed inside a Sleep that is still running', () => {
		const running = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const feed = entry({ type: 'breast_feed', occurred_at: iso('2026-08-17T23:00:00Z') });
		expect(isSleepFeed(feed, [running])).toBe(true);
	});
});

describe('the stale-Sleep ceiling', () => {
	it('is age-banded, hidden, and set at "no baby sleeps this long"', () => {
		expect(staleCeilingMs(2)).toBe(8 * 3600_000);
		expect(staleCeilingMs(4)).toBe(11 * 3600_000);
		expect(staleCeilingMs(9)).toBe(13 * 3600_000);
	});

	it('draws nothing on a celebrated first eight-hour night', () => {
		// A six-month-old sleeping eight hours is the good news, not a fault.
		const sleep = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const state = staleSleepState({
			sleep,
			entries: [sleep],
			now: iso('2026-08-18T03:00:00Z'),
			birthDate: '2026-02-17',
			...HOUSEHOLD
		});
		expect(state.stale).toBe(false);
	});

	it('fires once past the ceiling', () => {
		const sleep = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const state = staleSleepState({
			sleep,
			entries: [sleep],
			now: iso('2026-08-18T09:00:00Z'),
			birthDate: '2026-02-17',
			...HOUSEHOLD
		});
		expect(state).toMatchObject({ stale: true, reason: 'ceiling' });
	});

	it('fires on a Meal, because you cannot spoon solids into a sleeping Baby', () => {
		const sleep = entry({ type: 'sleep', occurred_at: iso('2026-08-17T12:00:00Z') });
		const meal = entry({
			type: 'meal',
			occurred_at: iso('2026-08-17T15:00:00Z'),
			payload: { foods: [] }
		});
		const state = staleSleepState({
			sleep,
			entries: [sleep, meal],
			now: iso('2026-08-17T15:05:00Z'),
			birthDate: '2025-08-17',
			...HOUSEHOLD
		});
		expect(state).toMatchObject({ stale: true, reason: 'meal' });
	});

	it('never fires on a Feed — that is a Sleep Feed, and it is nightly', () => {
		const sleep = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const feed = entry({ type: 'breast_feed', occurred_at: iso('2026-08-17T23:00:00Z') });
		const state = staleSleepState({
			sleep,
			entries: [sleep, feed],
			now: iso('2026-08-17T23:30:00Z'),
			birthDate: '2026-02-17',
			...HOUSEHOLD
		});
		expect(state.stale).toBe(false);
	});

	it('never fires on a Nappy — changing a sleeping baby is routine', () => {
		const sleep = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const nappy = entry({
			type: 'nappy',
			occurred_at: iso('2026-08-17T23:00:00Z'),
			payload: { pee: true, poop: false, consistency: null, where: null }
		});
		const state = staleSleepState({
			sleep,
			entries: [sleep, nappy],
			now: iso('2026-08-17T23:30:00Z'),
			birthDate: '2026-02-17',
			...HOUSEHOLD
		});
		expect(state.stale).toBe(false);
	});

	it('stops asking once someone said she is still asleep', () => {
		// "Still asleep" restarts the clock so the threshold does not fire
		// again immediately; the Sleep stays running because it is genuine.
		const sleep = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const args = {
			sleep,
			entries: [sleep],
			birthDate: '2026-02-17',
			...HOUSEHOLD
		};
		const ackAt = iso('2026-08-18T09:00:00Z');
		expect(staleSleepState({ ...args, now: ackAt, ackAt }).stale).toBe(false);
		expect(staleSleepState({ ...args, now: ackAt + 3600_000, ackAt }).stale).toBe(false);
		/* Six months old, so the ceiling is 13h — and it now counts from the
		   acknowledgement rather than from the Sleep's start. */
		expect(staleSleepState({ ...args, now: ackAt + 14 * 3600_000, ackAt }).stale).toBe(true);
	});

	it('says nothing about a Sleep that has already ended', () => {
		const ended = entry({
			type: 'sleep',
			occurred_at: iso('2026-08-17T19:00:00Z'),
			ended_at: iso('2026-08-18T06:00:00Z')
		});
		expect(
			staleSleepState({
				sleep: ended,
				entries: [ended],
				now: iso('2026-08-19T19:00:00Z'),
				birthDate: '2026-02-17',
				...HOUSEHOLD
			}).stale
		).toBe(false);
	});
});

describe('usualWakeInstant', () => {
	it('defaults the picker to her usual wake time, not to now', () => {
		// "Now" is the honest we-know-nothing answer and is almost always
		// wrong — she woke hours ago, which is why the banner appeared.
		const history = [
			entry({
				type: 'sleep',
				occurred_at: iso('2026-08-14T19:00:00Z'),
				ended_at: iso('2026-08-15T04:30:00Z') /* 06:30 Berlin */
			}),
			entry({
				type: 'sleep',
				occurred_at: iso('2026-08-15T19:00:00Z'),
				ended_at: iso('2026-08-16T04:00:00Z') /* 06:00 Berlin */
			}),
			entry({
				type: 'sleep',
				occurred_at: iso('2026-08-16T19:00:00Z'),
				ended_at: iso('2026-08-17T04:15:00Z') /* 06:15 Berlin */
			})
		];
		const running = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const at = usualWakeInstant(running, [...history, running], iso('2026-08-18T09:00:00Z'), HOUSEHOLD);
		expect(at).toBe(iso('2026-08-18T04:15:00Z')); /* 06:15 Berlin */
	});

	it('falls back to two hours after the Day Start with no history to read', () => {
		const running = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const at = usualWakeInstant(running, [running], iso('2026-08-18T09:00:00Z'), HOUSEHOLD);
		expect(at).toBe(iso('2026-08-18T05:00:00Z')); /* 07:00 Berlin */
	});

	it('reads past a bedtime that collapsed, which is not a morning', () => {
		// Two evening Sleeps now count as Night Sleeps (ADR-0033). Letting their
		// 22:00 ends into the median would open the picker on last night rather
		// than on the hour she actually wakes.
		const night = { start: '20:00', end: '05:00' };
		const collapsed = (day: number) =>
			entry({
				type: 'sleep',
				id: `collapsed-${day}`,
				occurred_at: iso(`2026-08-${day}T17:00:00Z`) /* 19:00 Berlin */,
				ended_at: iso(`2026-08-${day}T20:00:00Z`) /* 22:00 Berlin */
			});
		const history = [
			collapsed(15),
			collapsed(16),
			entry({
				type: 'sleep',
				occurred_at: iso('2026-08-16T19:00:00Z'),
				ended_at: iso('2026-08-17T04:15:00Z') /* 06:15 Berlin */
			})
		];
		const running = entry({ type: 'sleep', occurred_at: iso('2026-08-17T19:00:00Z') });
		const at = usualWakeInstant(running, [...history, running], iso('2026-08-18T09:00:00Z'), {
			...HOUSEHOLD,
			night
		});
		expect(at).toBe(iso('2026-08-18T04:15:00Z')); /* 06:15 Berlin */
	});

	it('never proposes a wake time before the Sleep started', () => {
		const running = entry({ type: 'sleep', occurred_at: iso('2026-08-18T06:00:00Z') });
		const at = usualWakeInstant(running, [running], iso('2026-08-18T20:00:00Z'), HOUSEHOLD);
		expect(at).toBeGreaterThan(running.occurred_at);
	});
});
