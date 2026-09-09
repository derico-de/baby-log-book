import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import { MAX_BATCH, pull, push, SKEW_TOLERANCE_MS, SyncError } from './sync';
import { getEntry, getHousehold, listMembers, liveSessions, revisionsOf } from './store';
import type { PendingRevision, Role } from '$domain/types';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T20:00:00Z');

let db: Db;
let seq = 0;

function setup() {
	const fresh = openDb(':memory:');
	runMigrations(fresh);
	fresh
		.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)')
		.run('h1', 'Zuhause', '05:00', BERLIN, NOW);
	fresh
		.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)')
		.run('mum', 'h1', 'Mama', 'parent');
	fresh
		.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)')
		.run('oma', 'h1', 'Oma', 'caregiver');
	fresh.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)').run(
		'b1',
		'h1',
		'Lina',
		'2026-02-17'
	);
	return fresh;
}

beforeEach(() => {
	db = setup();
	seq = 0;
});

function rev(p: Partial<PendingRevision> & { entity_id: string; fields: Record<string, unknown> }) {
	seq += 1;
	return {
		...p,
		id: p.id ?? `r${seq}`,
		kind: p.kind ?? 'entry',
		merge_at: p.merge_at ?? NOW,
		device_id: p.device_id ?? 'phone-a'
	};
}

function asMember(revisions: unknown[], role: Role = 'parent', memberId = 'mum', deviceId = 'phone-a', now = NOW) {
	return push(db, { householdId: 'h1', memberId, role, deviceId, revisions, now });
}

const creation = (id: string, at: number, extra: Record<string, unknown> = {}) =>
	rev({
		entity_id: id,
		fields: {
			baby_id: 'b1',
			type: 'sleep',
			occurred_at: at,
			ended_at: null,
			recording_zone: BERLIN,
			...extra
		}
	});

describe('push', () => {
	it('returns a new cursor and the server s own time', () => {
		const result = asMember([creation('e1', NOW - 3600_000)]);
		expect(result.accepted).toHaveLength(1);
		expect(result.cursor).toBeGreaterThan(0);
		expect(result.serverTime).toBe(NOW);
	});

	it('is idempotent on replay, by construction', () => {
		const batch = [creation('e1', NOW - 3600_000)];
		const first = asMember(batch);
		const second = asMember(batch);
		expect(second.accepted).toEqual(first.accepted);
		expect(second.cursor).toBe(first.cursor);
		expect(revisionsOf(db, 'h1', 'entry', 'e1')).toHaveLength(1);
	});

	it('materialises the fold, so the row reads what the log says', () => {
		asMember([
			rev({
				entity_id: 'e1',
				fields: {
					baby_id: 'b1',
					type: 'bottle_feed',
					/* Recent enough that the Bottle Life has not run out — a bottle past
					   its Life would append its own revision here (ADR-0017). */
					occurred_at: NOW - 600_000,
					recording_zone: BERLIN,
					volume_ml: 120
				}
			})
		]);
		asMember([rev({ entity_id: 'e1', fields: { volume_ml: 150 } })], 'caregiver', 'oma', 'phone-b');
		const entry = getEntry(db, 'h1', 'e1');
		expect(entry?.payload).toEqual({ volume_ml: 150, leftover_ml: null, contents: null });
		expect(entry?.logged_by).toBe('mum');
		expect(entry?.edited_by).toBe('oma');
	});

	it('attributes the revision to the session, not to whatever the client claimed', () => {
		asMember([{ ...creation('e1', NOW), author_id: 'someone-else' }], 'caregiver', 'oma');
		expect(revisionsOf(db, 'h1', 'entry', 'e1')[0].author_id).toBe('oma');
	});

	it('clamps a merge key from the future and flags it, never rejects it', () => {
		// Refusing to record a night feed is worse than recording it slightly late.
		const far = NOW + SKEW_TOLERANCE_MS + 60_000;
		asMember([rev({ entity_id: 'e1', merge_at: far, fields: { baby_id: 'b1', type: 'sleep', occurred_at: NOW, recording_zone: BERLIN } })]);
		const [revision] = revisionsOf(db, 'h1', 'entry', 'e1');
		expect(revision.merge_at).toBe(NOW);
		expect(revision.skewed).toBe(true);
	});

	it('leaves a merge key from the past exactly as it is', () => {
		// A phone offline for three days is not skew.
		const old = NOW - 3 * 86_400_000;
		asMember([rev({ entity_id: 'e1', merge_at: old, fields: { baby_id: 'b1', type: 'sleep', occurred_at: old, recording_zone: BERLIN } })]);
		expect(revisionsOf(db, 'h1', 'entry', 'e1')[0].merge_at).toBe(old);
	});

	it('drops a malformed revision without failing the batch', () => {
		const result = asMember([{ id: 'bad' }, creation('e1', NOW)]);
		expect(result.rejected.map((r) => r.id)).toEqual(['bad']);
		expect(result.accepted).toEqual(['r1']);
	});

	it('drops a revision whose payload is the wrong shape', () => {
		const result = asMember([rev({ entity_id: 'e1', fields: { volume_ml: 'lots' } })]);
		expect(result.accepted).toEqual([]);
		expect(result.rejected[0].reason).toMatch(/volume_ml/);
	});

	it('refuses a batch bigger than the protocol allows', () => {
		const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => creation(`e${i}`, NOW));
		expect(() => asMember(many)).toThrow(SyncError);
	});

	it('refuses to apply anything from a client on another protocol version', () => {
		// The outbox is never discarded; the client keeps these and retries after
		// the update lands.
		expect(() =>
			push(db, {
				householdId: 'h1',
				memberId: 'mum',
				role: 'parent',
				deviceId: 'phone-a',
				revisions: [creation('e1', NOW)],
				now: NOW,
				protocolVersion: 99
			})
		).toThrow(/protocol/);
		expect(getEntry(db, 'h1', 'e1')).toBeNull();
	});
});

