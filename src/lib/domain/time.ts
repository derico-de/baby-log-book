/* Time. ADR-0010, spec §7.

   The invariant this file exists to hold:

     Anything used for ordering, merging, the cursor or a duration is an
     instant. Local wall time is a display-time projection and never enters a
     comparison.

   So every function here takes instants and a zone id, and the only functions
   that produce wall-clock values are the ones a renderer calls. There is no
   date library: `Intl.DateTimeFormat` already knows the IANA database, and
   what it does not give us — the instant of a nominal wall time in a zone — is
   forty lines and two DST rules. */

export interface WallParts {
	y: number;
	m: number;
	d: number;
	h: number;
	mi: number;
	s: number;
}

const DAY = 86_400_000;
const MINUTE = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		formatters.set(zone, f);
	}
	return f;
}

/** Projects an instant through a zone. This is the lens, and its output may
    never be compared with another projection. */
export function wallPartsOf(instant: number, zone: string): WallParts {
	const parts = formatter(zone).formatToParts(new Date(instant));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	return {
		y: get('year'),
		m: get('month'),
		d: get('day'),
		h: get('hour'),
		mi: get('minute'),
		s: get('second')
	};
}

/** Minutes east of UTC at this instant in this zone. Derived every time,
    never stored — a zone id regenerates the offset; an offset never
    regenerates the zone. */
export function offsetMinutes(instant: number, zone: string): number {
	const p = wallPartsOf(instant, zone);
	const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
	return Math.round((asUTC - Math.floor(instant / 1000) * 1000) / MINUTE);
}

function matchesWall(instant: number, zone: string, want: Omit<WallParts, 's'>): boolean {
	const p = wallPartsOf(instant, zone);
	return p.y === want.y && p.m === want.m && p.d === want.d && p.h === want.h && p.mi === want.mi;
}

/** The first instant in `(lo, hi]` at which the zone's offset differs from the
    offset at `lo`. Binary search to the minute, which is exact: every
    transition in the IANA database lands on a minute boundary. Runs on two
    days a year and only when a Household's Day Start falls inside the gap. */
function findTransition(lo: number, hi: number, zone: string): number {
	const before = offsetMinutes(lo, zone);
	let low = lo;
	let high = hi;
	while (high - low > MINUTE) {
		const mid = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
		if (mid <= low) break;
		if (offsetMinutes(mid, zone) === before) low = mid;
		else high = mid;
	}
	return high;
}

/** The instant at which a nominal wall time occurs in a zone.

    DST, per spec §7.5:
      - skipped (spring forward)  → the instant the clock jumps to
      - repeated (fall back)      → the first occurrence

    Both rules exist so the day boundary stays monotone rather than becoming
    accidental. */
export function wallToInstant(want: Omit<WallParts, 's'>, zone: string): number {
	const asUTC = Date.UTC(want.y, want.m - 1, want.d, want.h, want.mi);
	const before = offsetMinutes(asUTC - DAY, zone);
	const after = offsetMinutes(asUTC + DAY, zone);

	const candidates = before === after ? [asUTC - before * MINUTE] : [asUTC - before * MINUTE, asUTC - after * MINUTE];
	const valid = candidates.filter((c) => matchesWall(c, zone, want));

	if (valid.length > 0) return Math.min(...valid);

	/* No such wall time exists: the clock jumped over it. */
	return findTransition(Math.min(...candidates), Math.max(...candidates), zone);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD`, the shape a day bucket is named by. */
export function dateKey(parts: { y: number; m: number; d: number }): string {
	return `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
}

export function parseDateKey(key: string): { y: number; m: number; d: number } {
	const [y, m, d] = key.split('-').map(Number);
	return { y, m, d };
}

/** Calendar arithmetic on a date key. No zone involved: a date is not an
    instant, and walking days must not drift through a DST boundary. */
export function addDays(key: string, days: number): string {
	const { y, m, d } = parseDateKey(key);
	const t = new Date(Date.UTC(y, m - 1, d + days));
	return dateKey({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

function hourOf(dayStart: string): { h: number; mi: number } {
	const [h, mi] = dayStart.split(':').map(Number);
	return { h: Number.isFinite(h) ? h : 5, mi: Number.isFinite(mi) ? mi : 0 };
}

/** The instant the day named `key` begins for this Household. */
export function dayStartInstant(key: string, dayStart: string, zone: string): number {
	const { y, m, d } = parseDateKey(key);
	const { h, mi } = hourOf(dayStart);
	return wallToInstant({ y, m, d, h, mi }, zone);
}

/** Which day an instant belongs to. Derived at display time, always — stamping
    a day onto each Entry at write time would freeze history against a setting
    that exists to be a lens (spec §7.1). */
export function dayBucketOf(instant: number, dayStart: string, zone: string): string {
	const p = wallPartsOf(instant, zone);
	const key = dateKey(p);
	return instant < dayStartInstant(key, dayStart, zone) ? addDays(key, -1) : key;
}

/** The instant an edited wall time names, on the day some other instant already
    belongs to. This is what a time input means when a Member corrects 14:05 to
    13:50: the same day, a different hour — never today. Returns null when the
    value is not a time at all. */
export function instantFromWallTime(value: string, onDayOf: number, zone: string): number | null {
	const [h, mi] = value.split(':').map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
	const p = wallPartsOf(onDayOf, zone);
	return wallToInstant({ y: p.y, m: p.m, d: p.d, h, mi }, zone);
}

/** Elapsed real time. The only subtraction of instants in the app, and the
    reason a Sleep across spring-forward is seven hours rather than eight. */
export function elapsed(from: number, to: number): number {
	return to - from;
}

export function splitDuration(ms: number): { hours: number; minutes: number } {
	const total = Math.max(0, Math.floor(ms / MINUTE));
	return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** A Sleep is a Night Sleep when it crosses the Day Start. One boundary
    settles both ends of the night, so no Night Start setting has to exist
    (spec §7.2). */
export function crossesDayStart(from: number, to: number, dayStart: string, zone: string): boolean {
	return dayBucketOf(from, dayStart, zone) !== dayBucketOf(to, dayStart, zone);
}

/** Past a day, an elapsed figure has stopped being a number anyone reads, and
    the header prints the absolute time instead (spec §8.4). */
export function withinLastDay(instant: number, now: number): boolean {
	return now - instant < DAY;
}

/** Age in whole months, for the Target seed table and the stale-Sleep ceiling.
    Never used to filter Milestone suggestions (spec §3.1). */
export function ageInMonths(birthDate: string, at: number, zone: string): number {
	const b = parseDateKey(birthDate);
	const p = wallPartsOf(at, zone);
	let months = (p.y - b.y) * 12 + (p.m - b.m);
	if (p.d < b.d) months -= 1;
	return Math.max(0, months);
}

export const MS = { minute: MINUTE, hour: 3_600_000, day: DAY };
