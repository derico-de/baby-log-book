import { describe, expect, it } from 'vitest';
import {
	coercePayload,
	emptyPayload,
	feedContentKey,
	intakeMl,
	isSession,
	subtractLeftover,
	validateFields
} from './entries';
import type { Entry } from './types';

describe('validateFields', () => {
	it('accepts a bottle feed creation', () => {
		const r = validateFields('entry', {
			baby_id: 'b1',
			type: 'bottle_feed',
			occurred_at: 1_700_000_000_000,
			ended_at: null,
			recording_zone: 'Europe/Berlin',
			volume_ml: 120,
			contents: 'formula'
		});
		expect(r.ok).toBe(true);
	});

	it('accepts where a pee or poop landed, and only the three places there are', () => {
		expect(validateFields('entry', { where: 'potty' })).toEqual({ ok: true, fields: { where: 'potty' } });
		expect(validateFields('entry', { where: null })).toEqual({ ok: true, fields: { where: null } });
		expect(validateFields('entry', { where: 'floor' }).ok).toBe(false);
	});

	it('accepts a tummy time creation, which carries no payload at all', () => {
		const r = validateFields('entry', {
			baby_id: 'b1',
			type: 'tummy_time',
			occurred_at: 1_700_000_000_000,
			ended_at: null,
			recording_zone: 'Europe/Berlin'
		});
		expect(r.ok).toBe(true);
	});

	it('accepts a leftover on its own, which is how a finished bottle is corrected', () => {
		expect(validateFields('entry', { leftover_ml: 30 })).toEqual({ ok: true, fields: { leftover_ml: 30 } });
		expect(validateFields('entry', { leftover_ml: null })).toEqual({ ok: true, fields: { leftover_ml: null } });
		expect(validateFields('entry', { leftover_ml: -10 }).ok).toBe(false);
		expect(validateFields('entry', { leftover_ml: 12.5 }).ok).toBe(false);
	});

	it('validates an edit that names one payload field and nothing else', () => {
		// Payload keys are unique across the seven types, so an ordinary
		// correction needs no knowledge of the Entry's type.
		expect(validateFields('entry', { volume_ml: 150 })).toEqual({ ok: true, fields: { volume_ml: 150 } });
	});

	it('rejects an offset where a zone id belongs', () => {
		// A numeric offset is a dead number: it can never re-derive a Day Start.
		expect(validateFields('entry', { recording_zone: '+02:00' }).ok).toBe(false);
		expect(validateFields('entry', { recording_zone: 'Europe/Bucharest' }).ok).toBe(true);
	});

	it('rejects a non-integer volume', () => {
		expect(validateFields('entry', { volume_ml: 120.5 }).ok).toBe(false);
		expect(validateFields('entry', { volume_ml: -1 }).ok).toBe(false);
	});

	it('drops unknown keys rather than failing the batch', () => {
		// Failing would cost a Member every Entry in their outbox, and the
		// client-ahead case cannot push at all.
		expect(validateFields('entry', { note: 'x', whatever: 1 })).toEqual({
			ok: true,
			fields: { note: 'x' }
		});
	});

	it('rejects a revision that names nothing known', () => {
		expect(validateFields('entry', { whatever: 1 }).ok).toBe(false);
	});

	it('accepts a Meal whose Foods list carries reactions', () => {
		expect(
			validateFields('entry', {
				foods: [
					{ food_id: 'f1', amount: 'tasted', reaction: 'rash on the chin' },
					{ food_id: 'f2', amount: null, reaction: null }
				]
			}).ok
		).toBe(true);
	});

	it('rejects a Foods list that is not a list of Foods', () => {
		expect(validateFields('entry', { foods: [{ amount: 'tasted' }] }).ok).toBe(false);
		expect(validateFields('entry', { foods: 'broccoli' }).ok).toBe(false);
	});

	it('takes a Day Start as an hour and refuses an instant', () => {
		expect(validateFields('household', { day_start: '05:00' }).ok).toBe(true);
		expect(validateFields('household', { day_start: '5:00' }).ok).toBe(false);
		expect(validateFields('household', { day_start: 1_700_000_000_000 }).ok).toBe(false);
	});

	it('will not let anything authenticating ride on a member revision', () => {
		expect(validateFields('member', { display_name: 'Oma', role: 'caregiver', token: 'x' })).toEqual({
			ok: true,
			fields: { display_name: 'Oma', role: 'caregiver' }
		});
	});

	it('takes a Target as a duration plus an anchor', () => {
		expect(validateFields('target', { activity: 'sleep', duration_s: 7200, anchor: 'sleep_end' }).ok).toBe(
			true
		);
		expect(validateFields('target', { anchor: 'whenever' }).ok).toBe(false);
	});
});

describe('isSession', () => {
	it('names the four types that run as a Live Session, and nothing else', () => {
		expect(isSession('sleep')).toBe(true);
		expect(isSession('breast_feed')).toBe(true);
		expect(isSession('bottle_feed')).toBe(true);
		expect(isSession('tummy_time')).toBe(true);
		expect(isSession('nappy')).toBe(false);
		expect(isSession('milestone')).toBe(false);
	});
});

