/* The derived read a Hub lives on. Spec §5.5 and §5.6, ADR-0034.

   A Hub holds no replica and folds nothing: it cannot answer *when did she
   last feed* from anything it has. So this is the app's own header, run
   server-side and addressed to a client that cannot compute it — the same
   `headerState()` and `statsFor()` the phone paints from, imported unchanged.
   The wall cannot disagree with the app's header, because it *is* the app's
   header.

   Two properties this file exists to hold:

     - **No rows cross the wire.** No Entries, no Meals, no Milestones, no
       Measurements, no Revision history. A Hub answers *how is today going*;
       the phone answers everything else. The three ids of the sessions running
       right now are the one exception, and they are handles for the wall's own
       end buttons rather than log — see `HubBaby` below.
     - **Instants only.** No `elapsedMs`, no `remainingMs`, no `overdue`
       (ADR-0036). The Hub derives all three itself, exactly as a phone ticks a
       running timer with no traffic — which is also what leaves the payload a
       pure function of the log, the settings, the day key and the night key,
       and therefore conditional. */

import { statsFor, type FeedsSecondary } from '$domain/stats';
import {
	anchorEntry,
	anchorInstant,
	bottleTargetOf,
	dueInstant,
	headerState,
	nightPeriodOf
} from '$domain/targets';
import { dayBucketOf, dayStartInstant, MS, withinNight } from '$domain/time';
import type { Baby, Entry, Household, Target } from '$domain/types';
import type { Db } from './db';
import { isLapsed } from './lapsed';
import { currentCursor, getHousehold, listBabies, listTargets, liveEntries } from './store';

/** One Baby, as a wall reads her. Every key here is byte-for-byte the
    integration's entity key (spec §6.5), so payload → entity needs no
    translation table — renaming one is a wire change. */
export interface HubBaby {
	id: string;
	/** As the Household spelled her; it becomes the Home Assistant device name. */
	name: string;

	/* timestamps (7) */
	last_feed: number | null;
	feed_due: number | null;
	asleep_since: number | null;
	awake_since: number | null;
	wake_window_up: number | null;
	bottle_runs_out: number | null;
	last_poop: number | null;

	/* binaries (3) */
	asleep: boolean;
	feeding: boolean;
	bottle_open: boolean;

	/* the running sessions' Entry ids (3) — handles, not rows.

	   A wall's *End feed*, *She's awake* and *Off her tummy* write `ended_at`
	   on a running Entry, and a revision addresses its entity by id. Without
	   these three the only endable session would be one this Hub itself
	   started, and a Sleep begun on a phone could never be stopped at the wall
	   — so the buttons in spec §6.6 need them (spec §5.5's *no per-Entry ids*
	   was written about the log, and still holds: nothing closed, nothing
	   deleted and nothing historical is named here).

	   They stay safe for the same reason the `baby_id` a Hub sends is safe:
	   the id is never a capability, and `entityBelongsElsewhere` is what makes
	   it so (ADR-0020). */
	feed_entry_id: string | null;
	sleep_entry_id: string | null;
	tummy_entry_id: string | null;

	/* totals (6) — sleep and tummy in whole minutes, floored here */
	feeds_today: number;
	sleep_today: number;
	/** Omitted, never null, until the Household has ever logged tummy time. */
	tummy_today?: number;
	pees_today: number;
	poops_today: number;
	/** Omitted, never null, until the Household has ever logged a bottle. */
	milk_today?: number;
}

export interface HubHousehold {
	id: string;
	name: string;
	/** Today's Day Start instant in the Household Zone. Household-level, because
	    Day Start is a Household setting — and it becomes every total's declared
	    `last_reset`, so no sensor ever re-derives "today" from local midnight. */
	day_reset_at: number;
	/** The Day Start itself, `HH:MM`. `day_reset_at` answers *when did today
	    begin*; this answers *what hour did the Household state*, and an
	    automation's night window needs the hour — the Night Period **ends** at
	    the Day Start (ADR-0032), and tomorrow's boundary cannot be read off
	    today's instant. */
	day_start: string;
	/** The hour the Night Period begins, `HH:MM`, or `null` where this
	    Household keeps none — the *effective* one, so a `night_start` equal to
	    the Day Start arrives as `null` exactly as `nightPeriodOf` reads it. A
	    Hub already sees the Night in `feed_due`, which the night moves; this is
	    the boundary itself, for the automations that want to be quieter inside
	    it. */
	night_start: string | null;
	/** Seconds *before* the Feed Interval is up that the app sends its own Feed
	    Notice, and seconds *after* the Wake Window is up for the Sleep Notice;
	    `null` where the Household sends neither (ADR-0031).

	    No notice crosses this wire and none ever will — a deployment never
	    wakes a Hub. These are the *numbers*, not the reminders: a Household
	    that has said how much warning is useful has said it once, and a wall's
	    automation should not make it say it again. */
	feed_notice_s: number | null;
	sleep_notice_s: number | null;
	/** ADR-0041's switch, passed straight through. A read, never a gate: no
	    total is suppressed while it is off, because that would make every
	    derived figure lie. The app states; the Household's automation decides. */
	caregiving: boolean;
}

