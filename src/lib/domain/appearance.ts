/* The appearance rule, as a pure function. ADR-0008, spec §8.1.

   The implementation that actually runs is the inline script in `src/app.html`:
   it is the only script allowed to block first paint, because a clock cannot be
   read from CSS and a resolver that runs after paint produces exactly the white
   flash in a dark bedroom the rule exists to prevent. Nothing imports this
   module at runtime.

   It exists so the rule is *testable*, and so the three literal boundary hours
   live somewhere a test can compare against the shell — see appearance.test.ts,
   which fails if the two ever disagree. */

export type Appearance = 'day' | 'night' | 'deep';
export type AppearanceOverride = 'auto' | 'day' | 'night';

/** The remaining boundaries are literal hours and are not configurable: they are
    "nobody is having their morning coffee at this hour" figures rather than
    averages (ADR-0008). Only the Day Start is the Household's. */
export const BOUNDARY_HOURS = { deepFrom: 23, morning: 7, evening: 19 } as const;

export function dayStartMinutes(dayStart: string): number {
	const [h, mi] = dayStart.split(':').map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(mi)) return 5 * 60;
	return h * 60 + mi;
}

/** `minutesOfDay` is read from the **Device's own clock**, never the Household
    Zone: it answers *is it dark in the room I am standing in*, and only that
    Device knows (spec §7.4). The Day Start crosses over as a plain number. */
export function resolveAppearance(
	minutesOfDay: number,
	dayStart: string,
	override: AppearanceOverride,
	prefersDark: boolean
): Appearance {
	if (override === 'day') return 'day';
	if (override === 'night') return 'night';

	const start = dayStartMinutes(dayStart);
	if (minutesOfDay >= BOUNDARY_HOURS.deepFrom * 60 || minutesOfDay < start) return 'deep';
	if (minutesOfDay < BOUNDARY_HOURS.morning * 60 || minutesOfDay >= BOUNDARY_HOURS.evening * 60) {
		return 'night';
	}

	/* Daylight hours, and the one direction the phone's own setting may act in:
	   the clock can only ever make it darker, never lighter. */
	return prefersDark ? 'night' : 'day';
}
