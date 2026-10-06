import { afterEach, describe, expect, it } from 'vitest';
import { baseLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import { duration } from './format';

describe('a duration in German', () => {
	afterEach(() => overwriteGetLocale(() => baseLocale));

	it('reads as an h:mm figure with its unit once it runs past an hour', () => {
		overwriteGetLocale(() => 'de');
		expect(duration((60 + 34) * 60_000)).toBe('1:34 Std');
		expect(duration((120 + 5) * 60_000)).toBe('2:05 Std');
	});
});
