/* The shape of everything that syncs.
   CONTEXT.md holds the meaning; spec §3 holds the shape.

   Every instant in this file is epoch milliseconds. ADR-0010 and spec §7.6:
   anything used for ordering, merging, the cursor or a duration is an
   instant, and local wall time is a display-time projection that never
   enters a comparison. There is no `Date` in a stored field anywhere. */

/** The eight Entry types (spec §3.2). */
export const ENTRY_TYPES = [
	'breast_feed',
	'bottle_feed',
	'meal',
	'sleep',
	'nappy',
	'measurement',
	'milestone',
	'tummy_time'
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** The types that are a Live Session while they have no end (spec §3.4). */
export const SESSION_TYPES = ['breast_feed', 'bottle_feed', 'sleep', 'tummy_time'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** One log for everything (spec §5.1). Device Settings are the carve-out and
    are not in this list — they never enter the log (spec §9.4). */
export const REVISION_KINDS = ['entry', 'food', 'baby', 'member', 'household', 'target'] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

export type Side = 'left' | 'right' | 'both';
export type BottleContents = 'breast_milk' | 'formula' | 'other';
/** Coarse amounts, never grams (spec §3.2). */
export type MealAmount = 'tasted' | 'some' | 'lots';
export type Consistency = 'soft' | 'firm' | 'runny' | 'hard';
/** Where a pee or a poop landed. Null on every row logged before the field
    existed, and on any row nobody said — which is honest rather than
    backfilled as a nappy the app was never told about (ticket 26). */
export type Where = 'nappy' | 'potty' | 'toilet';
export type Role = 'parent' | 'caregiver';
export type Activity = 'feed' | 'sleep' | 'bottle';
/** The Feed Interval runs from the previous Feed's start; the Wake Window
    from the last Sleep's end; the Bottle Life from the start of the bottle
    that is still open. Three anchors, deliberately (spec §6.5). */
export type Anchor = 'feed_start' | 'sleep_end' | 'bottle_start';

export interface BreastFeedPayload {
	side: Side;
}
export interface BottleFeedPayload {
	/** What went into the bottle. */
	volume_ml: number | null;
	/** What came back in it, entered when the Feed is done. Kept beside the
	    volume rather than subtracted from it: a 180 ml bottle she left 30 ml of
	    is not the same fact as a 150 ml bottle, and while she is still drinking
	    only one of the two numbers is knowable (ADR-0015). */
	leftover_ml: number | null;
	contents: BottleContents | null;
}
/** A Meal's Foods list is ONE field: an edit replaces it wholesale, so two
    concurrent edits lose one list — recoverably, as a revision (spec §5.1). */
export interface MealFood {
	food_id: string;
	amount: MealAmount | null;
	/** Observed information, so it is stored — unlike first exposure, which is
	    derived (spec §3.4). */
	reaction: string | null;
}
export interface MealPayload {
	foods: MealFood[];
}
export type SleepPayload = Record<string, never>;
/** Tummy Time records its two ends and nothing else — the same empty payload a
    Sleep has, for the same reason: the duration is the whole fact (spec §3.7). */
export type TummyTimePayload = Record<string, never>;
export interface NappyPayload {
	pee: boolean;
	poop: boolean;
	consistency: Consistency | null;
	/** The receptacle, which is the detail — the two facts above are the
	    entry. Additive and nullable, so no migration and no protocol bump. */
	where: Where | null;
}
/** Canonical units — grams and millimetres, integers, formatted at display
    (spec §3.4). */
export interface MeasurementPayload {
	weight_g: number | null;
	height_mm: number | null;
	head_mm: number | null;
}
/** Written, not chosen (ADR-0011). Stored as typed. */
export interface MilestonePayload {
	name: string;
}

export type Payload =
	| BreastFeedPayload
	| BottleFeedPayload
	| MealPayload
	| SleepPayload
	| NappyPayload
	| MeasurementPayload
	| MilestonePayload
	| TummyTimePayload;

export interface PayloadOf {
	breast_feed: BreastFeedPayload;
	bottle_feed: BottleFeedPayload;
	meal: MealPayload;
	sleep: SleepPayload;
	nappy: NappyPayload;
	measurement: MeasurementPayload;
	milestone: MilestonePayload;
	tummy_time: TummyTimePayload;
}

/** An Entry as the app reads it: the fold over its revisions, materialised.
    A Live Session is an Entry with no `ended_at` — not a separate concept. */
export interface Entry<T extends EntryType = EntryType> {
	id: string;
	household_id: string;
	baby_id: string;
	type: T;
	/** When it happened to the Baby, not when a Member got round to logging it. */
	occurred_at: number;
	ended_at: number | null;
	/** The IANA zone id of the Device that created it. Nothing in v1 reads
	    it; it is captured because it is unrecoverable later (spec §7.3). */
	recording_zone: string;
	note: string | null;
	payload: PayloadOf[T];
	logged_by: string;
	logged_at: number;
	/** Set once a revision after the first has changed something, which is
	    what lets a row read "edited by Oma, was 120 ml". */
	edited_by: string | null;
	edited_at: number | null;
	/** A tombstone hides an Entry and never purges it (ADR-0002). */
	deleted_at: number | null;
	/** Session Merge: follow transitively so a late stop lands on the
	    survivor (spec §5.3). */
	merged_into: string | null;
}

export interface Baby {
	id: string;
	household_id: string;
	name: string;
	/** Seeds Targets and the stale-Sleep ceiling. Never filters Milestone
	    suggestions (spec §3.1). A date, because a birth date is not an
	    instant anyone measures against — stored as `YYYY-MM-DD`. */
	birth_date: string;
	deleted_at: number | null;
}

export interface MemberRecord {
	id: string;
	household_id: string;
	display_name: string;
	role: Role;
	/** Removal is a state, never a deletion (spec §6.4). */
	removed_at: number | null;
	/** Per Member, mirrored into a cookie and a synchronous rune (spec §9.4). */
	locale: string | null;
}

export interface Food {
	id: string;
	household_id: string;
	name: string;
	deleted_at: number | null;
}

export interface Target {
	id: string;
	household_id: string;
	baby_id: string;
	activity: Activity;
	/** A duration plus the anchor it measures from, which is what makes v2
	    push notifications additive (spec §2, §6.5). */
	duration_s: number;
	anchor: Anchor;
	deleted_at: number | null;
}

export interface Household {
	id: string;
	name: string;
	/** An hour, not an instant. `HH:MM`. Default 05:00 (spec §7.1). */
	day_start: string;
	/** One IANA zone id — the single lens for bucketing, timeline, stats and
	    export (spec §7.3). */
	zone: string;
}

/** A revision is immutable and names only the fields it changed (ADR-0003). */
export interface Revision {
	id: string;
	household_id: string;
	kind: RevisionKind;
	entity_id: string;
	/** Only the changed fields. Shared Entry columns and payload keys live
	    side by side here; `splitFields()` sorts them out at the storage edge. */
	fields: Record<string, unknown>;
	/** The merge key: the writing Device's clock corrected by its observed
	    server offset. NOT the cursor (ADR-0004). */
	merge_at: number;
	/** The lexicographic tie-breaker. Never a proof of identity (spec §6.2). */
	device_id: string;
	/** The Member who wrote it, or null for the one app-authored case there
	    is: a Session Merge (spec §5.3). */
	author_id: string | null;
	/** Server-assigned cursor, absent until the server has accepted it. */
	seq?: number;
	/** Set when a future-dated merge key was clamped to server receipt time.
	    Never a rejection — refusing to record a night feed is worse than
	    recording it slightly late (spec §5.2). */
	skewed?: boolean;
}

/** A revision on its way to the server: no seq yet. */
export type PendingRevision = Omit<Revision, 'seq'>;

/** The Entry columns that are not payload. Everything else in a revision's
    `fields` is type-specific and lands in the JSON payload (ADR-0001). */
export const SHARED_ENTRY_FIELDS = [
	'baby_id',
	'type',
	'occurred_at',
	'ended_at',
	'recording_zone',
	'note',
	'deleted_at',
	'merged_into'
] as const;

export const DEFAULT_DAY_START = '05:00';

/** Bumped only by a change that would make an old client write something
    wrong. Additive payload changes do not bump it (spec §5.5).

    2 — the Bottle Life Target. A client that predates it coerces the unknown
    activity to `feed`, and then `targetFor(targets, 'feed')` can pick it: the
    header would print the wrong Feed Interval, and a Parent editing that field
    in Settings would overwrite the Bottle Life record. That is an old client
    writing something wrong, which is exactly what this number is for. */
export const PROTOCOL_VERSION = 2;
