/* Payload shape, and the validation the database cannot do.

   ADR-0001 puts type-specific fields in a JSON payload, which buys one table
   and roughly ten queries at the price of the engine not being able to check
   anything. So this file is that check, on both sides of the wire:

     - `validateEntryFields()` is the strict gate on the push path. A stranger
       runs this server; the sync endpoint is the only door, and it is open to
       anything a Member's Device sends.
     - `coercePayload()` is the tolerant read path. A fold must never throw:
       additive payload changes deliberately do not bump the protocol version
       (spec §5.5), so an older client will meet fields it has never heard of
       and has to render the rest of the row anyway. */

import type {
	BottleContents,
	Consistency,
	EntryType,
	MealAmount,
	MealFood,
	PayloadOf,
	RevisionKind,
	Side
} from './types';
import { ENTRY_TYPES } from './types';

const SIDES: Side[] = ['left', 'right', 'both'];
const CONTENTS: BottleContents[] = ['breast_milk', 'formula', 'other'];
const AMOUNTS: MealAmount[] = ['tasted', 'some', 'lots'];
const CONSISTENCIES: Consistency[] = ['soft', 'firm', 'runny', 'hard'];

export const MAX_NOTE = 2000;
export const MAX_NAME = 200;
/** Millilitres, grams and millimetres are integers by design (spec §3.4),
    which is also what makes a comma-delimited CSV safe in DE and RO. */
const MAX_VOLUME_ML = 5000;
const MAX_WEIGHT_G = 60_000;
const MAX_LENGTH_MM = 2000;
const MAX_FOODS_PER_MEAL = 40;

type Check = (v: unknown) => boolean;

const isFiniteNumber: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const isInstant: Check = (v) => isFiniteNumber(v) && (v as number) > 0;
const isNullableInstant: Check = (v) => v === null || isInstant(v);
const isBool: Check = (v) => typeof v === 'boolean';
const isId: Check = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isNullableId: Check = (v) => v === null || isId(v);
const isText = (max: number): Check => (v) => v === null || (typeof v === 'string' && v.length <= max);
const isOneOf = (values: readonly string[]): Check => (v) => typeof v === 'string' && values.includes(v);
const isNullableOneOf = (values: readonly string[]): Check => (v) => v === null || isOneOf(values)(v);
const isIntIn = (max: number): Check => (v) =>
	v === null || (isFiniteNumber(v) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max);

/** A zone id, not an offset. A numeric offset is a dead number: it renders one
    wall time back and can never re-derive a Day Start (spec §7.3). */
const isZone: Check = (v) => {
	if (typeof v !== 'string' || v.length === 0 || v.length > 64) return false;
	/* `Intl` accepts `+02:00` as a time zone, and that is precisely the value
	   this app must never store: it renders one wall time back and cannot say
	   what 05:00 means in that place on any other date. */
	if (/^[+-]/.test(v) || v.includes(':')) return false;
	try {
		new Intl.DateTimeFormat('en', { timeZone: v });
		return true;
	} catch {
		return false;
	}
};

const isMealFoods: Check = (v) => {
	if (!Array.isArray(v) || v.length > MAX_FOODS_PER_MEAL) return false;
	return v.every(
		(f) =>
			f != null &&
			typeof f === 'object' &&
			isId((f as MealFood).food_id) &&
			isNullableOneOf(AMOUNTS)((f as MealFood).amount ?? null) &&
			isText(MAX_NOTE)((f as MealFood).reaction ?? null)
	);
};

/** Payload keys are unique across the seven types, which is what lets an
    ordinary edit — a revision that names `volume_ml` and nothing else — be
    validated without knowing the Entry's type. */
const ENTRY_FIELD_CHECKS: Record<string, Check> = {
	/* shared columns */
	baby_id: isId,
	type: (v) => ENTRY_TYPES.includes(v as EntryType),
	occurred_at: isInstant,
	ended_at: isNullableInstant,
	recording_zone: isZone,
	note: isText(MAX_NOTE),
	deleted_at: isNullableInstant,
	merged_into: isNullableId,
	/* breast feed */
	side: isOneOf(SIDES),
	/* bottle feed */
	volume_ml: isIntIn(MAX_VOLUME_ML),
	contents: isNullableOneOf(CONTENTS),
	/* meal */
	foods: isMealFoods,
	/* nappy */
	pee: isBool,
	poop: isBool,
	consistency: isNullableOneOf(CONSISTENCIES),
	/* measurement */
	weight_g: isIntIn(MAX_WEIGHT_G),
	height_mm: isIntIn(MAX_LENGTH_MM),
	head_mm: isIntIn(MAX_LENGTH_MM),
	/* milestone — a Milestone Name is written, not chosen (ADR-0011) */
	name: isText(MAX_NAME)
};

