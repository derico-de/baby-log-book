import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyLocal, applyRevisions } from './apply';
import { META, resetReplica, ReplicaDb, setMeta, wipeEverything } from './db';
import { deleteEntry, logNappy, startSleep, stopSession, undoDelete, type Writer } from './mutate';
import { SyncEngine, toWireRevision } from './sync';
import type { Revision } from '$domain/types';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T20:00:00Z');

let db: ReplicaDb;
let names = 0;
let clock = NOW;

let lastMergeAt = 0;
/* Mirrors SyncEngine.mergeAt: strictly increasing per Device, so two writes in
   the same millisecond keep the order they were made in. */
function mergeAt() {
	lastMergeAt = clock > lastMergeAt ? clock : lastMergeAt + 1;
	return lastMergeAt;
}

function writer(overrides: Partial<Writer> = {}): Writer {
	return {
		db,
		householdId: 'h1',
		memberId: 'oma',
		mergeAt,
		now: () => clock,
		kick: () => {},
		...overrides
	};
}

beforeEach(async () => {
	names += 1;
	clock = NOW;
	lastMergeAt = 0;
	db = new ReplicaDb(`test-${names}`);
	await db.open();
});

afterEach(async () => {
	await db.delete();
});

describe('a local write', () => {
	it('appears at once and waits in the outbox', async () => {
		const id = await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const entry = await db.entries.get(id);
		expect(entry).toMatchObject({ type: 'nappy', baby_id: 'b1', logged_by: 'oma' });
		expect(entry?.payload).toEqual({ pee: true, poop: false, consistency: null });
		expect(await db.outbox.count()).toBe(1);
	});

	it('carries the Recording Zone of the Device that made it', async () => {
		const id = await startSleep(writer(), { babyId: 'b1' });
		expect((await db.entries.get(id))?.recording_zone).toBeTruthy();
	});

	it('is a Live Session while it has no end, and an ordinary row after', async () => {
		const id = await startSleep(writer(), { babyId: 'b1' });
		expect((await db.entries.get(id))?.ended_at).toBeNull();
		await stopSession(writer(), id, clock + 3600_000);
		expect((await db.entries.get(id))?.ended_at).toBe(clock + 3600_000);
		/* Two revisions for one row, and the row is the fold of them. */
		expect(await db.revisions.where({ kind: 'entry', entity_id: id }).count()).toBe(2);
	});

	it('records who edited it, so the row can say so', async () => {
		const id = await startSleep(writer(), { babyId: 'b1' });
		clock += 60_000;
		await stopSession(writer({ memberId: 'mum' }), id, clock);
		expect(await db.entries.get(id)).toMatchObject({ logged_by: 'oma', edited_by: 'mum' });
	});

	it('is undoable, and the tombstone keeps the payload', async () => {
		const id = await logNappy(writer(), { babyId: 'b1', pee: true, poop: true });
		await deleteEntry(writer(), id);
		const tombstoned = await db.entries.get(id);
		expect(tombstoned?.deleted_at).not.toBeNull();
		expect(tombstoned?.payload).toMatchObject({ pee: true, poop: true });
		await undoDelete(writer(), id);
		expect((await db.entries.get(id))?.deleted_at).toBeNull();
	});
});

describe('the outbox', () => {
	it('is forward-readable: a row carries its own shape version', async () => {
		// A new client must be able to read an old client's outbox records, or the
		// only way out of an incompatible local schema is destroying Entries a
		// Member typed (ADR-0013).
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const [row] = await db.outbox.toArray();
		expect(row.v).toBe(1);
		expect(Object.keys(row).sort()).toEqual([
			'attempts',
			'author_id',
			'device_id',
			'entity_id',
			'fields',
			'id',
			'kind',
			'merge_at',
			'queued_at',
			'v'
		]);
	});

	it('goes over the wire without the fields the server assigns', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const [row] = await db.outbox.toArray();
		const wire = toWireRevision(row);
		expect(wire).not.toHaveProperty('author_id');
		expect(wire).not.toHaveProperty('seq');
		expect(wire).toMatchObject({ kind: 'entry', merge_at: NOW });
	});

	it('keeps queue order, so a Member s writes arrive in the order they made them', async () => {
		const first = await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		clock += 1000;
		const second = await startSleep(writer(), { babyId: 'b1' });
		const rows = await db.outbox.orderBy('queued_at').toArray();
		expect(rows.map((r) => r.entity_id)).toEqual([first, second]);
		expect(rows[0].queued_at).toBeLessThan(rows[1].queued_at);
	});
});

describe('the reset lever', () => {
	it('refuses while the outbox is non-empty', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		expect(await resetReplica(db)).toEqual({ ok: false, waiting: 1 });
		expect(await db.entries.count()).toBe(1);
	});

	it('drops the replica and the cursor once nothing is waiting', async () => {
		const id = await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		await db.outbox.clear();
		await setMeta(db, META.cursor, 42);
		expect(await resetReplica(db)).toEqual({ ok: true, waiting: 0 });
		expect(await db.entries.get(id)).toBeUndefined();
		expect(await db.meta.get(META.cursor)).toBeUndefined();
	});
});

