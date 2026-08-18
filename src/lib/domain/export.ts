/* Export. ADR-0007, spec §9.2.

   It is an escape hatch, not a backup: explicitly not re-importable, because
   the real backup is the SQLite file on the volume. Everything, always, no
   options — one button, all Babies, all time, the whole Household. This is the
   rare feature whose correct UI is zero UI.

   A zip of one CSV per entry type plus the reference tables. The decisive
   argument is not sparse columns — it is that a Meal holds several Foods and
   therefore does not fit one row. Both escapes are wrong: repeating the Meal
   across N rows corrupts every count in the file, and a list in one cell is no
   longer CSV. So `meals.csv` and `meal_foods.csv`.

   Rules this file exists to keep:
     - Stable English headers and enum values, whatever the UI language.
       Localised headers would make the file unparseable by anything, including
       future-you.
     - One ISO-8601 column carrying its offset, plus the IANA zone id, since an
       offset cannot regenerate a zone. No local-wall-time-only column, ever.
     - UTF-8 with a BOM, or Excel mangles German umlauts and Romanian
       diacritics. Comma delimiter, safe only because canonical units are
       integer ml, g and mm — there are no decimals to collide with the DE/RO
       decimal comma.
     - Soft-deleted entries are included and flagged. An export that silently
       drops rows the app still holds is lying about being complete. */

import { classifySleep } from './sleep';
import { intakeMl } from './entries';
import { firstExposure } from './filter';
import { offsetMinutes, wallPartsOf } from './time';
import type {
	Baby,
	BottleFeedPayload,
	BreastFeedPayload,
	Entry,
	Food,
	Household,
	MealPayload,
	MeasurementPayload,
	MemberRecord,
	MilestonePayload,
	NappyPayload,
	Revision,
	Target
} from './types';
import { PROTOCOL_VERSION } from './types';

export const BOM = '﻿';

export type Cell = string | number | boolean | null | undefined;

