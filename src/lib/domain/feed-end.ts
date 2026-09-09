/* A Baby eats one thing at a time. ADR-0019, moved into the push transaction
   by ADR-0034.

   The rule was written for the feed sheet, which means it was enforced for one
   writer: two Devices that each start a Feed while partitioned already reach
   the hole, and a Hub writing a plain creation would too. Here it is a fold
   over what the log says, so the server holds it for every writer and the
   sheet keeps only its preview.

   **This is an end, not a merge — ADR-0014 stands.** Both rows survive with
   their millilitres; nothing is tombstoned and no volume leaves the day. A
   Combined Feed is still logged as the several Feeds it was, only now each
   earlier Feed carries the end it in fact had. */

import { isFeed } from './entries';
import type { Entry, EntryType, PendingRevision } from './types';

export interface FeedEnd {
	/** The Feed that was still running. */
	entry_id: string;
	/** When it in fact ended: the start of the feeding that followed it. A
	    fact a Member entered, never a guess the app made. */
	ended_at: number;
	/** The Member who logged that following feeding — not the app, unlike the
	    close of a bottle past its Life (ADR-0017). */
	author_id: string | null;
}

const live = (e: Entry) => e.deleted_at == null && e.merged_into == null;

/** A feeding is a Feed or a Meal (ADR-0019). Milk and solids are the same
    question — *is she eating something else now* — and a Meal answers it. */
const isFeeding = (type: EntryType) => isFeed(type) || type === 'meal';

/** The total order two feedings are compared in: when it happened, then the
    entry id. The id breaks the tie so two servers — or the same server run
    twice — reach the same answer, exactly as `planSessionMerges` does, and so
    two feedings logged at the identical instant cannot each end the other. */
function follows(later: Entry, earlier: Entry): boolean {
	return later.occurred_at !== earlier.occurred_at
		? later.occurred_at > earlier.occurred_at
		: later.id > earlier.id;
}

function byId(entries: Entry[]): Entry[] {
	const seen = new Map<string, Entry>();
	for (const e of entries) if (!seen.has(e.id)) seen.set(e.id, e);
	return [...seen.values()];
}

/** Which running Feeds the log says have in fact ended, and when.

    `openFeeds` is every Live Session the Household has; `feedings` is those
    plus whatever feedings the push touched — a Meal is not a session, so it
    can only arrive from the batch.

    The guard is ADR-0019's, unchanged: a Feed ends only at a feeding that
    **follows** its start. A back-dated feeding predating the running Feed is a
    separate, earlier feed — she ate, then the current feed began — and leaves
    it alone. */
export function planFeedEnds(openFeeds: Entry[], feedings: Entry[]): FeedEnd[] {
	const candidates = byId(feedings).filter((e) => live(e) && isFeeding(e.type));
	const running = byId(openFeeds).filter(
		(e) => live(e) && isFeed(e.type) && e.ended_at == null
	);

	const plans: FeedEnd[] = [];
	for (const feed of running) {
		let next: Entry | null = null;
		for (const other of candidates) {
			if (other.id === feed.id || other.baby_id !== feed.baby_id) continue;
			if (!follows(other, feed)) continue;
			/* The *earliest* feeding after it: that is the one she moved on to, and
			   a later one would claim minutes she was already eating something
			   else. */
			if (next == null || follows(next, other)) next = other;
		}
		if (next) {
			plans.push({
				entry_id: feed.id,
				ended_at: next.occurred_at,
				author_id: next.logged_by === '' ? null : next.logged_by
			});
		}
	}
	return plans.sort((a, b) => (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0));
}

/** The revision a feed end appends. Attributed to the Member who logged the
    new feeding, as ADR-0019 specifies — the end instant is one they entered,
    so "the app never writes data nobody entered" holds. */
export function feedEndRevision(
	plan: FeedEnd,
	ctx: { household_id: string; at: number; device_id: string; id: string }
): PendingRevision {
	return {
		id: ctx.id,
		household_id: ctx.household_id,
		kind: 'entry',
		entity_id: plan.entry_id,
		fields: { ended_at: plan.ended_at },
		merge_at: ctx.at,
		device_id: ctx.device_id,
		author_id: plan.author_id
	};
}