describe('roles', () => {
	it('let a Caregiver log and correct anyone s Entry', () => {
		const result = asMember([creation('e1', NOW)], 'caregiver', 'oma', 'phone-b');
		expect(result.accepted).toHaveLength(1);
		const edit = asMember([rev({ entity_id: 'e1', fields: { note: 'took ages' } })], 'caregiver', 'oma', 'phone-b');
		expect(edit.accepted).toHaveLength(1);
	});

	it('do not let a Caregiver delete an Entry', () => {
		asMember([creation('e1', NOW)]);
		const result = asMember([rev({ entity_id: 'e1', fields: { deleted_at: NOW } })], 'caregiver', 'oma', 'phone-b');
		expect(result.accepted).toEqual([]);
		expect(result.rejected[0].reason).toMatch(/Parent/);
		expect(getEntry(db, 'h1', 'e1')?.deleted_at).toBeNull();
	});

	it('do not let a Caregiver change Household settings or Targets', () => {
		const settings = asMember([rev({ kind: 'household', entity_id: 'h1', fields: { day_start: '06:00' } })], 'caregiver', 'oma');
		expect(settings.rejected).toHaveLength(1);
		const target = asMember(
			[rev({ kind: 'target', entity_id: 't1', fields: { baby_id: 'b1', activity: 'feed', duration_s: 7200, anchor: 'feed_start' } })],
			'caregiver',
			'oma'
		);
		expect(target.rejected).toHaveLength(1);
	});

	/* The Notice offsets are the only Household fields whose *null* is a value
	   a Member chose, so the storage edge has to tell "cleared" from "not
	   mentioned" — a COALESCE would read the choice as unchanged (ADR-0031). */
	it('let a Parent state a Notice offset, clear it to never, and leave the other alone', () => {
		asMember([rev({ kind: 'household', entity_id: 'h1', fields: { feed_notice_s: 900 } })]);
		expect(getHousehold(db, 'h1')).toMatchObject({ feed_notice_s: 900, sleep_notice_s: 0 });

		asMember([
			rev({ kind: 'household', entity_id: 'h1', merge_at: NOW + 1000, fields: { feed_notice_s: null } })
		]);
		expect(getHousehold(db, 'h1')).toMatchObject({ feed_notice_s: null, sleep_notice_s: 0 });

		/* And a Revision that never mentions them leaves the choice standing. */
		asMember([
			rev({ kind: 'household', entity_id: 'h1', merge_at: NOW + 2000, fields: { day_start: '06:00' } })
		]);
		expect(getHousehold(db, 'h1')).toMatchObject({ day_start: '06:00', feed_notice_s: null });
	});

	/* The Night Period travels the same way, and its `null` is a value too:
	   *this Household keeps no Night Period* (ADR-0032). */
	it('let a Parent state a Night Start and clear it again', () => {
		expect(getHousehold(db, 'h1')).toMatchObject({ night_start: null });

		asMember([rev({ kind: 'household', entity_id: 'h1', fields: { night_start: '21:00' } })]);
		expect(getHousehold(db, 'h1')).toMatchObject({ night_start: '21:00' });

		asMember([
			rev({ kind: 'household', entity_id: 'h1', merge_at: NOW + 1000, fields: { day_start: '07:00' } })
		]);
		expect(getHousehold(db, 'h1')).toMatchObject({ day_start: '07:00', night_start: '21:00' });

		asMember([
			rev({ kind: 'household', entity_id: 'h1', merge_at: NOW + 2000, fields: { night_start: null } })
		]);
		expect(getHousehold(db, 'h1')).toMatchObject({ night_start: null });
	});

	/* Caregiving is never null, so COALESCE can carry it — but `false` must
	   survive the trip: a false read as "unchanged" would make the switch
	   impossible to turn off. */
	it('let a Parent switch Caregiving off, and a revision about something else leaves it off', () => {
		expect(getHousehold(db, 'h1')).toMatchObject({ caregiving: true });

		asMember([rev({ kind: 'household', entity_id: 'h1', fields: { caregiving: false } })]);
		expect(getHousehold(db, 'h1')).toMatchObject({ caregiving: false });

		asMember([
			rev({ kind: 'household', entity_id: 'h1', merge_at: NOW + 1000, fields: { day_start: '06:00' } })
		]);
		expect(getHousehold(db, 'h1')).toMatchObject({ day_start: '06:00', caregiving: false });

		asMember([
			rev({ kind: 'household', entity_id: 'h1', merge_at: NOW + 2000, fields: { caregiving: true } })
		]);
		expect(getHousehold(db, 'h1')).toMatchObject({ caregiving: true });
	});

	it('reject a Caregiving value that is not a boolean', () => {
		const result = asMember([
			rev({ kind: 'household', entity_id: 'h1', fields: { caregiving: 'no' } })
		]);
		expect(result.rejected).toHaveLength(1);
		expect(getHousehold(db, 'h1')).toMatchObject({ caregiving: true });
	});

	it('let a Caregiver add a Food, because logging a Meal grows the catalogue', () => {
		const result = asMember([rev({ kind: 'food', entity_id: 'f1', fields: { name: 'Brokkoli' } })], 'caregiver', 'oma');
		expect(result.accepted).toHaveLength(1);
	});

	it('keep the last Parent: neither demoted nor removed', () => {
		const demote = asMember([rev({ kind: 'member', entity_id: 'mum', fields: { role: 'caregiver' } })]);
		expect(demote.rejected[0].reason).toMatch(/last Parent/);
		const remove = asMember([rev({ kind: 'member', entity_id: 'mum', fields: { removed_at: NOW } })]);
		expect(remove.rejected[0].reason).toMatch(/last Parent/);
		expect(listMembers(db, 'h1').find((m) => m.id === 'mum')).toMatchObject({ role: 'parent', removed_at: null });
	});

	it('allow demoting a Parent while another Parent remains', () => {
		asMember([rev({ kind: 'member', entity_id: 'oma', fields: { role: 'parent', display_name: 'Oma' } })]);
		const demote = asMember([rev({ kind: 'member', entity_id: 'mum', fields: { role: 'caregiver' } })]);
		expect(demote.accepted).toHaveLength(1);
	});
});

