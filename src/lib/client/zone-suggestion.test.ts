/* The Household Zone suggestion (ADR-0048): asked on arrival rather than
   after two days, kept for good once a Parent says keep, and asked again on
   the next trip after a move. Runs the app against a real replica, with only
   the Device's own zone stood in for. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const here = vi.hoisted(() => ({ zone: 'Europe/Rome' }));
vi.mock('./device', async (importOriginal) => ({
	...(await importOriginal<typeof import('./device')>()),
	deviceZone: () => here.zone,
	/* Writes to the document, which the node environment does not have. */
	mirrorDayStart: () => {}
}));

const { app } = await import('./state.svelte');
const { ReplicaDb } = await import('./db');
import type { Household } from '$domain/types';

const BUCHAREST = 'Europe/Bucharest';
const ROME = 'Europe/Rome';

const household: Household = {
	id: 'h1',
	name: 'Acasă',
	day_start: '05:00',
	zone: BUCHAREST,
	night_start: null,
	feed_notice_s: 0,
	sleep_notice_s: 0,
	caregiving: true
};

let db: InstanceType<typeof ReplicaDb>;
let names = 0;

beforeEach(async () => {
	names += 1;
	db = new ReplicaDb(`zone-suggestion-${names}`);
	await db.households.put(household);
	(app as unknown as { db: unknown }).db = db;
	app.identity = { memberId: 'mum', householdId: 'h1', role: 'parent', displayName: 'Mama' };
	app.household = household;
	app.zoneSuggestion = null;
	app.entries = [];
	here.zone = ROME;
});

afterEach(async () => {
	(app as unknown as { db: unknown }).db = null;
	await db.delete();
});

describe('the Household Zone suggestion', () => {
	it('asks the moment the Device is somewhere else, not two days later', async () => {
		await app.trackZone();
		expect(app.zoneSuggestion).toBe(ROME);
	});

	it('asks nothing while another Member still logs from the Household Zone', async () => {
		app.entries = [
			{
				id: 'e1',
				household_id: 'h1',
				baby_id: 'b1',
				type: 'nappy',
				occurred_at: Date.now() - 60_000,
				ended_at: null,
				recording_zone: BUCHAREST,
				note: null,
				payload: { pee: true, poop: false, consistency: null, where: null },
				logged_by: 'tata',
				logged_at: Date.now() - 60_000,
				edited_by: null,
				edited_at: null,
				deleted_at: null,
				merged_into: null
			}
		];
		await app.trackZone();
		expect(app.zoneSuggestion).toBeNull();
	});

	it('asks nothing while the Device is where the Household is', async () => {
		here.zone = BUCHAREST;
		await app.trackZone();
		expect(app.zoneSuggestion).toBeNull();
	});

	it('never asks again about a zone a Parent said to keep', async () => {
		await app.trackZone();
		await app.dismissZoneSuggestion();
		await app.trackZone();
		expect(app.zoneSuggestion).toBeNull();
	});

	it('moves the Household, and the trip home asks about home', async () => {
		await app.trackZone();
		await app.moveToSuggestedZone();
		expect(app.household?.zone).toBe(ROME);
		expect(app.zoneSuggestion).toBeNull();

		here.zone = BUCHAREST;
		await app.trackZone();
		expect(app.zoneSuggestion).toBe(BUCHAREST);
	});

	it('asks again on the next trip to a zone it once moved to', async () => {
		await app.trackZone();
		await app.moveToSuggestedZone();
		here.zone = BUCHAREST;
		await app.trackZone();
		await app.moveToSuggestedZone();

		here.zone = ROME;
		await app.trackZone();
		expect(app.zoneSuggestion).toBe(ROME);
	});
});
