import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BOUNDARY_HOURS, resolveAppearance } from './appearance';

const at = (h: number, mi = 0) => h * 60 + mi;
const DAY_START = '05:00';

describe('the appearance follows the clock', () => {
	it('is deep night from 23:00 until the Day Start', () => {
		expect(resolveAppearance(at(23, 0), DAY_START, 'auto', false)).toBe('deep');
		expect(resolveAppearance(at(3, 0), DAY_START, 'auto', false)).toBe('deep');
		expect(resolveAppearance(at(4, 59), DAY_START, 'auto', false)).toBe('deep');
	});

	it('is night from the Day Start to 07:00, and from 19:00 to 23:00', () => {
		expect(resolveAppearance(at(5, 0), DAY_START, 'auto', false)).toBe('night');
		expect(resolveAppearance(at(6, 59), DAY_START, 'auto', false)).toBe('night');
		expect(resolveAppearance(at(19, 0), DAY_START, 'auto', false)).toBe('night');
		expect(resolveAppearance(at(22, 59), DAY_START, 'auto', false)).toBe('night');
	});

	it('is day between 07:00 and 19:00', () => {
		expect(resolveAppearance(at(7, 0), DAY_START, 'auto', false)).toBe('day');
		expect(resolveAppearance(at(12, 0), DAY_START, 'auto', false)).toBe('day');
		expect(resolveAppearance(at(18, 59), DAY_START, 'auto', false)).toBe('day');
	});

	it('lets the clock make it darker and never lighter', () => {
		// A phone set permanently to dark — for light sensitivity, migraine or
		// preference — keeps a dark app at noon.
		expect(resolveAppearance(at(12, 0), DAY_START, 'auto', true)).toBe('night');
		// And a phone set to light is still dark at 22:00: after 19:00 there is no
		// light mode at all.
		expect(resolveAppearance(at(22, 0), DAY_START, 'auto', false)).toBe('night');
	});

	it('moves deep night with the Household s Day Start, read as a plain number', () => {
		// 05:00 is where deep night ends on *whatever* local clock the Device has.
		expect(resolveAppearance(at(4, 30), '04:00', 'auto', false)).toBe('night');
		expect(resolveAppearance(at(4, 30), '06:00', 'auto', false)).toBe('deep');
	});

	it('has three overrides and no fourth', () => {
		// There is no "Always deep night": it is a concession to a moment, not a
		// taste (spec §8.1).
		expect(resolveAppearance(at(3, 0), DAY_START, 'day', true)).toBe('day');
		expect(resolveAppearance(at(12, 0), DAY_START, 'night', false)).toBe('night');
		const everyHour = Array.from({ length: 24 }, (_, h) => resolveAppearance(at(h), DAY_START, 'day', true));
		expect(new Set(everyHour)).toEqual(new Set(['day']));
	});
});

describe('the shell and this module', () => {
	/* The resolver that runs is the inline script in src/app.html — it must block
	   first paint, so it cannot import anything. This test is what keeps the two
	   copies honest: change a boundary in one and it fails. */
	const shell = readFileSync('src/app.html', 'utf8');

	it('declare the same boundary hours', () => {
		expect(shell).toContain(`var DEEP_FROM = ${BOUNDARY_HOURS.deepFrom} * 60`);
		expect(shell).toContain(`var MORNING = ${BOUNDARY_HOURS.morning} * 60`);
		expect(shell).toContain(`var EVENING = ${BOUNDARY_HOURS.evening} * 60`);
	});

	it('default to the same Day Start before any replica has been read', () => {
		expect(shell).toContain("'05:00'");
	});

	it('write both attributes, because Pico keys its own icon assets off one of them', () => {
		expect(shell).toContain("root.setAttribute('data-appearance', appearance)");
		expect(shell).toContain("root.setAttribute('data-theme', appearance === 'day' ? 'light' : 'dark')");
	});

	it('paint the launch screen in the deep-night ground, permanently', () => {
		// The OS paints it before any of our code exists, and a white launch at 3am
		// is the exact failure ADR-0008 was written to prevent.
		const manifest = JSON.parse(readFileSync('static/manifest.webmanifest', 'utf8')) as {
			background_color: string;
			theme_color: string;
		};
		expect(manifest.background_color).toBe('#030202');
		expect(manifest.theme_color).toBe('#030202');
		expect(shell).toContain('<meta name="theme-color" content="#030202" />');
	});
});