describe('the Session Merge', () => {
	it('keeps both bottles of a combined feed', () => {
		// Pumped breast milk, then formula, both still open because the sheet's
		// Save button does not end a Feed. Before ADR-0014 the second one came
		// back tombstoned and its millilitres left the day's volume.
		const bottle = (id: string, at: number, contents: string, ml: number) =>
			rev({
				entity_id: id,
				fields: {
					baby_id: 'b1',
					type: 'bottle_feed',
					occurred_at: at,
					ended_at: null,
					recording_zone: BERLIN,
					volume_ml: ml,
					contents
				}
			});
		asMember([bottle('f1', NOW - 1800_000, 'breast_milk', 60)]);
		const result = asMember([bottle('f2', NOW - 600_000, 'formula', 120)]);
		expect(result.merged).toEqual([]);
		expect(getEntry(db, 'h1', 'f2')).toMatchObject({ deleted_at: null, merged_into: null });
		expect(getEntry(db, 'h1', 'f1')).toMatchObject({ deleted_at: null, merged_into: null });
	});

	it('reconciles two open Sleeps and keeps the earlier start', () => {
		asMember([creation('s-early', NOW - 7200_000)], 'parent', 'mum', 'phone-a');
		const result = asMember([creation('s-late', NOW - 3600_000)], 'caregiver', 'oma', 'phone-b');
		expect(result.merged).toEqual([{ survivor_id: 's-early', loser_id: 's-late' }]);
		expect(getEntry(db, 'h1', 's-late')).toMatchObject({ merged_into: 's-early' });
		expect(getEntry(db, 'h1', 's-early')).toMatchObject({ merged_into: null, deleted_at: null });
	});

	it('attributes the merge to the app rather than to a Member', () => {
		asMember([creation('s1', NOW - 7200_000)]);
		asMember([creation('s2', NOW - 3600_000)], 'caregiver', 'oma', 'phone-b');
		const [, merge] = revisionsOf(db, 'h1', 'entry', 's2');
		expect(merge.author_id).toBeNull();
		expect(merge.device_id).toBe('server');
	});

	it('keeps a tombstoned loser s payload, so nothing is lost', () => {
		asMember([creation('s1', NOW - 7200_000)]);
		asMember([creation('s2', NOW - 3600_000, { note: 'started on the sofa' })], 'caregiver', 'oma', 'phone-b');
		expect(getEntry(db, 'h1', 's2')?.note).toBe('started on the sofa');
	});

	it('lands a late stop from the losing Device on the survivor', () => {
		asMember([creation('s1', NOW - 7200_000)]);
		asMember([creation('s2', NOW - 3600_000)], 'caregiver', 'oma', 'phone-b');
		const stop = asMember([rev({ entity_id: 's2', fields: { ended_at: NOW } })], 'caregiver', 'oma', 'phone-b');
		expect(stop.accepted).toHaveLength(1);
		expect(getEntry(db, 'h1', 's1')?.ended_at).toBe(NOW);
	});

	it('leaves an open Feed beside an open Sleep alone', () => {
		asMember([creation('s1', NOW - 7200_000)]);
		const feed = asMember([
			rev({
				entity_id: 'f1',
				fields: { baby_id: 'b1', type: 'breast_feed', occurred_at: NOW - 600_000, ended_at: null, recording_zone: BERLIN, side: 'left' }
			})
		]);
		expect(feed.merged).toEqual([]);
		expect(liveSessions(db, 'h1').map((e) => e.id).sort()).toEqual(['f1', 's1']);
	});

	it('does not merge a start and its stop pushed in the same batch', () => {
		const result = asMember([
			creation('s1', NOW - 3600_000),
			rev({ entity_id: 's1', fields: { ended_at: NOW - 1800_000 } }),
			creation('s2', NOW - 900_000)
		]);
		expect(result.merged).toEqual([]);
		expect(getEntry(db, 'h1', 's2')?.merged_into).toBeNull();
	});

	it('is idempotent: pushing again merges nothing further', () => {
		asMember([creation('s1', NOW - 7200_000)]);
		asMember([creation('s2', NOW - 3600_000)], 'caregiver', 'oma', 'phone-b');
		const again = asMember([rev({ entity_id: 's1', fields: { note: 'still going' } })]);
		expect(again.merged).toEqual([]);
	});
});