const FOOD_FIELD_CHECKS: Record<string, Check> = {
	name: (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME,
	deleted_at: isNullableInstant
};

const BABY_FIELD_CHECKS: Record<string, Check> = {
	name: (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME,
	birth_date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
	deleted_at: isNullableInstant
};

/** Members carry id, display name, role and locale. Nothing authenticating
    ever syncs (spec §5.1). */
const MEMBER_FIELD_CHECKS: Record<string, Check> = {
	display_name: (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME,
	role: isOneOf(['parent', 'caregiver']),
	removed_at: isNullableInstant,
	locale: isNullableOneOf(['en', 'de', 'ro'])
};

const HOUSEHOLD_FIELD_CHECKS: Record<string, Check> = {
	name: isText(MAX_NAME),
	/** An hour, not an instant (spec §7.4). */
	day_start: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
	zone: isZone
};

const TARGET_FIELD_CHECKS: Record<string, Check> = {
	baby_id: isId,
	activity: isOneOf(['feed', 'sleep']),
	duration_s: (v) => isFiniteNumber(v) && Number.isInteger(v) && (v as number) > 0 && (v as number) <= 24 * 3600,
	anchor: isOneOf(['feed_start', 'sleep_end']),
	deleted_at: isNullableInstant
};

const CHECKS_BY_KIND: Record<RevisionKind, Record<string, Check>> = {
	entry: ENTRY_FIELD_CHECKS,
	food: FOOD_FIELD_CHECKS,
	baby: BABY_FIELD_CHECKS,
	member: MEMBER_FIELD_CHECKS,
	household: HOUSEHOLD_FIELD_CHECKS,
	target: TARGET_FIELD_CHECKS
};

export type Validation =
	| { ok: true; fields: Record<string, unknown> }
	| { ok: false; reason: string };

/** Validates the fields a revision names. Unknown keys are dropped rather
    than rejected: a client can only be *ahead* of the server after a
    rollback, and in that case it refuses to push at all (spec §9.3), so an
    unknown key is a bug or an attacker — and failing the batch would cost a
    Member the Entries in their outbox. */
export function validateFields(kind: RevisionKind, fields: unknown): Validation {
	if (fields == null || typeof fields !== 'object' || Array.isArray(fields)) {
		return { ok: false, reason: 'fields must be an object' };
	}
	const checks = CHECKS_BY_KIND[kind];
	if (!checks) return { ok: false, reason: `unknown kind ${String(kind)}` };

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
		const check = checks[key];
		if (!check) continue;
		if (!check(value)) return { ok: false, reason: `invalid ${kind}.${key}` };
		out[key] = value;
	}
	if (Object.keys(out).length === 0) return { ok: false, reason: 'revision names no known field' };
	return { ok: true, fields: out };
}

export function emptyPayload<T extends EntryType>(type: T): PayloadOf[T] {
	/* One cast, at the one place a type discriminator becomes a payload shape. */
	const as = (value: object) => value as unknown as PayloadOf[T];
	switch (type) {
		case 'breast_feed':
			return as({ side: 'both' });
		case 'bottle_feed':
			return as({ volume_ml: null, contents: null });
		case 'meal':
			return as({ foods: [] });
		case 'nappy':
			return as({ pee: false, poop: false, consistency: null });
		case 'measurement':
			return as({ weight_g: null, height_mm: null, head_mm: null });
		case 'milestone':
			return as({ name: '' });
		default:
			return as({});
	}
}

/** The tolerant read path. Fills the shape a renderer expects and never
    throws — `rowToEntry()`'s natural home, per the driver research. */
export function coercePayload<T extends EntryType>(type: T, raw: Record<string, unknown>): PayloadOf[T] {
	const base = emptyPayload(type) as Record<string, unknown>;
	switch (type) {
		case 'breast_feed':
			if (isOneOf(SIDES)(raw.side)) base.side = raw.side;
			break;
		case 'bottle_feed':
			if (isIntIn(MAX_VOLUME_ML)(raw.volume_ml)) base.volume_ml = raw.volume_ml ?? null;
			if (isNullableOneOf(CONTENTS)(raw.contents)) base.contents = raw.contents ?? null;
			break;
		case 'meal':
			base.foods = isMealFoods(raw.foods)
				? (raw.foods as MealFood[]).map((f) => ({
						food_id: f.food_id,
						amount: f.amount ?? null,
						reaction: f.reaction ?? null
					}))
				: [];
			break;
		case 'nappy':
			if (isBool(raw.pee)) base.pee = raw.pee;
			if (isBool(raw.poop)) base.poop = raw.poop;
			if (isNullableOneOf(CONSISTENCIES)(raw.consistency)) base.consistency = raw.consistency ?? null;
			break;
		case 'measurement':
			if (isIntIn(MAX_WEIGHT_G)(raw.weight_g)) base.weight_g = raw.weight_g ?? null;
			if (isIntIn(MAX_LENGTH_MM)(raw.height_mm)) base.height_mm = raw.height_mm ?? null;
			if (isIntIn(MAX_LENGTH_MM)(raw.head_mm)) base.head_mm = raw.head_mm ?? null;
			break;
		case 'milestone':
			base.name = typeof raw.name === 'string' ? raw.name : '';
			break;
	}
	return base as PayloadOf[T];
}

/** True for the types that are a Live Session while they have no end. */
export function isFeed(type: EntryType): boolean {
	return type === 'breast_feed' || type === 'bottle_feed';
}