describe('applying a pulled page', () => {
	const revision = (over: Partial<Revision>): Revision => ({
		id: `r-${Math.random()}`,
		household_id: 'h1',
		kind: 'entry',
		entity_id: 'e1',
		fields: {},
		merge_at: NOW,
		device_id: 'phone-a',
		author_id: 'mum',
		...over
	});

	it('materialises the fold, the same fold the server ran', async () => {
		await applyRevisions(db, 'h1', [
			revision({
				seq: 1,
				fields: {
					baby_id: 'b1',
					type: 'bottle_feed',
					occurred_at: NOW,
					recording_zone: BERLIN,
					volume_ml: 120
				}
			}),
			revision({ seq: 2, merge_at: NOW + 1000, author_id: 'oma', fields: { volume_ml: 150 } })
		]);
		const entry = await db.entries.get('e1');
		expect(entry?.payload).toEqual({ volume_ml: 150, leftover_ml: null, contents: null });
		expect(entry).toMatchObject({ logged_by: 'mum', edited_by: 'oma' });
	});

	it('is idempotent, so an overlapping pull changes nothing', async () => {
		const page = [
			revision({
				id: 'r1',
				seq: 1,
				fields: { baby_id: 'b1', type: 'sleep', occurred_at: NOW, recording_zone: BERLIN }
			})
		];
		await applyRevisions(db, 'h1', page);
		await applyRevisions(db, 'h1', page);
		expect(await db.revisions.count()).toBe(1);
		expect(await db.entries.count()).toBe(1);
	});

	it('waits for the creating revision before materialising a row', async () => {
		await applyRevisions(db, 'h1', [revision({ id: 'r-note', seq: 5, fields: { note: 'hm' } })]);
		expect(await db.entries.count()).toBe(0);
		await applyRevisions(db, 'h1', [
			revision({
				id: 'r-create',
				seq: 6,
				fields: { baby_id: 'b1', type: 'nappy', occurred_at: NOW, recording_zone: BERLIN, pee: true }
			})
		]);
		expect((await db.entries.get('e1'))?.note).toBe('hm');
	});

	it('learns the Household lens from the log rather than a side channel', async () => {
		await applyRevisions(db, 'h1', [
			revision({
				id: 'r-hh',
				seq: 1,
				kind: 'household',
				entity_id: 'h1',
				fields: { day_start: '05:00', zone: BERLIN }
			})
		]);
		expect(await db.households.get('h1')).toMatchObject({ day_start: '05:00', zone: BERLIN });
	});

	it('folds a Member, and nothing authenticating comes with it', async () => {
		await applyRevisions(db, 'h1', [
			revision({
				id: 'r-m',
				seq: 1,
				kind: 'member',
				entity_id: 'oma',
				fields: { display_name: 'Oma', role: 'caregiver', removed_at: null }
			})
		]);
		const member = await db.members.get('oma');
		expect(member).toMatchObject({ display_name: 'Oma', role: 'caregiver' });
		expect(Object.keys(member ?? {})).not.toContain('token');
	});
});