describe('a past bottle (ADR-0017)', () => {
	const bottle = (id: string, at: number) =>
		rev({
			entity_id: id,
			fields: {
				baby_id: 'b1',
				type: 'bottle_feed',
				occurred_at: at,
				ended_at: null,
				recording_zone: BERLIN,
				volume_ml: 120
			}
		});

	it('ends an open bottle past its Life at the due instant, attributed to the app', () => {
		asMember([bottle('f1', NOW - 2 * 3600_000)]);
		// The seeded hour: due one hour after the start, not at push time.
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBe(NOW - 3600_000);
		const [, pastRev] = revisionsOf(db, 'h1', 'entry', 'f1');
		expect(pastRev.id).toBe('bottle-past:f1');
		expect(pastRev.author_id).toBeNull();
		expect(pastRev.device_id).toBe('server');
	});

	it('leaves a bottle open while its life still runs', () => {
		asMember([bottle('f1', NOW - 1800_000)]);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
	});

	it('measures against the hour the Household typed, not the seed', () => {
		asMember([
			rev({ kind: 'target', entity_id: 't-bottle', fields: { baby_id: 'b1', activity: 'bottle', duration_s: 3 * 3600, anchor: 'bottle_start' } })
		]);
		asMember([bottle('f1', NOW - 2 * 3600_000)]);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
	});

	it('also runs when somebody merely looks, so an idle night still converges', () => {
		asMember([bottle('f1', NOW - 1800_000)]);
		const later = NOW + 3600_000;
		const result = pull(db, 'h1', 0, later);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBe(NOW + 1800_000);
		expect(result.revisions.map((r) => r.id)).toContain('bottle-past:f1');
	});

	it('closes a bottle exactly once — a Member who reopens the Feed is not fought', () => {
		asMember([bottle('f1', NOW - 2 * 3600_000)]);
		asMember([rev({ entity_id: 'f1', fields: { ended_at: null }, merge_at: NOW + 1000 })], 'parent', 'mum', 'phone-a', NOW + 1000);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
		asMember([], 'parent', 'mum', 'phone-a', NOW + 2000);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
	});

	it('yields to a Member who states the real end afterwards', () => {
		asMember([bottle('f1', NOW - 2 * 3600_000)]);
		asMember([rev({ entity_id: 'f1', fields: { ended_at: NOW - 5400_000 }, merge_at: NOW + 1000 })], 'parent', 'mum', 'phone-a', NOW + 1000);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBe(NOW - 5400_000);
	});
});