describe('coercePayload', () => {
	it('fills the shape a renderer expects', () => {
		expect(coercePayload('bottle_feed', {})).toEqual({ volume_ml: null, leftover_ml: null, contents: null });
		expect(coercePayload('nappy', { pee: true })).toEqual({ pee: true, poop: false, consistency: null, where: null });
	});

	it('never throws on a field it has never heard of', () => {
		// Additive payload changes deliberately do not bump the protocol
		// version, so an older client meets unknown fields and must still
		// render the row.
		expect(coercePayload('bottle_feed', { volume_ml: 90, temperature_c: 37 })).toEqual({
			volume_ml: 90,
			leftover_ml: null,
			contents: null
		});
	});

	it('ignores a value of the wrong shape instead of rendering rubbish', () => {
		expect(coercePayload('milestone', { name: 42 })).toEqual({ name: '' });
		expect(coercePayload('meal', { foods: 'broccoli' })).toEqual({ foods: [] });
	});

	it('gives a Sleep an empty payload — start and end and nothing else', () => {
		expect(emptyPayload('sleep')).toEqual({});
	});
});

describe('intakeMl, the one reading lens for both eras (ADR-0018)', () => {
	const bottle = (volume_ml: number | null, leftover_ml: number | null) =>
		({ volume_ml, leftover_ml, contents: null }) as const;

	it('passes a new row s Intake straight through — new writes never set a leftover', () => {
		expect(intakeMl(bottle(170, null))).toBe(170);
	});

	it('reads a legacy row as what was offered less what came back', () => {
		expect(intakeMl(bottle(180, 30))).toBe(150);
	});

	it('reads a legacy null leftover as the whole bottle', () => {
		// Not the same as a leftover of zero, but it reads the same, and
		// pretending otherwise would make every bottle logged before the field
		// existed disappear from the volume.
		expect(intakeMl(bottle(180, null))).toBe(180);
	});

	it('says nothing when nobody said how much went in', () => {
		// A legacy leftover on its own cannot imply a total, and guessing one
		// would be inventing data.
		expect(intakeMl(bottle(null, 30))).toBeNull();
		expect(intakeMl(bottle(null, null))).toBeNull();
	});

	it('never goes negative, because two fields under last-write-wins can cross', () => {
		expect(intakeMl(bottle(120, 200))).toBe(0);
	});
});

describe('the leftover affordance (ADR-0018)', () => {
	it('subtracts what came back from the Intake, in place', () => {
		expect(subtractLeftover(170, 40)).toBe(130);
	});

	it('applies each confirmation once, so 40 then 10 against 170 leaves 120', () => {
		// The input clears after each application; a second number is a second
		// subtraction, never a replacement of the first.
		expect(subtractLeftover(subtractLeftover(170, 40), 10)).toBe(120);
	});

	it('clamps at zero rather than validating — never a negative feed', () => {
		expect(subtractLeftover(100, 150)).toBe(0);
	});

	it('has nothing to subtract from when the Intake field is empty', () => {
		expect(subtractLeftover(null, 30)).toBeNull();
	});
});

describe('feedContentKey — when two Feeds are the same feed happening twice', () => {
	let n = 0;
	const feed = (type: Entry['type'], payload: unknown): Entry =>
		({ id: `f${n++}`, type, payload } as Entry);

	it('makes two bottles of the same milk the same thing', () => {
		const a = feed('bottle_feed', { volume_ml: 60, leftover_ml: null, contents: 'formula' });
		const b = feed('bottle_feed', { volume_ml: 80, leftover_ml: null, contents: 'formula' });
		expect(feedContentKey(a)).toBe(feedContentKey(b));
	});

	it('keeps formula and breast milk apart — that is a Combined Feed, not one bigger one', () => {
		const a = feed('bottle_feed', { volume_ml: 60, leftover_ml: null, contents: 'formula' });
		const b = feed('bottle_feed', { volume_ml: 60, leftover_ml: null, contents: 'breast_milk' });
		expect(feedContentKey(a)).not.toBe(feedContentKey(b));
	});

	it('never guesses that two bottles nobody named were the same milk', () => {
		const a = feed('bottle_feed', { volume_ml: 60, leftover_ml: null, contents: null });
		const b = feed('bottle_feed', { volume_ml: 80, leftover_ml: null, contents: null });
		expect(feedContentKey(a)).not.toBe(feedContentKey(b));
	});

	it('matches a breast by side, and only by side', () => {
		expect(feedContentKey(feed('breast_feed', { side: 'left' }))).toBe(
			feedContentKey(feed('breast_feed', { side: 'left' }))
		);
		expect(feedContentKey(feed('breast_feed', { side: 'left' }))).not.toBe(
			feedContentKey(feed('breast_feed', { side: 'right' }))
		);
	});

	it('never matches a breast to a bottle, or anything that is not a Feed to itself', () => {
		expect(feedContentKey(feed('breast_feed', { side: 'left' }))).not.toBe(
			feedContentKey(feed('bottle_feed', { volume_ml: 60, leftover_ml: null, contents: 'breast_milk' }))
		);
		expect(feedContentKey(feed('sleep', {}))).not.toBe(feedContentKey(feed('sleep', {})));
	});
});
