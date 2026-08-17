/* Romanian plurals, handled properly (spec §9.5).

   Selection is `new Intl.PluralRules(locale, options).select(n)` with per-locale
   category sets, so `ro.json` declares one/few/other while en/de declare two. The
   spec states its own verification — RO gives 20 → other, 1.5 → few, 101 → few —
   and this is that verification. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pluralCategory } from './format';

describe('Romanian', () => {
	it('gives the three categories the spec names', () => {
		expect(pluralCategory('ro', 20)).toBe('other');
		expect(pluralCategory('ro', 1.5)).toBe('few');
		expect(pluralCategory('ro', 101)).toBe('few');
		expect(pluralCategory('ro', 1)).toBe('one');
		expect(pluralCategory('ro', 5)).toBe('few');
	});

	it('declares a form for every category it can select', () => {
		const ro = JSON.parse(readFileSync('messages/ro.json', 'utf8')) as Record<string, string>;
		/* Every plural family in the catalogue must be complete in Romanian, or a
		   count of 20 falls back to English mid-sentence. */
		const families = Object.keys(ro)
			.filter((key) => key.endsWith('_one'))
			.map((key) => key.slice(0, -'_one'.length));
		expect(families.length).toBeGreaterThan(0);
		for (const family of families) {
			expect(ro[`${family}_few`], `${family}_few`).toBeTruthy();
			expect(ro[`${family}_other`], `${family}_other`).toBeTruthy();
		}
	});
});

describe('English and German', () => {
	it('declare two categories, so `few` is never selected for them', () => {
		for (const locale of ['en', 'de']) {
			expect(pluralCategory(locale, 1)).toBe('one');
			for (const n of [0, 2, 5, 20, 101, 1.5]) {
				expect(pluralCategory(locale, n), `${locale} ${n}`).not.toBe('few');
			}
		}
	});

	it('leave the Romanian-only forms out of their catalogues', () => {
		for (const locale of ['en', 'de']) {
			const messages = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as Record<string, string>;
			expect(Object.keys(messages).filter((key) => key.endsWith('_few'))).toEqual([]);
		}
	});
});