describe('pull', () => {
	/* Nappies rather than Sleeps, so the feed carries only what was pushed —
	   two open Sleeps would legitimately add a merge revision. */
	const nappy = (id: string, at: number) =>
		rev({
			entity_id: id,
			fields: {
				baby_id: 'b1',
				type: 'nappy',
				occurred_at: at,
				recording_zone: BERLIN,
				pee: true,
				poop: false
			}
		});

	it('is the ordinary paged feed from a cursor, with no bootstrap path', () => {
		asMember([nappy('e1', NOW - 7200_000)]);
		asMember([nappy('e2', NOW - 3600_000)]);
		const first = pull(db, 'h1', 0, NOW, 1);
		expect(first.revisions).toHaveLength(1);
		expect(first.more).toBe(true);
		const second = pull(db, 'h1', first.cursor, NOW, 1);
		expect(second.revisions[0].entity_id).toBe('e2');
		expect(second.more).toBe(false);
	});

	it('returns the whole log from cursor 0 — initial sync is not special', () => {
		asMember([nappy('e1', NOW - 7200_000), nappy('e2', NOW - 3600_000)]);
		expect(pull(db, 'h1', 0, NOW).revisions).toHaveLength(2);
	});

	it('hands back the merge revision the app authored', () => {
		asMember([creation('s1', NOW - 7200_000)]);
		asMember([creation('s2', NOW - 3600_000)], 'caregiver', 'oma', 'phone-b');
		const merge = pull(db, 'h1', 0, NOW).revisions.find((r) => r.author_id === null);
		expect(merge?.fields).toMatchObject({ merged_into: 's1' });
	});

	it('never leaks another Household s log', () => {
		db.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)').run(
			'h2',
			'Andere',
			'05:00',
			BERLIN,
			NOW
		);
		asMember([creation('e1', NOW)]);
		expect(pull(db, 'h2', 0, NOW).revisions).toEqual([]);
	});
});