export interface HubState {
	cursor: number;
	household: HubHousehold;
	babies: HubBaby[];
}

export interface HubStateInput {
	cursor: number;
	household: Household;
	/** Every Baby the Household has; deleted ones are dropped here. */
	babies: Baby[];
	/** Every live Entry of the Household — `liveEntries()`, unbounded. */
	entries: Entry[];
	targets: Target[];
	now: number;
}

/** Whole minutes, floored. The honest unit for a wall: nobody reads seconds of
    sleep off a screen in a hall. */
const minutes = (ms: number) => Math.floor(ms / MS.minute);

/** The stretch she is on her tummy for right now, or null. `headerState` names
    the running Feed and the running Sleep but not this one — Tummy Time never
    reached the header, because the glossary has it answer *how many minutes
    were there today*, never *when did one begin*. The latest started, for the
    same reason the header picks the latest Feed: with two open at once, the one
    she is on now is the one a wall's *Off her tummy* means. */
function runningTummy(entries: Entry[]): Entry | null {
	let latest: Entry | null = null;
	for (const e of entries) {
		if (e.type !== 'tummy_time' || e.ended_at != null) continue;
		if (latest == null || e.occurred_at > latest.occurred_at) latest = e;
	}
	return latest;
}

/** The strong ETag: `"<cursor>-<dayKey>-<nightBegun>"` (spec §5.6).

    The payload is a pure function of `(log, targets, settings, dayKey,
    nightBegun)`, and this is the identity of that tuple:

      - `cursor` flips on every accepted revision.
      - `dayKey` flips at the Day Start, where today's totals reset with no new
        revision — without it a `304` would hold the wall on yesterday's
        numbers.
      - `nightBegun` flips at the stated Night Start, where `feed_due` moves
        with no new revision and no day-key change (ADR-0040). Monotone within
        a night, so one bit is enough, and it costs at most one extra miss a
        day: it goes back to `0` at the Day Start, where `dayKey` already
        forces one.

    The Hub echoes this verbatim and never parses it, which is what keeps all
    three components a server freedom. */
export function hubEtag(cursor: number, household: Household, now: number): string {
	const dayKey = dayBucketOf(now, household.day_start, household.zone);
	const night = nightPeriodOf(household);
	/* *Has the Night in force begun* — which is exactly *is it night now*: an
	   instant inside a Night that has not started yet still has the evening's
	   Feed ahead of it, and `pastNight` leaves it where it is until the hour
	   arrives. A Household that keeps no Night Period pins the bit at 0 and
	   sees no extra fold. */
	const nightBegun = night && withinNight(now, night, household.zone) ? 1 : 0;
	return `"${cursor}-${dayKey}-${nightBegun}"`;
}

export function hubState(input: HubStateInput): HubState {
	const { household, entries, now } = input;
	const dayStart = household.day_start;
	const zone = household.zone;
	const night = nightPeriodOf(household);

	/* Ever-logged, over the whole live log the fold already fetched — *not*
	   `statsFor`'s window-scoped `has*`. Once a Household has tracked tummy
	   time, *0 minutes today* is a true statement forever, and the payload must
	   never drop a field it once carried: the rule only adds. Household-level,
	   like the fields it gates, so one schema covers every Baby. */
	const everBottle = entries.some((e) => e.type === 'bottle_feed');
	const everTummy = entries.some((e) => e.type === 'tummy_time');

	const babies = input.babies
		.filter((baby) => baby.deleted_at == null)
		.map((baby) => hubBaby({ baby, entries, targets: input.targets, dayStart, zone, night, now, everBottle, everTummy }));

	return {
		cursor: input.cursor,
		household: {
			id: household.id,
			name: household.name,
			day_reset_at: dayStartInstant(dayBucketOf(now, dayStart, zone), dayStart, zone),
			day_start: dayStart,
			/* The Night in force, not the column: `nightPeriodOf` is what the
			   folds above are run with, and a Hub must not read a boundary the
			   app itself is ignoring. */
			night_start: night?.start ?? null,
			/* Settings, so the cursor already carries them: every one of these
			   changes by way of a household revision, and `hubEtag` folds the
			   cursor. No new ETag component. */
			feed_notice_s: household.feed_notice_s,
			sleep_notice_s: household.sleep_notice_s,
			caregiving: household.caregiving
		},
		babies
	};
}

