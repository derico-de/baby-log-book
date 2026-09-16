/* When a correction asks before it lands.

   Corrections are first-class and the app confirms almost nothing — undo covers
   a mistake that is cheap to correct, and a confirm step on every write would
   tax every nappy every night ([spec §8.5](../../../.scratch/baby-log-book/spec.md)).
   A correction is the one write with no undo: it lands as a revision, and
   putting the old figure back is another correction.

   That matters for exactly one gesture. A row is opened by tapping it, the
   timeline is the screen the app opens on, and a stray tap lands on whatever
   was under the thumb — usually something from hours or days ago. Today's rows
   are the everyday correction and still save straight through; an old one is
   asked about once (ADR-0042). */

import type { Entry } from './types';

/** How far behind now an Entry has to sit before a correction asks first. */
export const CORRECTION_ASK_AFTER_MS = 2 * 60 * 60 * 1000;

/** The most recent instant the Entry states. A finished Session is as recent as
    its end, so a Sleep that ran through the night and ended twenty minutes ago
    is this morning's row and asks nothing.

    A running Session states only its start, and is read from it like everything
    else: a Sleep or a Feed still open hours later is either the row the fan and
    the stale banner already speak for — neither of which comes through this
    sheet — or a session nobody stopped, which is exactly an old row. */
export function correctionAsksFirst(entry: Entry, now: number): boolean {
	return now - (entry.ended_at ?? entry.occurred_at) > CORRECTION_ASK_AFTER_MS;
}
