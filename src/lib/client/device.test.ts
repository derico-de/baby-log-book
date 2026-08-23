import { beforeEach, describe, expect, it } from 'vitest';
import { bottleChime, feedingDefault, setBottleChime, setFeedingDefault } from './device';

describe('the feeding default, a Device Setting', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('is breast until a Member states otherwise — exactly the behavior before the setting existed', () => {
		expect(feedingDefault()).toBe('breast');
	});

	it('round-trips the three stated values', () => {
		setFeedingDefault('bottle_formula');
		expect(feedingDefault()).toBe('bottle_formula');
		setFeedingDefault('bottle_breast_milk');
		expect(feedingDefault()).toBe('bottle_breast_milk');
		setFeedingDefault('breast');
		expect(feedingDefault()).toBe('breast');
	});

	it('falls back to the seeded default on a value it has never heard of', () => {
		// A future release may add states; this Device must not open a sheet it
		// cannot draw.
		localStorage.setItem('blb.feedingDefault', 'bottle_other');
		expect(feedingDefault()).toBe('breast');
	});

	it('lives in localStorage like the other Device Settings, which is what keeps it out of the sync log', () => {
		setFeedingDefault('bottle_formula');
		expect(localStorage.getItem('blb.feedingDefault')).toBe('bottle_formula');
	});
});

describe('the bottle chime, a Device Setting', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('is off until this phone asks for it — no Device that never asked makes a noise', () => {
		expect(bottleChime()).toBe(false);
	});

	it('round-trips both states', () => {
		setBottleChime(true);
		expect(bottleChime()).toBe(true);
		setBottleChime(false);
		expect(bottleChime()).toBe(false);
	});

	it('reads a value it has never heard of as off, which is the silent side', () => {
		localStorage.setItem('blb.bottleChime', 'vibrate');
		expect(bottleChime()).toBe(false);
	});

	it('lives in localStorage like the other Device Settings, which keeps it out of the sync log', () => {
		setBottleChime(true);
		expect(localStorage.getItem('blb.bottleChime')).toBe('1');
	});
});
