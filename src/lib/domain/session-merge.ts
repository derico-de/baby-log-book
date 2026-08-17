/* Session Merge. Spec §5.3, and the reason building the sync engine beat
   buying one: this is cross-document business logic — two rows with different
   UUIDs declared to be the same real-world Sleep — and inside our own push
   transaction it is thirty lines rather than an expression of someone else's
   write model.

   Any two open sessions OF THE SAME KIND for one Baby are a contradiction: a
   Baby cannot be asleep twice. So there is no time-window heuristic here and
   no similarity score — the contradiction is the whole signal.

   Per kind is load-bearing. An open Feed beside an open Sleep is a Sleep Feed:
   normal, deliberate and nightly. A kind-agnostic merge would tombstone one of
   them on the single most common night pattern in the app. */

import { resolveMerged } from './revisions';
import { sessionKindOf, type Entry, type PendingRevision, type SessionKind } from './types';

export interface MergePlan {
	/** The session that survives — the earliest start. */
	survivor_id: string;
	/** Tombstoned, with `merged_into` pointing at the survivor. */
	loser_id: string;
	baby_id: string;
	kind: 'feed' | 'sleep';
}

/** Which of the currently open sessions contradict each other, and who wins.

    Earliest start wins. Ties break on the entry id so two servers — or the
    same server run twice — reach the same answer: this runs inside the push
    transaction and has to be idempotent. */
export function planSessionMerges(liveSessions: Entry[]): MergePlan[] {
	/* Grouped by Baby and then by kind rather than by a composite string key: the
	   two dimensions stay two dimensions, and nothing has to invent a separator
	   that a Baby id could never contain. */
	const byBaby = new Map<string, Map<SessionKind, Entry[]>>();
	for (const e of liveSessions) {
		if (e.ended_at != null || e.deleted_at != null || e.merged_into != null) continue;
		const kind = sessionKindOf(e.type);
		if (!kind) continue;
		let kinds = byBaby.get(e.baby_id);
		if (!kinds) {
			kinds = new Map();
			byBaby.set(e.baby_id, kinds);
		}
		const list = kinds.get(kind);
		if (list) list.push(e);
		else kinds.set(kind, [e]);
	}

	const plans: MergePlan[] = [];
	for (const kinds of byBaby.values()) {
		for (const [kind, list] of kinds) {
			if (list.length < 2) continue;
			const ordered = [...list].sort(
				(a, b) => a.occurred_at - b.occurred_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
			);
			const survivor = ordered[0];
			for (const loser of ordered.slice(1)) {
				plans.push({
					survivor_id: survivor.id,
					loser_id: loser.id,
					baby_id: survivor.baby_id,
					kind
				});
			}
		}
	}
	return plans;
}

/** The revision a merge appends. Attributed to the app rather than to a Member
    — `author_id` is null — so the history says honestly that no person did it.
    This is the one place an app-authored revision exists, and it does not
    weaken the rule that the app never writes data nobody entered: reconciling
    two sessions a human did start is not the same as inventing one. */
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

/** Re-points a revision at the surviving session, transitively.

    This is what makes a late "stop" pressed on the losing Device land on the
    right session — and it applies to every field, not only the end time,
    because the loser and the survivor are the same real-world session: a
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
