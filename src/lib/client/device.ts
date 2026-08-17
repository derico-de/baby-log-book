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

const DEVICE_KEY = 'blb.device';
/** Read by the paint-blocking resolver in app.html. */
const APPEARANCE_KEY = 'blb.appearance';
const DAY_START_MIRROR_KEY = 'blb.dayStart';
const INSTALL_DISMISSED_KEY = 'blb.installDismissed';
const LOCALE_KEY = 'blb.locale';

export type AppearanceOverride = 'auto' | 'day' | 'night';

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
