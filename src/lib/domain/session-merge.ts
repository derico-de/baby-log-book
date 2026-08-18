/* Session Merge. Spec §5.3, ADR-0014, and the reason building the sync engine
   beat buying one: this is cross-document business logic — two rows with
   different UUIDs declared to be the same real-world Sleep — and inside our own
   push transaction it is thirty lines rather than an expression of someone
   else's write model.

   **Only Sleeps merge.** Two open Sleeps for one Baby are a contradiction — a
   Baby cannot be asleep twice — so there is no time-window heuristic here and
   no similarity score: the contradiction is the whole signal.

   Feeds are deliberately exempt (ADR-0014). Two Feeds minutes apart are not a
   contradiction but a combined feed: pumped breast milk, then formula, logged
   as the two separate Feeds they are. That is the same argument that carved
   Sleep Feeds out of a kind-agnostic merge, applied one level down — and the
   cost of getting it wrong is not symmetric. A Sleep silently folded into
   another is a longer Sleep; a Feed silently folded into another is a bottle
   that vanishes from the day's volume. */

import { resolveMerged } from './revisions';
import type { Entry, PendingRevision } from './types';

export interface MergePlan {
	/** The Sleep that survives — the earliest start. */
	survivor_id: string;
	/** Tombstoned, with `merged_into` pointing at the survivor. */
	loser_id: string;
	baby_id: string;
}

/** Which of the currently open Sleeps contradict each other, and who wins.

    Earliest start wins. Ties break on the entry id so two servers — or the
    same server run twice — reach the same answer: this runs inside the push
    transaction and has to be idempotent. */
export function planSessionMerges(liveSessions: Entry[]): MergePlan[] {
	const byBaby = new Map<string, Entry[]>();
	for (const e of liveSessions) {
		if (e.type !== 'sleep') continue;
		if (e.ended_at != null || e.deleted_at != null || e.merged_into != null) continue;
		const list = byBaby.get(e.baby_id);
		if (list) list.push(e);
		else byBaby.set(e.baby_id, [e]);
	}

	const plans: MergePlan[] = [];
	for (const list of byBaby.values()) {
		if (list.length < 2) continue;
		const ordered = [...list].sort(
			(a, b) => a.occurred_at - b.occurred_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		);
		const survivor = ordered[0];
		for (const loser of ordered.slice(1)) {
			plans.push({ survivor_id: survivor.id, loser_id: loser.id, baby_id: survivor.baby_id });
		}
	}
	return plans;
}

/** The revision a merge appends. Attributed to the app rather than to a Member
    — `author_id` is null — so the history says honestly that no person did it.
    This is the one place an app-authored revision exists, and it does not
    weaken the rule that the app never writes data nobody entered: reconciling
    two Sleeps a human did start is not the same as inventing one. */
export function mergeRevision(
	plan: MergePlan,
	ctx: { household_id: string; at: number; device_id: string; id: string }
): PendingRevision {
	return {
		id: ctx.id,
		household_id: ctx.household_id,
		kind: 'entry',
		entity_id: plan.loser_id,
		fields: { deleted_at: ctx.at, merged_into: plan.survivor_id },
		merge_at: ctx.at,
		device_id: ctx.device_id,
		author_id: null
	};
}

/** Re-points a revision at the surviving Sleep, transitively.

    This is what makes a late "stop" pressed on the losing Device land on the
    right Sleep — and it applies to every field, not only the end time,
    because the loser and the survivor are the same real-world Sleep: a
    correction typed against one is a correction to the other. */
export function redirectRevision(
	revision: PendingRevision,
	mergedInto: Map<string, string>
): PendingRevision {
	if (revision.kind !== 'entry') return revision;
	/* A merge revision names the redirect itself; following it would point the
	   tombstone at the survivor and erase the survivor instead. */
	if ('merged_into' in revision.fields) return revision;
	const target = resolveMerged(revision.entity_id, mergedInto);
	return target === revision.entity_id ? revision : { ...revision, entity_id: target };
}
