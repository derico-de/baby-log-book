/* Stopping a bottle with what came back in it (ADR-0018): the leftover is
   subtracted from the Intake and never stored, and the end and the corrected
   Intake land as one revision. Written through a real replica, like the other
   client tests. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReplicaDb } from './db';
import { endBottleFeed, logBottleFeed, type Writer } from './mutate';
import type { BottleFeedPayload } from '$domain/types';

const NOW = Date.parse('2026-08-17T20:00:00Z');

let db: ReplicaDb;
let names = 0;
let lastMergeAt = 0;

/* Mirrors SyncEngine.mergeAt: strictly increasing per Device, so the end wins
   over the creation it follows in the same millisecond. */
function mergeAt(): number {
	lastMergeAt = NOW > lastMergeAt ? NOW : lastMergeAt + 1;
	return lastMergeAt;
}

function writer(): Writer {
	return {
		db,
		householdId: 'h1',
		memberId: 'mum',
		mergeAt,
		now: () => NOW,
		kick: () => {}
	};
}

async function runningBottle(volumeMl: number | null): Promise<string> {
	return logBottleFeed(writer(), { babyId: 'b1', volumeMl, contents: 'formula' });
}

async function payloadOf(id: string): Promise<BottleFeedPayload> {
	return (await db.entries.get(id))?.payload as BottleFeedPayload;
}

beforeEach(async () => {
	names += 1;
	lastMergeAt = 0;
	db = new ReplicaDb(`end-bottle-test-${names}`);
	await db.open();
});

afterEach(async () => {
	await db.delete();
});

describe('ending a bottle Feed', () => {
	it('takes what came back off the Intake and ends the Feed in one revision', async () => {
		const id = await runningBottle(170);
		await endBottleFeed(writer(), { id, payload: await payloadOf(id) }, NOW + 900_000, 40);
		expect(await payloadOf(id)).toEqual({ volume_ml: 130, leftover_ml: null, contents: 'formula' });
		expect((await db.entries.get(id))?.ended_at).toBe(NOW + 900_000);
		/* The creation and this one: "she's done, this much came back" is one
		   statement and reads as one line of history. */
		expect(await db.revisions.where({ kind: 'entry', entity_id: id }).count()).toBe(2);
	});

	it('writes the end alone when she finished it — an untouched Intake is the statement', async () => {
		const id = await runningBottle(170);
		await endBottleFeed(writer(), { id, payload: await payloadOf(id) }, NOW + 900_000, 0);
		expect((await payloadOf(id)).volume_ml).toBe(170);
		expect((await db.entries.get(id))?.ended_at).toBe(NOW + 900_000);
	});

	it('writes the end alone when nobody said', async () => {
		const id = await runningBottle(170);
		await endBottleFeed(writer(), { id, payload: await payloadOf(id) }, NOW + 900_000, null);
		expect((await payloadOf(id)).volume_ml).toBe(170);
	});

	it('has nothing to subtract from when no amount was ever stated', async () => {
		const id = await runningBottle(null);
		await endBottleFeed(writer(), { id, payload: await payloadOf(id) }, NOW + 900_000, 40);
		expect((await payloadOf(id)).volume_ml).toBeNull();
		expect((await db.entries.get(id))?.ended_at).toBe(NOW + 900_000);
	});

	it('clamps at zero rather than validating — never a negative feed', async () => {
		const id = await runningBottle(100);
		await endBottleFeed(writer(), { id, payload: await payloadOf(id) }, NOW + 900_000, 150);
		expect((await payloadOf(id)).volume_ml).toBe(0);
	});

	it('converts a legacy row: the new Intake is the whole statement, so its leftover is nulled', async () => {
		const id = await runningBottle(180);
		/* What an old client wrote: offered beside what came back. */
		const legacy: BottleFeedPayload = { volume_ml: 180, leftover_ml: 30, contents: 'formula' };
		await endBottleFeed(writer(), { id, payload: legacy }, NOW + 900_000, 20);
		expect(await payloadOf(id)).toEqual({ volume_ml: 130, leftover_ml: null, contents: 'formula' });
	});
});
