/* Whether a Household has Lapsed. ADR-0022.

   This file is a seam and almost nothing else. What *makes* a Household Lapse
   belongs to the hosted-service effort, and until that lands nothing here ever
   says yes. Naming the contract now is the point: the Python half handles a
   `402` from day one and needs no later release to learn how, and the check
   sits in the right places in the right order before anything can grow around
   the wrong ones.

   The rule it exists to hold is ADR-0022's: **no read-only tier by accident.**
   A derived read added without that in mind quietly becomes one — a wall that
   still shows this morning's feeds is exactly the tier the ADR refused — so
   the gate is checked before any fold *and* before the ETag comparison, and a
   Lapsed Household cannot even learn that nothing has changed.

   It gates **all** claims too, not just a Hub's: a phone claiming an Invite
   into a Lapsed Household is the same trap, and letting the claim succeed
   would burn a one-shot link and mint a session that then meets a 402
   everywhere. */

import type { Db } from './db';

export type LapsedCheck = (db: Db, householdId: string) => boolean;

/** Nothing Lapses yet. */
const NEVER: LapsedCheck = () => false;

let check: LapsedCheck = NEVER;

/** The one question, asked from the derived read and from both claim paths. */
export function isLapsed(db: Db, householdId: string): boolean {
	return check(db, householdId);
}

/** Installs the answer. The hosted-service effort calls this once at boot with
    whatever it decides Lapsing means; a test calls it to make a Household
    Lapse and puts it back afterwards. Returns what was there before. */
export function setLapsedCheck(next: LapsedCheck | null): LapsedCheck {
	const previous = check;
	check = next ?? NEVER;
	return previous;
}
