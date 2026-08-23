/* The Bottle Chime's wiring (ADR-0029): the domain decides *which* bottles are
   nearly out (`bottlesNearingEnd`, tested beside the other folds); what is
   tested here is the part that lives in the app — once per bottle, and not a
   sound on a Device that never asked for one. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const played = vi.fn();
vi.mock('./chime', () => ({ playChime: () => played(), primeChime: () => {} }));

const { app } = await import('./state.svelte');
const { setBottleChime } = await import('./device');
import type { Entry, Target } from '$domain/types';

const BERLIN = 'Europe/Berlin';
const STARTED = Date.parse('2026-08-17T13:00:00Z');
/* An hour's Bottle Life, so the last ten minutes begin at 13:50. */
const target: Target = {
	id: 't1',
	household_id: 'h1',
	baby_id: 'b1',
	activity: 'bottle',
	duration_s: 3600,
	anchor: 'bottle_start',
	deleted_at: null
};

function bottle(id: string, occurred_at = STARTED): Entry {
	return {
		id,
		household_id: 'h1',
		baby_id: 'b1',
		type: 'bottle_feed',
		occurred_at,
		ended_at: null,
		recording_zone: BERLIN,
		note: null,
		payload: { contents: 'formula', volume_ml: 120, leftover_ml: null },
		logged_by: 'mum',
		logged_at: occurred_at,
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null
	} as Entry;
}

/** The tick's own work, which is private to the app and called here directly:
    the alternative is a ten-second wait. */
function tick(at: number): void {
	app.now = at;
	(app as unknown as { checkBottleChime(): void }).checkBottleChime();
}

describe('the Bottle Chime', () => {
	beforeEach(() => {
		localStorage.clear();
		app.targets = [target];
		/* The app is one object for the whole session, so what it remembers about
		   already-chimed bottles outlives a test. A tick with the setting off is
		   what clears it — which is the behaviour a Device gets too. */
		app.entries = [];
		tick(STARTED);
		app.entries = [bottle('f1')];
		played.mockClear();
	});

	it('stays silent on a Device that has not asked for it', () => {
		tick(Date.parse('2026-08-17T13:55:00Z'));
		expect(played).not.toHaveBeenCalled();
	});

	it('sounds once the last ten minutes have begun', () => {
		setBottleChime(true);
		tick(Date.parse('2026-08-17T13:49:00Z'));
		expect(played).not.toHaveBeenCalled();
		tick(Date.parse('2026-08-17T13:51:00Z'));
		expect(played).toHaveBeenCalledTimes(1);
	});

	it('sounds once per bottle, however many ticks fall inside those ten minutes', () => {
		setBottleChime(true);
		tick(Date.parse('2026-08-17T13:51:00Z'));
		tick(Date.parse('2026-08-17T13:52:00Z'));
		tick(Date.parse('2026-08-17T13:55:00Z'));
		expect(played).toHaveBeenCalledTimes(1);
	});

	it('sounds again for the next bottle', () => {
		setBottleChime(true);
		tick(Date.parse('2026-08-17T13:51:00Z'));
		app.entries = [bottle('f2', Date.parse('2026-08-17T14:00:00Z'))];
		tick(Date.parse('2026-08-17T14:51:00Z'));
		expect(played).toHaveBeenCalledTimes(2);
	});

	it('is silenced by the very next tick when the setting goes off', () => {
		setBottleChime(true);
		tick(Date.parse('2026-08-17T13:51:00Z'));
		setBottleChime(false);
		app.entries = [bottle('f2', Date.parse('2026-08-17T14:00:00Z'))];
		tick(Date.parse('2026-08-17T14:51:00Z'));
		expect(played).toHaveBeenCalledTimes(1);
	});

	it('says nothing about a bottle whose Feed has already been stopped', () => {
		setBottleChime(true);
		app.entries = [{ ...bottle('f1'), ended_at: STARTED + 300_000 }];
		tick(Date.parse('2026-08-17T13:55:00Z'));
		expect(played).not.toHaveBeenCalled();
	});
});
