/* Every write the app can make.

   Two rules govern this file, and between them they explain every signature:

     - **The app never writes data nobody entered.** No auto-closed Sleeps, no
       materialised expected Feeds, no synthesised end times. There is no
       function here that invents a value.
     - A write goes to the outbox first and reaches the server whenever it can.
       Nothing here awaits the network, so logging is never blocked.

   Each function returns the revision id, which is also the Entry id for a
   creation — that is what the toast's Undo holds on to. */

import { randomId } from './id';
import { applyLocal } from './apply';
import { deviceId, deviceZone } from './device';
import type { ReplicaDb } from './db';
import type {
	Activity,
	Anchor,
	BottleContents,
	Consistency,
	EntryType,
	MealFood,
	Revision,
	RevisionKind,
	Role,
	Side
} from '$domain/types';
import { milestoneInstant } from '$domain/milestones';

export interface Writer {
	db: ReplicaDb;
	householdId: string;
	memberId: string;
	/** This Device's clock corrected by its observed server offset. */
	mergeAt: () => number;
	now: () => number;
	/** Nudges the sync loop. Never awaited by a caller that is logging. */
	kick: () => void;
}

async function write(
	w: Writer,
	kind: RevisionKind,
	entityId: string,
	fields: Record<string, unknown>
): Promise<string> {
	const revision: Revision = {
		id: randomId(),
		household_id: w.householdId,
		kind,
		entity_id: entityId,
		fields,
		merge_at: w.mergeAt(),
		device_id: deviceId(),
		author_id: w.memberId
	};
	await applyLocal(w.db, w.householdId, revision, w.now());
	w.kick();
	return revision.id;
}

/** Shared fields of any new Entry. `recording_zone` is set here and a Revision
    never rewrites it: Oma correcting a German Feed from Bucharest does not
    restamp it with Romania (spec §7.3). Nothing in v1 reads it. */
function creation(babyId: string, type: EntryType, occurredAt: number, note?: string | null) {
	return {
		baby_id: babyId,
		type,
		occurred_at: occurredAt,
		ended_at: null,
		recording_zone: deviceZone(),
		note: note ?? null
	};
}

export interface EntryTarget {
	babyId: string;
	/** Defaults to now. A back-dated Entry passes its own instant. */
	occurredAt?: number;
	note?: string | null;
}

/* --- the fan ---------------------------------------------------------- */

/** Nappies log straight from the fan — no sheet, no confirm. Two taps, and the
    second is a large target (spec §8.5). */
export async function logNappy(
	w: Writer,
	target: EntryTarget & { pee: boolean; poop: boolean; consistency?: Consistency | null }
): Promise<string> {
	const id = randomId();
	await write(w, 'entry', id, {
		...creation(target.babyId, 'nappy', target.occurredAt ?? w.now(), target.note),
		pee: target.pee,
		poop: target.poop,
		consistency: target.consistency ?? null
	});
	return id;
}

/** Starts a Sleep. A Live Session is an Entry with no end — not a separate
    concept — so this is an ordinary creation. */
export async function startSleep(w: Writer, target: EntryTarget): Promise<string> {
	const id = randomId();
	await write(w, 'entry', id, creation(target.babyId, 'sleep', target.occurredAt ?? w.now(), target.note));
	return id;
}

export async function logBreastFeed(
	w: Writer,
	target: EntryTarget & { side: Side; endedAt?: number | null }
): Promise<string> {
	const id = randomId();
	const occurredAt = target.occurredAt ?? w.now();
	await write(w, 'entry', id, {
		...creation(target.babyId, 'breast_feed', occurredAt, target.note),
		/* The side and the total duration, never per-side timers: too fiddly
		   one-handed, and the data is rarely used (spec §3.2). */
		side: target.side,
		ended_at: target.endedAt ?? null
	});
	return id;
}

export async function logBottleFeed(
	w: Writer,
	target: EntryTarget & {
		volumeMl: number | null;
		/** What came back in the bottle. Usually null at creation — the leftover
		    is a fact from the end of the Feed, and the Entry sheet is where it is
		    normally entered. */
		leftoverMl?: number | null;
		contents: BottleContents | null;
		endedAt?: number | null;
	}
): Promise<string> {
	const id = randomId();
	await write(w, 'entry', id, {
		...creation(target.babyId, 'bottle_feed', target.occurredAt ?? w.now(), target.note),
		volume_ml: target.volumeMl,
		leftover_ml: target.leftoverMl ?? null,
		contents: target.contents,
		ended_at: target.endedAt ?? null
	});
	return id;
}

/** A Meal's Foods list is one field: an edit replaces it wholesale (spec §5.1). */
export async function logMeal(w: Writer, target: EntryTarget & { foods: MealFood[] }): Promise<string> {
	const id = randomId();
	await write(w, 'entry', id, {
		...creation(target.babyId, 'meal', target.occurredAt ?? w.now(), target.note),
		foods: target.foods
	});
	return id;
}

/** Weight, height and head circumference, all optional, entered together.
    Canonical integer units — grams and millimetres — formatted at display. */
export async function logMeasurement(
	w: Writer,
	target: EntryTarget & { weightG: number | null; heightMm: number | null; headMm: number | null }
): Promise<string> {
	const id = randomId();
	await write(w, 'entry', id, {
		...creation(target.babyId, 'measurement', target.occurredAt ?? w.now(), target.note),
		weight_g: target.weightG,
		height_mm: target.heightMm,
		head_mm: target.headMm
	});
	return id;
}

/** The name is stored exactly as it was typed (ADR-0011). Dated today it is the
    moment of logging; back-dated it is the Day Start of that date, so it sits at
    the head of its day (spec §3.6). */
