/* Formatting. Everything a screen prints goes through here.

   `Intl.RelativeTimeFormat`, `Intl.DateTimeFormat` and `Intl.NumberFormat`
   throughout, metric only (spec §9.5). Canonical units are stored as integers —
   millilitres, grams, millimetres — and turned into something readable at the
   very last moment, which is what keeps unit handling out of sync, stats and the
   CSV. */

import { splitDuration, wallPartsOf } from '$domain/time';
import * as m from '$lib/paraglide/messages';
import { activeLocale } from './locale.svelte';

/** Per-locale plural category sets. Romanian genuinely has three where English
    and German have two, so the selection is `Intl.PluralRules(...).select(n)`
    and the categories a locale declares are listed here (spec §9.5). */
const CATEGORIES: Record<string, Intl.LDMLPluralRule[]> = {
	en: ['one', 'other'],
	de: ['one', 'other'],
	ro: ['one', 'few', 'other']
};

type PluralForms = Partial<Record<Intl.LDMLPluralRule, (args: { count: number }) => string>>;

/** Which form a locale would actually use for this number.

    Pure and exported so the spec's own stated verification can be a test rather
    than a claim: Romanian gives 20 → other, 1.5 → few, 101 → few, and English and
    German declare two categories where Romanian declares three. */
export function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
	const declared = CATEGORIES[locale] ?? ['one', 'other'];
	const selected = new Intl.PluralRules(locale).select(count);
	return declared.includes(selected) ? selected : 'other';
}

/** Picks the form a locale would actually use. */
export function plural(count: number, forms: PluralForms): string {
	const category = pluralCategory(activeLocale(), count);
	const fn = forms[category] ?? forms.other ?? forms.one;
	return fn ? fn({ count }) : String(count);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2h10`, `50m`. The hero figure of the whole app. */
export function duration(ms: number): string {
	const { hours, minutes } = splitDuration(ms);
	if (hours === 0) return m.dur_m({ m: minutes });
	if (minutes === 0) return m.dur_h({ h: hours });
	return m.dur_hm({ h: hours, m: pad(minutes) });
}

/** The clock face of an instant, in the Household Zone — the single lens. */
export function clockTime(instant: number, zone: string): string {
	return new Intl.DateTimeFormat(activeLocale(), {
		timeZone: zone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(instant));
}

export function dateShort(instant: number, zone: string): string {
	return new Intl.DateTimeFormat(activeLocale(), {
		timeZone: zone,
		day: 'numeric',
		month: 'short'
	}).format(new Date(instant));
}

export function dateFull(instant: number, zone: string): string {
	return new Intl.DateTimeFormat(activeLocale(), {
		timeZone: zone,
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	}).format(new Date(instant));
}

export function dateAndTime(instant: number, zone: string): string {
	return new Intl.DateTimeFormat(activeLocale(), {
		timeZone: zone,
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(instant));
}

/** Two letters for a stats bar label. */
export function weekdayShort(instant: number, zone: string): string {
	return new Intl.DateTimeFormat(activeLocale(), { timeZone: zone, weekday: 'short' })
		.format(new Date(instant))
		.slice(0, 2);
}

const number = (value: number, digits = 0) =>
	new Intl.NumberFormat(activeLocale(), {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	}).format(value);

export function millilitres(ml: number): string {
	return m.ml({ n: number(ml) });
}

/** Grams below a kilo, kilograms above — with one decimal, which is how a
    paediatrician says it. */
export function weight(grams: number): string {
	if (grams < 1000) return m.grams({ n: number(grams) });
	return m.kg({ n: number(grams / 1000, 2) });
}

export function length(mm: number): string {
	return m.cm({ n: number(mm / 10, 1) });
}

export function decimal(value: number, digits = 1): string {
	return number(value, digits);
}

/** A day heading: Today, Yesterday, or the date. */
export function dayLabel(dayKey: string, todayKey: string, yesterdayKey: string, instant: number, zone: string): string {
	if (dayKey === todayKey) return m.today();
	if (dayKey === yesterdayKey) return m.yesterday();
	return dateFull(instant, zone);
}

/** The wall time of an instant as `HH:MM`, for a time input's value. */
export function timeInputValue(instant: number, zone: string): string {
	const p = wallPartsOf(instant, zone);
	return `${pad(p.h)}:${pad(p.mi)}`;
}

export function dateInputValue(instant: number, zone: string): string {
	const p = wallPartsOf(instant, zone);
	return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** `3h`, `2h30`, `45m` — a Target, which is a duration and not a clock time. */
export function targetDuration(seconds: number): string {
	return duration(seconds * 1000);
}