describe('the undo window', () => {
	it('lets a Caregiver take back the nappy they just logged', () => {
		// The fan has no confirm step because undo covers the mistake, and every
		// Member logs nappies (spec §8.5).
		const nappy = rev({
			entity_id: 'n1',
			fields: { baby_id: 'b1', type: 'nappy', occurred_at: NOW, recording_zone: BERLIN, pee: true, poop: false }
		});
		asMember([nappy], 'caregiver', 'oma', 'phone-b');
		const undo = asMember([rev({ entity_id: 'n1', fields: { deleted_at: NOW } })], 'caregiver', 'oma', 'phone-b');
		expect(undo.accepted).toHaveLength(1);
		expect(getEntry(db, 'h1', 'n1')?.deleted_at).toBe(NOW);
	});

	it('does not let a Caregiver delete it an hour later', () => {
		const nappy = rev({
			entity_id: 'n1',
			fields: { baby_id: 'b1', type: 'nappy', occurred_at: NOW, recording_zone: BERLIN, pee: true, poop: false }
		});
		asMember([nappy], 'caregiver', 'oma', 'phone-b');
		const later = push(db, {
			householdId: 'h1',
			memberId: 'oma',
			role: 'caregiver',
			deviceId: 'phone-b',
			revisions: [rev({ entity_id: 'n1', fields: { deleted_at: NOW } })],
			now: NOW + 3600_000
		});
		expect(later.rejected[0].reason).toMatch(/Parent/);
	});

	it('does not let a Caregiver take back somebody else s row', () => {
		asMember([creation('s1', NOW)]);
		const undo = asMember([rev({ entity_id: 's1', fields: { deleted_at: NOW } })], 'caregiver', 'oma', 'phone-b');
		expect(undo.rejected[0].reason).toMatch(/Parent/);
	});
});