export async function logMilestone(
	w: Writer,
	target: Omit<EntryTarget, 'occurredAt'> & {
		name: string;
		/** `YYYY-MM-DD`, or null for today. */
		dateKey?: string | null;
		dayStart: string;
		zone: string;
	}
): Promise<string> {
	const id = randomId();
	const occurredAt = milestoneInstant(target.dateKey ?? null, w.now(), {
		dayStart: target.dayStart,
		zone: target.zone
	});
	await write(w, 'entry', id, {
		...creation(target.babyId, 'milestone', occurredAt, target.note),
		name: target.name
	});
	return id;
}

/* --- sessions --------------------------------------------------------- */

/** Stops a Live Session at an instant a human supplied. There is deliberately no
    function that stops one at a guess. */
export function stopSession(w: Writer, entryId: string, endedAt: number): Promise<string> {
	return write(w, 'entry', entryId, { ended_at: endedAt });
}

/** *She's awake* — ends the Sleep, and the fan reflows in place to the awake set
    so wake-then-feed is one FAB open and three taps (spec §8.5). */
export function endSleep(w: Writer, sleepId: string, at?: number): Promise<string> {
	return write(w, 'entry', sleepId, { ended_at: at ?? w.now() });
}

/** Picking Food inside the asleep sheet switches her to awake: solids and sleep
    are mutually exclusive, so the switch *is* the statement. The Sleep ends at
    the Meal's Occurred At as one ordinary revision with no lasting linkage —
    later corrections to either are independent.

    Guard: only when that Occurred At falls inside the running Sleep. A back-dated
    Meal predating the Sleep is "she ate, then went down" — leave the Sleep
    alone. */
export async function markAwakeForMeal(
	w: Writer,
	sleep: { id: string; occurred_at: number; ended_at: number | null },
	mealAt: number
): Promise<string | null> {
	if (sleep.ended_at != null) return null;
	if (mealAt < sleep.occurred_at) return null;
	return write(w, 'entry', sleep.id, { ended_at: mealAt });
}

/* --- corrections ------------------------------------------------------ */

/** Any Member may fix any Member's Entry, and the history stays visible: the row
    reads "edited by Oma, was 120 ml" (ADR-0002). */
export function correctEntry(
	w: Writer,
	entryId: string,
	fields: Record<string, unknown>
): Promise<string> {
	return write(w, 'entry', entryId, fields);
}

/** A tombstone hides an Entry and never purges it, so a 3am mistake is
    recoverable on every Device. */
export function deleteEntry(w: Writer, entryId: string): Promise<string> {
	return write(w, 'entry', entryId, { deleted_at: w.mergeAt() });
}

/** Undo, which is why the fan has no confirm step. */
export function undoDelete(w: Writer, entryId: string): Promise<string> {
	return write(w, 'entry', entryId, { deleted_at: null });
}

/* --- reference data --------------------------------------------------- */

/** The Household's growing catalogue. A Caregiver logging a Meal may add to it. */
export async function addFood(w: Writer, name: string): Promise<string> {
	const id = randomId();
	await write(w, 'food', id, { name });
	return id;
}

export function renameFood(w: Writer, foodId: string, name: string): Promise<string> {
	return write(w, 'food', foodId, { name });
}

export function removeFood(w: Writer, foodId: string): Promise<string> {
	return write(w, 'food', foodId, { deleted_at: w.mergeAt() });
}

/** The server seeds this Baby's Targets from the age table when it sees the
    creation, so two Devices adding her cannot seed two different sets. */
export async function addBaby(w: Writer, name: string, birthDate: string): Promise<string> {
	const id = randomId();
	await write(w, 'baby', id, { name, birth_date: birthDate });
	return id;
}

export function updateBaby(
	w: Writer,
	babyId: string,
	fields: { name?: string; birth_date?: string }
): Promise<string> {
	return write(w, 'baby', babyId, fields);
}

/* --- Household settings and Members ----------------------------------- */

/** Changing the Day Start re-buckets the past, and the settings screen says so
    before saving (spec §7.1). */
export function setDayStart(w: Writer, dayStart: string): Promise<string> {
	return write(w, 'household', w.householdId, { day_start: dayStart });
}

/** One value, not a history. Changing it re-reads the whole past through the new
    lens; the Day Start hour is untouched (spec §7.3). */
export function setHouseholdZone(w: Writer, zone: string): Promise<string> {
	return write(w, 'household', w.householdId, { zone });
}

/** A Target is a duration plus the anchor it measures from. */
export async function setTarget(
	w: Writer,
	target: { id?: string; babyId: string; activity: Activity; durationS: number; anchor: Anchor }
): Promise<string> {
	const id = target.id ?? randomId();
	await write(w, 'target', id, {
		baby_id: target.babyId,
		activity: target.activity,
		duration_s: Math.round(target.durationS),
		anchor: target.anchor
	});
	return id;
}

export function setMemberRole(w: Writer, memberId: string, role: Role): Promise<string> {
	return write(w, 'member', memberId, { role });
}

/** Removal is a state, never a deletion: the Member row survives forever, marked
    removed, because every Revision they ever wrote points at it (spec §6.4). */
export function removeMember(w: Writer, memberId: string): Promise<string> {
	return write(w, 'member', memberId, { removed_at: w.mergeAt() });
}

export function renameMember(w: Writer, memberId: string, displayName: string): Promise<string> {
	return write(w, 'member', memberId, { display_name: displayName });
}

/** The language preference lives in the account record, which is already
    replicated locally, and is mirrored into a cookie and a synchronous rune for
    the first paint (spec §9.4). */
export function setMemberLocale(w: Writer, memberId: string, locale: string): Promise<string> {
	return write(w, 'member', memberId, { locale });
}