function hubBaby(input: {
	baby: Baby;
	entries: Entry[];
	targets: Target[];
	dayStart: string;
	zone: string;
	night: ReturnType<typeof nightPeriodOf>;
	now: number;
	everBottle: boolean;
	everTummy: boolean;
}): HubBaby {
	const { baby, dayStart, zone, night, now } = input;
	const mine = input.entries.filter((e) => e.baby_id === baby.id);
	const targets = input.targets.filter((t) => t.baby_id === baby.id && t.deleted_at == null);

	/* Both folds, called exactly as the app calls them. */
	const header = headerState({ entries: mine, targets, now, dayStart, zone, night, babyId: baby.id });
	const cards = statsFor({ entries: mine, babyId: baby.id, now, dayStart, zone, night });

	const card = (kind: 'feeds' | 'sleep' | 'tummy') => cards.find((c) => c.kind === kind);
	const feeds = card('feeds');

	/* The bottle still open, not the last one poured — `anchorEntry` is the same
	   function the Bottle Life countdown anchors on, and `bottleTargetOf`
	   synthesizes the seeded hour, so this is never unknown for lack of a
	   Target. */
	const openBottle = anchorEntry({ anchor: 'bottle_start' }, mine);

	return {
		id: baby.id,
		name: baby.name,

		last_feed: header.feed.lastAt,
		feed_due: header.feed.dueAt,
		asleep_since: header.sleep.running?.occurred_at ?? null,
		/* The last Sleep's end, and unknown while one runs: awake time is time
		   not covered by a Sleep. */
		awake_since: header.sleep.running ? null : anchorInstant({ anchor: 'sleep_end' }, mine),
		/* Deliberately not night-shifted: a Wake Window is how long she is
		   comfortably awake and says nothing about the hour (ADR-0032). */
		wake_window_up: header.sleep.dueAt,
		bottle_runs_out: openBottle
			? dueInstant(bottleTargetOf(targets, baby.id), openBottle.occurred_at)
			: null,
		/* Reaches past the Day Start on purpose: *she hasn't pooped since
		   Tuesday* is the question a wall panel exists to answer. */
		last_poop: header.nappies.lastPoopAt,

		asleep: header.sleep.running != null,
		feeding: header.feed.running != null,
		bottle_open: openBottle != null,

		feed_entry_id: header.feed.running?.id ?? null,
		sleep_entry_id: header.sleep.running?.id ?? null,
		tummy_entry_id: runningTummy(mine)?.id ?? null,

		/* Rounds, not rows: a breast feed and the formula topped up right after
		   are one answer to *has she eaten*, which is what the app's own stats
		   card counts. */
		feeds_today: feeds?.today ?? 0,
		sleep_today: minutes(card('sleep')?.today ?? 0),
		...(input.everTummy ? { tummy_today: minutes(card('tummy')?.today ?? 0) } : {}),
		pees_today: header.nappies.pee,
		poops_today: header.nappies.poop,
		...(input.everBottle
			? { milk_today: (feeds?.secondary as FeedsSecondary | undefined)?.volumeMlToday ?? 0 }
			: {})
	};
}

/** What the endpoint answers, decided before any of it is rendered.

    The order below is contract, not an implementation detail (spec §5.6):

        session → removed → lapsed → ETag → fetch → fold

    The first two belong to `requireMember`, which every sync route already
    runs. The rest is here, and the reason it is one function is that the
    ordering is the thing being promised: `lapsed` is checked **before** the
    ETag, so a Lapsed Household cannot even learn *nothing changed*
    (ADR-0022 — no read-only tier by accident), and the ETag is checked before
    anything is fetched, so a quiet night costs a cursor lookup and two key
    computations and never a fold. */
export type HubRead =
	| { status: 200; etag: string; state: HubState }
	/** Nothing changed. An empty body, and the previous payload still stands. */
	| { status: 304; etag: string }
	| { status: 401; code: 'unauthenticated' }
	| { status: 402; code: 'lapsed' };

export function readHubState(
	db: Db,
	householdId: string,
	options: { ifNoneMatch?: string | null; now: number }
): HubRead {
	const { now } = options;

	/* Before the ETag, and therefore before any fetch: a Lapsed Household may
	   not even learn that nothing has changed (ADR-0022). */
	if (isLapsed(db, householdId)) return { status: 402, code: 'lapsed' };

	const household = getHousehold(db, householdId);
	/* A session whose Household is gone is not a session. */
	if (!household) return { status: 401, code: 'unauthenticated' };

	const cursor = currentCursor(db, householdId);
	const etag = hubEtag(cursor, household, now);
	if (etagOffered(options.ifNoneMatch, etag)) return { status: 304, etag };

	return {
		status: 200,
		etag,
		state: hubState({
			cursor,
			household,
			babies: listBabies(db, householdId),
			entries: liveEntries(db, householdId),
			targets: listTargets(db, householdId),
			now
		})
	};
}

/** Whether the Hub already holds this exact ETag. A list, because a proxy in
    the middle may send several — and a plain string compare, because the Hub
    echoes ours verbatim and nothing on either side parses it. */
export function etagOffered(offered: string | null | undefined, etag: string): boolean {
	if (offered == null) return false;
	return offered.split(',').some((value) => value.trim() === etag);
}