describe('a new feeding ends the running Feed (ADR-0019)', () => {
	/* Breast feeds throughout: a bottle would also be closed by its Bottle Life,
	   which is a different rule with its own tests above. */
	const breast = (id: string, at: number, extra: Record<string, unknown> = {}) =>
		rev({
			entity_id: id,
			fields: {
				baby_id: 'b1',
				type: 'breast_feed',
				occurred_at: at,
				ended_at: null,
				recording_zone: BERLIN,
				side: 'both',
				...extra
			}
		});
	const bottle = (id: string, at: number) =>
		rev({
			entity_id: id,
			fields: {
				baby_id: 'b1',
				type: 'bottle_feed',
				occurred_at: at,
				ended_at: null,
				recording_zone: BERLIN,
				volume_ml: 120
			}
		});

	it('ends it at the new feeding s Occurred At, attributed to the Member who logged it', () => {
		asMember([breast('f1', NOW - 1800_000)]);
		asMember([bottle('f2', NOW - 600_000)], 'caregiver', 'oma');

		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBe(NOW - 600_000);
		const [, endRev] = revisionsOf(db, 'h1', 'entry', 'f1');
		expect(endRev.id).toBe('feed-end:f1');
		expect(endRev.author_id).toBe('oma');
		expect(endRev.device_id).toBe('server');
	});

	it('leaves the new feeding running — it is an end, not a merge', () => {
		asMember([breast('f1', NOW - 1800_000)]);
		asMember([bottle('f2', NOW - 600_000)]);
		expect(getEntry(db, 'h1', 'f2')?.ended_at).toBeNull();
	});

	it('keeps both rows and their millilitres — ADR-0014 stands', () => {
		asMember([bottle('f1', NOW - 1800_000)]);
		asMember([bottle('f2', NOW - 600_000)]);
		for (const id of ['f1', 'f2']) {
			const entry = getEntry(db, 'h1', id);
			expect(entry?.deleted_at).toBeNull();
			expect(entry?.merged_into).toBeNull();
			expect((entry?.payload as { volume_ml: number }).volume_ml).toBe(120);
		}
	});

	it('leaves the running Feed alone when the new feeding predates it', () => {
		asMember([breast('f2', NOW - 600_000)]);
		asMember([breast('f1', NOW - 5400_000, { ended_at: NOW - 5000_000 })]);
		expect(getEntry(db, 'h1', 'f2')?.ended_at).toBeNull();
	});

	it('a Meal ends it too — a feeding is a Feed or a Meal', () => {
		asMember([breast('f1', NOW - 1800_000)]);
		asMember([
			rev({
				entity_id: 'm1',
				fields: {
					baby_id: 'b1',
					type: 'meal',
					occurred_at: NOW - 600_000,
					recording_zone: BERLIN,
					foods: []
				}
			})
		]);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBe(NOW - 600_000);
	});

	it('leaves a sibling s Feed alone', () => {
		db.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)').run(
			'b2',
			'h1',
			'Jonas',
			'2026-02-17'
		);
		asMember([breast('f1', NOW - 1800_000)]);
		asMember([rev({ entity_id: 'f2', fields: { baby_id: 'b2', type: 'breast_feed', occurred_at: NOW - 600_000, ended_at: null, recording_zone: BERLIN, side: 'both' } })]);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
	});

	it('a Sleep is not a feeding', () => {
		asMember([breast('f1', NOW - 1800_000)]);
		asMember([creation('s1', NOW - 600_000)]);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
	});

	/* The hole this ticket exists to close: the client-side guard never covered
	   two writers, and both halves of ADR-0014 and ADR-0019 have to hold. */
	it('the offline second Device: both rows survive, each carrying the end it had', () => {
		asMember([breast('f1', NOW - 1800_000)], 'parent', 'mum', 'phone-a');
		asMember([bottle('f2', NOW - 1500_000)], 'caregiver', 'oma', 'phone-b');

		const first = getEntry(db, 'h1', 'f1');
		const second = getEntry(db, 'h1', 'f2');
		expect(first?.ended_at).toBe(NOW - 1500_000);
		expect(second?.ended_at).toBeNull();
		expect(first?.deleted_at).toBeNull();
		expect(second?.deleted_at).toBeNull();
		expect(first?.merged_into).toBeNull();
		expect(second?.merged_into).toBeNull();
	});

	it('converges the same way whichever Device pushes first', () => {
		asMember([bottle('f2', NOW - 1500_000)], 'caregiver', 'oma', 'phone-b');
		asMember([breast('f1', NOW - 1800_000)], 'parent', 'mum', 'phone-a');
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBe(NOW - 1500_000);
		expect(getEntry(db, 'h1', 'f2')?.ended_at).toBeNull();
	});

	it('closes a Feed exactly once — a Member who reopens it is not fought', () => {
		asMember([breast('f1', NOW - 1800_000)]);
		asMember([bottle('f2', NOW - 600_000)]);
		asMember([rev({ entity_id: 'f1', fields: { ended_at: null }, merge_at: NOW + 1000 })], 'parent', 'mum', 'phone-a', NOW + 1000);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
		asMember([], 'parent', 'mum', 'phone-a', NOW + 2000);
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBeNull();
	});

	it('is idempotent — a replayed batch adds no second end', () => {
		asMember([breast('f1', NOW - 1800_000)]);
		const batch = [bottle('f2', NOW - 600_000)];
		asMember(batch);
		const before = revisionsOf(db, 'h1', 'entry', 'f1').length;
		asMember(batch);
		expect(revisionsOf(db, 'h1', 'entry', 'f1')).toHaveLength(before);
	});

	it('refuses a client that mints the server s own id', () => {
		const result = asMember([
			rev({ id: 'feed-end:f1', entity_id: 'f1', fields: { ended_at: NOW } })
		]);
		expect(result.rejected[0].reason).toBe('only the app may mint that revision id');
	});

	it('yields to the Bottle Life, which ends the Feed earlier and truer', () => {
		asMember([bottle('f1', NOW - 2 * 3600_000)]);
		asMember([breast('f2', NOW - 600_000)]);
		// The bottle's hour ran out long before the next feeding began.
		expect(getEntry(db, 'h1', 'f1')?.ended_at).toBe(NOW - 3600_000);
	});
});