describe('the sync engine', () => {
	function engine(responder: (url: string, init?: RequestInit) => Response) {
		return new SyncEngine({
			db,
			householdId: 'h1',
			now: () => clock,
			fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
				responder(String(input), init)) as typeof fetch
		});
	}

	const versionBlock = {
		protocol_version: 1,
		app_version: '0.0.0',
		git_sha: 'unknown',
		source: 'x',
		server_time: NOW
	};

	const ok = (body: unknown) =>
		new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

	it('pushes the outbox, then pulls, and clears what was accepted', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const [queued] = await db.outbox.toArray();
		const seen: string[] = [];
		const sync = engine((url) => {
			seen.push(url);
			if (url.startsWith('/api/sync/push')) {
				return ok({ cursor: 1, accepted: [queued.id], rejected: [], merged: [], ...versionBlock });
			}
			return ok({ revisions: [], cursor: 1, more: false, ...versionBlock });
		});
		await sync.sync();
		expect(seen[0]).toBe('/api/sync/push');
		expect(seen[1]).toContain('/api/sync/pull');
		expect(await db.outbox.count()).toBe(0);
		expect(sync.getStatus().state).toBe('idle');
	});

	it('never wipes local data on a 401, and says how many entries are waiting', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const sync = engine(() => new Response('{}', { status: 401 }));
		await sync.sync();
		expect(sync.getStatus()).toMatchObject({ state: 'signed_out', waiting: 1 });
		expect(await db.entries.count()).toBe(1);
		expect(await db.outbox.count()).toBe(1);
	});

	it('wipes on a removed response, which is deliberately not a 401', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const sync = engine(
			() =>
				new Response(JSON.stringify({ code: 'removed' }), {
					status: 403,
					headers: { 'content-type': 'application/json' }
				})
		);
		await sync.sync();
		expect(sync.getStatus().state).toBe('removed');
		expect(await db.entries.count()).toBe(0);
	});

	it('keeps the outbox on a protocol bump and stops pushing', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const sync = engine((url) => {
			if (url.startsWith('/api/sync/push')) {
				return new Response(JSON.stringify({ code: 'protocol', ...versionBlock, protocol_version: 2 }), {
					status: 409,
					headers: { 'content-type': 'application/json' }
				});
			}
			return ok({ revisions: [], cursor: 0, more: false, ...versionBlock, protocol_version: 2 });
		});
		await sync.sync();
		expect(sync.getStatus().state).toBe('client_behind');
		expect(await db.outbox.count()).toBe(1);

		/* Pulls carry on: a bump is about writes that would be wrong, not reads. */
		const urls: string[] = [];
		const again = engine((url) => {
			urls.push(url);
			return ok({ revisions: [], cursor: 0, more: false, ...versionBlock, protocol_version: 2 });
		});
		await again.load();
		await again.sync();
		expect(urls.some((u) => u.includes('/api/sync/pull'))).toBe(true);
	});

	it('tells the operator when the server is the older one', async () => {
		const sync = engine(() => ok({ revisions: [], cursor: 0, more: false, ...versionBlock, protocol_version: 0 }));
		await sync.sync();
		expect(sync.getStatus().state).toBe('client_ahead');
	});

	it('notices a new version without a second clock to poll it', async () => {
		const sync = engine(() =>
			ok({ revisions: [], cursor: 0, more: false, ...versionBlock, app_version: '9.9.9' })
		);
		await sync.sync();
		expect(sync.getStatus().updateAvailable).toBe(true);
	});

	it('corrects its clock from the server s own time', async () => {
		const sync = engine(() =>
			ok({ revisions: [], cursor: 0, more: false, ...versionBlock, server_time: NOW + 4000 })
		);
		await sync.sync();
		expect(sync.getStatus().clockOffset).toBe(4000);
		expect(sync.mergeAt()).toBe(NOW + 4000);
	});

	it('surfaces a refusal rather than dropping a write silently', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		/* The outbox is keyed by revision id; the entity id is what Undo holds. */
		const [queued] = await db.outbox.toArray();
		const id = queued.id;
		const sync = engine((url) =>
			url.startsWith('/api/sync/push')
				? ok({
						cursor: 1,
						accepted: [],
						rejected: [{ id, reason: 'only a Parent may delete an Entry' }],
						merged: [],
						...versionBlock
					})
				: ok({ revisions: [], cursor: 1, more: false, ...versionBlock })
		);
		await sync.sync();
		expect(sync.getStatus().refused).toEqual([{ id, reason: 'only a Parent may delete an Entry' }]);
		expect(await db.outbox.count()).toBe(0);
	});

	it('pages the initial sync and shows catching up while it runs', async () => {
		const states: string[] = [];
		let page = 0;
		const sync = new SyncEngine({
			db,
			householdId: 'h1',
			now: () => clock,
			onStatus: (s) => states.push(s.state),
			fetch: (async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.startsWith('/api/sync/push')) throw new Error('nothing to push');
				page += 1;
				return ok({
					revisions: [
						{
							id: `r${page}`,
							seq: page,
							household_id: 'h1',
							kind: 'entry',
							entity_id: `e${page}`,
							fields: { baby_id: 'b1', type: 'nappy', occurred_at: NOW, recording_zone: BERLIN, pee: true },
							merge_at: NOW,
							device_id: 'a',
							author_id: 'mum'
						}
					],
					cursor: page,
					more: page < 3,
					...versionBlock
				});
			}) as typeof fetch
		});
		await sync.sync();
		expect(states).toContain('catching_up');
		expect(await db.entries.count()).toBe(3);
		expect(sync.getStatus().cursor).toBe(3);
	});

	it('treats a dead network as offline and keeps everything', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		const sync = engine(() => {
			throw new Error('offline');
		});
		await sync.sync();
		expect(sync.getStatus().state).toBe('offline');
		expect(await db.outbox.count()).toBe(1);
	});
});

describe('wipeEverything', () => {
	it('takes the outbox too, which is the accepted cost of removal', async () => {
		await logNappy(writer(), { babyId: 'b1', pee: true, poop: false });
		await wipeEverything(db);
		expect(await db.outbox.count()).toBe(0);
		expect(await db.revisions.count()).toBe(0);
	});
});

describe('applyLocal', () => {
	it('writes the log, the row and the outbox together or not at all', async () => {
		await applyLocal(
			db,
			'h1',
			{
				id: 'r1',
				household_id: 'h1',
				kind: 'entry',
				entity_id: 'e1',
				fields: { baby_id: 'b1', type: 'sleep', occurred_at: NOW, recording_zone: BERLIN },
				merge_at: NOW,
				device_id: 'a',
				author_id: 'oma'
			},
			NOW
		);
		expect(await db.revisions.count()).toBe(1);
		expect(await db.entries.count()).toBe(1);
		expect(await db.outbox.count()).toBe(1);
		expect(await db.meta.get(META.loggedFirstEntry)).toMatchObject({ value: true });
	});
});
