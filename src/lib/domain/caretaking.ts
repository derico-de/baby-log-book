/* Where caretaking is, read from the Recording Zone (ADR-0049).

   A Device in another zone cannot tell a trip with the Baby from a trip
   without her. The other Members can: whoever still cares for her at home
   logs from the Household Zone, and every Entry says where it was logged. */

import type { Entry } from './types';

/** How long a Member's latest Entry still says where they are: a night, the
    longest a Household goes without logging. */
export const CARETAKING_SEEN_MS = 12 * 60 * 60 * 1000;

/** Whether some other Member's latest Entry was logged in the zone, recently
    enough that they are still there. Each Member is read by their latest Entry
    alone, so a family that travelled together has moved by its first log. */
export function caretakingStaysIn(zone: string, entries: Entry[], memberId: string, now: number): boolean {
	const latest = new Map<string, Entry>();
	for (const entry of entries) {
		if (entry.logged_by === memberId) continue;
		const seen = latest.get(entry.logged_by);
		if (!seen || entry.logged_at > seen.logged_at) latest.set(entry.logged_by, entry);
	}
	return [...latest.values()].some((e) => e.recording_zone === zone && now - e.logged_at <= CARETAKING_SEEN_MS);
}