export function csvCell(value: Cell): string {
	if (value == null) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	const s = String(value);
	/* A leading =, +, - or @ makes a spreadsheet treat text as a formula. */
	const risky = /^[=+\-@\t\r]/.test(s);
	if (risky || /[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
	const lines = [headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))];
	/* CRLF, because that is what every spreadsheet on every platform reads. */
	return BOM + lines.join('\r\n') + '\r\n';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-08-16T02:14:00+02:00` — one column that carries its own offset. */
export function isoWithOffset(instant: number | null | undefined, zone: string): string {
	if (instant == null) return '';
	const p = wallPartsOf(instant, zone);
	const off = offsetMinutes(instant, zone);
	const sign = off < 0 ? '-' : '+';
	const abs = Math.abs(off);
	return (
		`${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

export interface ExportInput {
	household: Household;
	babies: Baby[];
	members: MemberRecord[];
	foods: Food[];
	targets: Target[];
	entries: Entry[];
	revisions: Revision[];
	exportedAt: number;
	appVersion: string;
	gitSha: string;
}

/** filename → file contents. */
export type ExportFiles = Record<string, string>;

const MINUTE = 60_000;

export function buildExport(input: ExportInput): ExportFiles {
	const zone = input.household.zone;
	const iso = (t: number | null | undefined) => isoWithOffset(t, zone);
	const babyName = new Map(input.babies.map((b) => [b.id, b.name]));
	const memberName = new Map(input.members.map((m) => [m.id, m.display_name]));
	const foodName = new Map(input.foods.map((f) => [f.id, f.name]));

	/* The edit history comes out stratified: current values plus who logged and
	   who edited on every entry row, and the full chain in revisions.csv. */
	const shared = (e: Entry): Cell[] => [
		e.id,
		e.baby_id,
		babyName.get(e.baby_id) ?? '',
		iso(e.occurred_at),
		zone,
		e.recording_zone,
		e.note,
		e.logged_by,
		memberName.get(e.logged_by) ?? '',
		iso(e.logged_at),
		e.edited_by,
		e.edited_by ? (memberName.get(e.edited_by) ?? '') : '',
		iso(e.edited_at),
		iso(e.deleted_at)
	];
	const SHARED_HEADERS = [
		'entry_id',
		'baby_id',
		'baby_name',
		'occurred_at',
		/* The lens the timestamp above is printed through. The Recording Zone
		   travels beside it because it is stored data and nothing in an export
		   may be quietly dropped — but nothing in v1 reads it. */
		'occurred_at_zone',
		'recording_zone',
		'note',
		'logged_by',
		'logged_by_name',
		'logged_at',
		'edited_by',
		'edited_by_name',
		'edited_at',
		'deleted_at'
	];

	const minutes = (from: number, to: number | null) => (to == null ? '' : Math.round((to - from) / MINUTE));
	const ofType = (type: Entry['type']) =>
		input.entries.filter((e) => e.type === type).sort((a, b) => a.occurred_at - b.occurred_at);

	const files: ExportFiles = {};

	files['sleeps.csv'] = toCsv([...SHARED_HEADERS, 'ended_at', 'duration_minutes', 'kind'], ofType('sleep').map((e) => [
		...shared(e),
		iso(e.ended_at),
		minutes(e.occurred_at, e.ended_at),
		/* Night versus Nap is derived, and derivable only because §7.2 settled
		   which is which. A running Sleep is classified against the export. */
		classifySleep(e, { dayStart: input.household.day_start, zone }, input.exportedAt)
	]));

	files['breast_feeds.csv'] = toCsv([...SHARED_HEADERS, 'ended_at', 'duration_minutes', 'side'], ofType('breast_feed').map((e) => [
		...shared(e),
		iso(e.ended_at),
		minutes(e.occurred_at, e.ended_at),
		(e.payload as BreastFeedPayload).side
	]));

	/* One `intake_ml` column, the same figure the app shows, for every era
	   (ADR-0018). A legacy row's offered/leftover pair no longer reaches the
	   file — an accepted loss: the revision log keeps it permanently, and the
	   file is an escape hatch, not an archival format (ADR-0007). */
	files['bottle_feeds.csv'] = toCsv(
		[...SHARED_HEADERS, 'ended_at', 'duration_minutes', 'intake_ml', 'contents'],
		ofType('bottle_feed').map((e) => {
			const p = e.payload as BottleFeedPayload;
			return [
				...shared(e),
				iso(e.ended_at),
				minutes(e.occurred_at, e.ended_at),
				intakeMl(p),
				p.contents
			];
		})
	);

	files['meals.csv'] = toCsv([...SHARED_HEADERS, 'food_count'], ofType('meal').map((e) => [
		...shared(e),
		(e.payload as MealPayload).foods.length
	]));

	files['meal_foods.csv'] = toCsv(
		['entry_id', 'baby_id', 'occurred_at', 'food_id', 'food_name', 'amount', 'reaction', 'first_exposure'],
		ofType('meal').flatMap((e) =>
			(e.payload as MealPayload).foods.map((f) => [
				e.id,
				e.baby_id,
				iso(e.occurred_at),
				f.food_id,
				foodName.get(f.food_id) ?? '',
				f.amount,
				f.reaction,
				/* Derived on the way out, exactly as it is derived on screen. */
				firstExposure(input.entries, f.food_id, e.baby_id) === e.occurred_at
			])
		)
	);

	files['nappies.csv'] = toCsv([...SHARED_HEADERS, 'pee', 'poop', 'consistency'], ofType('nappy').map((e) => {
		const p = e.payload as NappyPayload;
		return [...shared(e), p.pee, p.poop, p.consistency];
	}));

	files['measurements.csv'] = toCsv([...SHARED_HEADERS, 'weight_g', 'height_mm', 'head_mm'], ofType('measurement').map((e) => {
		const p = e.payload as MeasurementPayload;
		return [...shared(e), p.weight_g, p.height_mm, p.head_mm];
	}));

	files['milestones.csv'] = toCsv([...SHARED_HEADERS, 'name'], ofType('milestone').map((e) => [
		...shared(e),
		(e.payload as MilestonePayload).name
	]));

	files['babies.csv'] = toCsv(
		['baby_id', 'name', 'birth_date', 'deleted_at'],
		input.babies.map((b) => [b.id, b.name, b.birth_date, iso(b.deleted_at)])
	);

	files['members.csv'] = toCsv(
		['member_id', 'display_name', 'role', 'removed_at'],
		input.members.map((m) => [m.id, m.display_name, m.role, iso(m.removed_at)])
	);

	files['foods.csv'] = toCsv(
		['food_id', 'name', 'deleted_at'],
		input.foods.map((f) => [f.id, f.name, iso(f.deleted_at)])
	);

	files['targets.csv'] = toCsv(
		['target_id', 'baby_id', 'activity', 'duration_seconds', 'anchor', 'deleted_at'],
		input.targets.map((t) => [t.id, t.baby_id, t.activity, t.duration_s, t.anchor, iso(t.deleted_at)])
	);

	files['revisions.csv'] = toCsv(
		['revision_id', 'seq', 'kind', 'entity_id', 'merge_at', 'device_id', 'author_id', 'author_name', 'clock_skew_clamped', 'fields'],
		[...input.revisions]
			.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
			.map((r) => [
				r.id,
				r.seq ?? '',
				r.kind,
				r.entity_id,
				iso(r.merge_at),
				r.device_id,
				r.author_id,
				/* A Session Merge is attributed to the app, and the export says so
				   rather than leaving a blank nobody can interpret. */
				r.author_id == null ? 'app' : (memberName.get(r.author_id) ?? ''),
				r.skewed === true,
				JSON.stringify(r.fields)
			])
	);

	/* A day bucket is derived and never stored, so an export carrying entries
	   but not the lens exports numbers whose meaning is gone. */
	files['household.csv'] = toCsv(
		['household_id', 'name', 'household_zone', 'day_start', 'exported_at', 'app_version', 'git_sha', 'protocol_version'],
		[
			[
				input.household.id,
				input.household.name,
				zone,
				input.household.day_start,
				iso(input.exportedAt),
				input.appVersion,
				input.gitSha,
				PROTOCOL_VERSION
			]
		]
	);

	return files;
}

/** `baby-log-book-2026-08-17.zip` — the name someone will look for in a
    Downloads folder in three years. */
export function exportFileName(exportedAt: number, zone: string): string {
	const p = wallPartsOf(exportedAt, zone);
	return `baby-log-book-${p.y}-${pad(p.m)}-${pad(p.d)}.zip`;
}
