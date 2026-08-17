import { describe, expect, it } from 'vitest';
import { coercePayload, emptyPayload, validateFields } from './entries';

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

describe('coercePayload', () => {
	it('fills the shape a renderer expects', () => {
		expect(coercePayload('bottle_feed', {})).toEqual({ volume_ml: null, contents: null });
		expect(coercePayload('nappy', { pee: true })).toEqual({ pee: true, poop: false, consistency: null });
	});

	it('never throws on a field it has never heard of', () => {
		// Additive payload changes deliberately do not bump the protocol
		// version, so an older client meets unknown fields and must still
		// render the row.
		expect(coercePayload('bottle_feed', { volume_ml: 90, temperature_c: 37 })).toEqual({
			volume_ml: 90,
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
