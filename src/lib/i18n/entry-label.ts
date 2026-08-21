/* What an Entry is called, in words.

   Extracted from `TimelineRow` when the day grid arrived: two surfaces naming
   the same Entry two different ways is the product-UI failure the register
   reference calls inconsistent component vocabulary. A block in the grid, its
   accessible name, and the timeline row it corresponds to now come from one
   function — so "Bottle · Formula · 150 ml" is that Entry's name everywhere,
   and a change to it is a change everywhere.

   The glyph belongs here for the same reason. */

import { millilitres, length, weight } from './format';
import { intakeMl, isFeed } from '$domain/entries';
import type {
	BottleFeedPayload,
	BreastFeedPayload,
	Entry,
	EntryType,
	MealPayload,
	MeasurementPayload,
	MilestonePayload,
	NappyPayload
} from '$domain/types';
import * as m from '$lib/paraglide/messages';
import type { IconName } from '$lib/components/Icon.svelte';

export const GLYPH_OF: Record<EntryType, IconName> = {
	breast_feed: 'feed',
	bottle_feed: 'feed',
	meal: 'meal',
	sleep: 'sleep',
	nappy: 'nappy',
	measurement: 'measure',
	milestone: 'flag',
	tummy_time: 'tummy'
};

/** A Meal names its Foods, so the caller supplies the lookup rather than this
    module reaching for app state. */
export type FoodName = (id: string) => string;

/** What a run of Feeds is called, in pieces, so both the whole title and the
    shortened one in a Combined Feed come out of the same place.

    `entries` is one Feed for an ordinary title and several when they were the
    same milk twice — in which case the millilitres add up (`feedRunTitle`).

    `omitType` drops the leading *Breast* / *Bottle*, for a run whose neighbour
    already said it. It is honoured only when the run has something else to
    call itself by: a bottle nobody recorded the contents of would come out as
    a bare "120 ml", which reads as more of whatever came before it. */
function feedParts(entries: Entry[], omitType: boolean): string[] {
	const first = entries[0];
	if (first.type === 'breast_feed') {
		const side = (first.payload as BreastFeedPayload).side;
		const which = side === 'left' ? m.side_left() : side === 'right' ? m.side_right() : m.side_both();
		return omitType ? [which] : [m.type_breast_feed(), which];
	}
	/* Bottle · Formula · 150 ml. The milk type earns its place in the title
	   rather than the meta line: on a Combined Feed it is the only thing
	   telling two adjacent bottles apart. The figure is the Intake, on legacy
	   and new rows alike — the "X of Y" form is retired (ADR-0018). */
	const p = first.payload as BottleFeedPayload;
	const contents = p.contents
		? p.contents === 'breast_milk'
			? m.contents_breast_milk()
			: p.contents === 'formula'
				? m.contents_formula()
				: m.contents_other()
		: null;
	const amounts = entries
		.map((e) => intakeMl(e.payload as BottleFeedPayload))
		.filter((ml): ml is number => ml != null);

	const parts: string[] = [];
	if (!omitType || contents == null) parts.push(m.type_bottle_feed());
	if (contents) parts.push(contents);
	if (amounts.length > 0) parts.push(millilitres(amounts.reduce((a, b) => a + b, 0)));
	return parts;
}

export function entryTitle(entry: Entry, foodName: FoodName): string {
	switch (entry.type) {
		case 'breast_feed':
		case 'bottle_feed':
			return feedParts([entry], false).join(' · ');
		case 'meal': {
			const foods = (entry.payload as MealPayload).foods.map((f) => foodName(f.food_id)).filter(Boolean);
			return foods.length > 0 ? foods.join(', ') : m.type_meal();
		}
		case 'sleep':
			return m.type_sleep();
		case 'nappy': {
			const p = entry.payload as NappyPayload;
			if (p.pee && p.poop) return m.nappy_both();
			return p.poop ? m.nappy_poop() : m.nappy_pee();
		}
		case 'measurement': {
			const p = entry.payload as MeasurementPayload;
			const parts = [
				p.weight_g == null ? null : weight(p.weight_g),
				p.height_mm == null ? null : length(p.height_mm),
				p.head_mm == null ? null : length(p.head_mm)
			].filter(Boolean);
			return parts.length > 0 ? parts.join(' · ') : m.type_measurement();
		}
		case 'milestone':
			return (entry.payload as MilestonePayload).name || m.type_milestone();
		case 'tummy_time':
			return m.type_tummy_time();
	}
}

/** A run of Feeds that were the same milk twice, named once.

    Two bottles of the same formula back to back are one bigger feeding that
    happened to need a second bottle, so they read `Bottle · Formula · 140 ml`
    rather than making anyone add 60 and 80 in their head. The same holds for a
    breast: a left side twice in one sitting is one left side. Two *different*
    sources stay two things — that is a handover, and it reads as one.

    Whether two Feeds *are* the same thing is `feedContentKey()`; this only
    states the answer. A run of one is just its title, so every caller can go
    through here.

    `omitType` is for the run after a run of the same kind: *Bottle · Breast
    milk · 60 ml + Bottle · Formula · 80 ml* says the word twice for no reason,
    and a grid block is the one place in the app where the width is genuinely
    scarce. */
export function feedRunTitle(entries: Entry[], foodName: FoodName, omitType = false): string {
	if (!isFeed(entries[0].type)) return entryTitle(entries[0], foodName);
	return feedParts(entries, omitType).join(' · ');
}

/** The short name a grid block wears when there is room for a word but not for
    the whole title — the type alone, never its detail. */
export function entryTypeName(type: EntryType): string {
	switch (type) {
		case 'breast_feed':
			return m.type_breast_feed();
		case 'bottle_feed':
			return m.type_bottle_feed();
		case 'meal':
			return m.type_meal();
		case 'sleep':
			return m.type_sleep();
		case 'nappy':
			return m.type_nappy();
		case 'measurement':
			return m.type_measurement();
		case 'milestone':
			return m.type_milestone();
		case 'tummy_time':
			return m.type_tummy_time();
	}
}
