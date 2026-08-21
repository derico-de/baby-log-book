/* The Device's own identity and its Device Settings.

   `device_id` outlives the session and is stored beside the local replica, not
   with the credential: sign-out, re-claim and rescue all keep it, and only
   wiping the local database mints a new one, which is harmless. It is the
   lexicographic tie-breaker in the merge key and **never a proof of identity** —
   nothing may treat possession of one as authorisation (spec §6.2).

   Device Settings never enter the sync log (spec §9.4). They live in
   localStorage because the appearance resolver has to read one before first
   paint, and because mum dismissing the install banner must not hide it on
   Oma's phone. */

import type { Where } from '$domain/types';

const DEVICE_KEY = 'blb.device';
/** Read by the paint-blocking resolver in app.html. */
const APPEARANCE_KEY = 'blb.appearance';
const DAY_START_MIRROR_KEY = 'blb.dayStart';
const INSTALL_DISMISSED_KEY = 'blb.installDismissed';
const LOCALE_KEY = 'blb.locale';
const FEEDING_DEFAULT_KEY = 'blb.feedingDefault';
const WHERE_DEFAULT_KEY = 'blb.whereDefault';

export type AppearanceOverride = 'auto' | 'day' | 'night';
export type FeedingDefault = 'breast' | 'bottle_breast_milk' | 'bottle_formula';

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* A Device in private mode still has to work for the session. */
	}
}

export function deviceId(): string {
	const existing = read(DEVICE_KEY);
	if (existing && existing.length > 0) return existing;
	const minted =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `d-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
	write(DEVICE_KEY, minted);
	return minted;
}

/** Three settings, not four. There is no *Always deep night*: deep night is a
    concession to a moment, not a taste (spec §8.1). */
export function appearanceOverride(): AppearanceOverride {
	const value = read(APPEARANCE_KEY);
	return value === 'day' || value === 'night' ? value : 'auto';
}

export function setAppearanceOverride(value: AppearanceOverride): void {
	write(APPEARANCE_KEY, value);
	/* Re-resolve immediately: the resolver owns the attributes, not the app. */
	window.__blbAppearance?.apply();
}

/** How the feed sheet opens: which mode is preselected, and for a bottle,
    which contents. Stated in Settings, never learned from logged feeds — and
    per Device, not per Baby: it matches the mum-breastfeeds / Oma-bottles
    reality without touching the sync log. Breast is the seeded default, so a
    Device that has never set it behaves exactly as before the setting
    existed — and so does one holding a value from a newer release. */
export function feedingDefault(): FeedingDefault {
	const value = read(FEEDING_DEFAULT_KEY);
	return value === 'bottle_breast_milk' || value === 'bottle_formula' ? value : 'breast';
}

export function setFeedingDefault(value: FeedingDefault): void {
	write(FEEDING_DEFAULT_KEY, value);
}

/** Where the pee & poop form opens — nappy, potty or toilet. The same shape as
    the feeding default and for the same reason: it is a fact about this phase
    of this child's life, stated once rather than re-tapped forty times a week,
    and never learned from what was logged. A Device that has never set it opens
    on the nappy, which is where a Baby starts. */
export function whereDefault(): Where {
	const value = read(WHERE_DEFAULT_KEY);
	return value === 'potty' || value === 'toilet' ? value : 'nappy';
}

export function setWhereDefault(value: Where): void {
	write(WHERE_DEFAULT_KEY, value);
}

/** The Household's Day Start, mirrored where the resolver can read it
    synchronously on a cold first paint. Read as a NUMBER against this Device's
    own clock — bucketing resolves the same hour in the Household Zone, and
    appearance never does (spec §7.4). */
export function mirrorDayStart(dayStart: string): void {
	if (read(DAY_START_MIRROR_KEY) === dayStart) return;
	write(DAY_START_MIRROR_KEY, dayStart);
	window.__blbAppearance?.apply();
}

/** Ignored and dismissed differ: the banner persists until explicitly dismissed
    or installed, because one that retires itself leaves the Member who kept
    meaning to get round to it with no trace of what they saw (spec §9.3). */
export function installBannerDismissed(): boolean {
	return read(INSTALL_DISMISSED_KEY) === '1';
}

export function dismissInstallBanner(): void {
	write(INSTALL_DISMISSED_KEY, '1');
}

/** The cookie mirror keeps the first paint correct; this one keeps the choice
    when the cookie is cleared but the replica is not. */
export function storedLocale(): string | null {
	return read(LOCALE_KEY);
}

export function storeLocale(locale: string): void {
	write(LOCALE_KEY, locale);
}

export function deviceZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}
