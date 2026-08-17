/* Milestones. ADR-0011, spec §3.6.

   The name is written, not chosen — and there is no catalogue. A Food repeats
   constantly and that reuse pays for a mutable entity; a Milestone name repeats
   once per Baby, if that. So the suggestion list is *derived* from the
   Milestones themselves, which means it cannot drift: correct a typo on the
   entry and the bad suggestion goes with it, where a catalogue would keep the
   orphan.

   Two deliberate omissions, and they are load-bearing:
     - "Slept through the night" is not a starter. The app holds every Sleep; it
       would be a hand-typed claim sitting beside data that contradicts it.
     - No age annotation and no age filtering anywhere in this file. The moment
       it reads "crawling: 7–10 months", a logging app has become a
       developmental schedule telling a parent their nine-month-old is late. */

import { dayBucketOf, dayStartInstant } from './time';
import type { Entry, MilestonePayload } from './types';

/** Ten starter suggestions in rough chronological order. These are UI text and
    nothing more — the ids are message keys, and the localised strings are
    passed back in by the caller. Nobody ever proposed a localised carrot. */
export const STARTER_MILESTONE_KEYS = [
	'first_smile',
	'first_laugh',
	'rolled_over',
	'sat_up_unaided',
	'first_tooth',
	'started_crawling',
	'pulled_to_stand',
	'first_steps',
	'first_word',
	'waved'
] as const;

export type StarterMilestoneKey = (typeof STARTER_MILESTONE_KEYS)[number];

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

/** The combobox's list: this Household's own Milestone Names first, newest
    first, then the starters it has not used yet.

    Uniqueness is nobody's business — "first tooth" happens once, while "new
    word" and "new tooth" repeat by design — so this only deduplicates the
    *suggestion list*, never the Milestones. */
export function milestoneSuggestions(entries: Entry[], starters: string[]): string[] {
	const used: string[] = [];
	const seen = new Set<string>();

	for (const e of [...entries].sort((a, b) => b.occurred_at - a.occurred_at)) {
		if (e.type !== 'milestone' || !live(e)) continue;
		const name = (e.payload as MilestonePayload).name.trim();
		if (name.length === 0) continue;
		const key = name.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		used.push(name);
	}

	for (const starter of starters) {
		const key = starter.trim().toLocaleLowerCase();
		if (key.length === 0 || seen.has(key)) continue;
		seen.add(key);
		used.push(starter);
	}

	return used;
}

/** A Milestone stays an instant — a date-only field would be the only value in
    the system that is not one, breaking ADR-0010 and the one-table shape.
    Precision is dropped at display instead (the timeline shows an em dash where
    the clock time would be).

    Dated today → the moment of logging. Back-dated → the Day Start of that
    date, so it sits at the head of its day, which is what makes a row with no
    visible time legible among timed ones. */
export function milestoneInstant(
	dateKey: string | null,
	now: number,
	hh: { dayStart: string; zone: string }
): number {
	if (dateKey == null || dateKey === dayBucketOf(now, hh.dayStart, hh.zone)) return now;
	return dayStartInstant(dateKey, hh.dayStart, hh.zone);
}
