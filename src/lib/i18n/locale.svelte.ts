/* The language switch. Spec §9.5.

   The preference lives in the Member's account record, which already replicates
   locally, and is mirrored into a synchronous rune that a `custom-account`
   strategy reads. **It must be synchronous** — `getLocale()` silently skips
   promise-returning custom strategies, which would leave the app in the base
   locale with no error to notice.

   Switching writes the record, updates the cookie and the rune, and calls
   `setLocale(next, { reload: false })`. Deliberately not the default reload:
   offline, a reload is answered from the precache, and a cached document has the
   old language baked into its markup. */

import {
	defineCustomClientStrategy,
	getLocale,
	isLocale,
	locales,
	setLocale,
	cookieName,
	type Locale
} from '$lib/paraglide/runtime';
import { storeLocale } from '$client/device';

/** The rune the custom strategy reads. Synchronous by construction. */
let current = $state<Locale | undefined>(undefined);

export const LOCALES = locales;

export function accountLocale(): Locale | undefined {
	return current;
}

function writeCookie(locale: Locale) {
	if (typeof document === 'undefined') return;
	/* A cookie mirror keeps the first paint correct: the shell is prerendered, so
	   nothing on the server saw this request. */
	document.cookie = `${cookieName}=${locale}; path=/; max-age=34560000; samesite=lax`;
}

let registered = false;

/** Registers the strategy. Called once, before the first `getLocale()`. */
export function installLocaleStrategy(): void {
	if (registered) return;
	registered = true;
	defineCustomClientStrategy('custom-account', {
		getLocale: () => current,
		setLocale: (locale) => {
			current = isLocale(locale) ? locale : undefined;
		}
	});
}

/** Adopts the Member's stored preference, e.g. after the replica has loaded. */
export function adoptLocale(locale: string | null | undefined): void {
	if (!locale || !isLocale(locale)) return;
	if (locale === current) return;
	current = locale;
	writeCookie(locale);
	setLocale(locale, { reload: false });
}

/** The Member changed the language. The caller persists it to the account
    record; everything here is the same-tab consequence. */
export function switchLocale(locale: Locale): void {
	current = locale;
	writeCookie(locale);
	storeLocale(locale);
	setLocale(locale, { reload: false });
}

export function activeLocale(): Locale {
	return current ?? (getLocale() as Locale);
}

export const LOCALE_NAMES: Record<string, string> = {
	en: 'English',
	de: 'Deutsch',
	ro: 'Română'
};
