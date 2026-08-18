import { describe, expect, it } from 'vitest';
import { compareRevisions, foldEntity, foldEntries, isTombstoned, resolveMerged } from './revisions';
import type { PendingRevision, Revision } from './types';

function rev(p: Partial<Revision> & { entity_id: string; fields: Record<string, unknown> }): Revision {
	return {
		id: p.id ?? `r-${p.entity_id}-${p.merge_at ?? 0}-${p.device_id ?? 'a'}`,
		household_id: 'h1',
		kind: 'entry',
		merge_at: 0,
		device_id: 'a',
		author_id: 'm1',
		...p
	} as Revision;
}

describe('compareRevisions', () => {
	it('orders by the merge key, not by arrival', () => {
		const late = rev({ entity_id: 'e1', fields: {}, merge_at: 1000, seq: 1 });
		const early = rev({ entity_id: 'e1', fields: {}, merge_at: 500, seq: 99 });
		expect([late, early].sort(compareRevisions).map((r) => r.merge_at)).toEqual([500, 1000]);
	});

	it('breaks ties lexicographically by device_id', () => {
		const b = rev({ entity_id: 'e1', fields: {}, merge_at: 1000, device_id: 'b' });
		const a = rev({ entity_id: 'e1', fields: {}, merge_at: 1000, device_id: 'a' });
		expect([b, a].sort(compareRevisions).map((r) => r.device_id)).toEqual(['a', 'b']);
	});
});

describe('foldEntity', () => {
	it('is last-write-wins per field, so two concurrent edits both survive', () => {
		// You fix the volume from 120 to 150 while Oma adds a Note to the same
		// Feed. Both survive (spec §5.1).
		const revisions = [
			rev({
				entity_id: 'e1',
				merge_at: 100,
				device_id: 'a',
				fields: { type: 'bottle_feed', volume_ml: 120, occurred_at: 50 }
			}),
			rev({ entity_id: 'e1', merge_at: 200, device_id: 'a', fields: { volume_ml: 150 } }),
			rev({ entity_id: 'e1', merge_at: 210, device_id: 'b', fields: { note: 'took it all' } })
		];
		expect(foldEntity(revisions)).toEqual({
			type: 'bottle_feed',
			volume_ml: 150,
			occurred_at: 50,
			note: 'took it all'
		});
	});

	it('converges regardless of arrival order', () => {
		const a = rev({ entity_id: 'e1', merge_at: 100, device_id: 'a', fields: { volume_ml: 120 } });
		const b = rev({ entity_id: 'e1', merge_at: 200, device_id: 'b', fields: { volume_ml: 150 } });
		expect(foldEntity([a, b])).toEqual(foldEntity([b, a]));
	});

	it('lets a stale client win only on fields it actually names', () => {
		// A stale client physically cannot clobber a field it has never heard
		// of, because a revision names only what it changed.
		const fresh = rev({ entity_id: 'e1', merge_at: 300, device_id: 'a', fields: { note: 'new' } });
		const stale = rev({
			entity_id: 'e1',
			merge_at: 400,
			device_id: 'b',
			fields: { volume_ml: 90 }
		});
		expect(foldEntity([fresh, stale])).toEqual({ note: 'new', volume_ml: 90 });
	});
});

describe('foldEntries', () => {
	const created = rev({
		entity_id: 'e1',
		merge_at: 1000,
		device_id: 'a',
		author_id: 'mum',
		fields: {
			baby_id: 'b1',
			type: 'bottle_feed',
			occurred_at: 900,
			ended_at: null,
			recording_zone: 'Europe/Berlin',
			volume_ml: 120
		}
	});

	it('materialises an Entry with attribution from the creating revision', () => {
		const [entry] = foldEntries([created]);
		expect(entry).toMatchObject({
			id: 'e1',
			baby_id: 'b1',
			type: 'bottle_feed',
			occurred_at: 900,
			ended_at: null,
			recording_zone: 'Europe/Berlin',
			logged_by: 'mum',
			logged_at: 1000,
			edited_by: null,
			edited_at: null,
			deleted_at: null,
			payload: { volume_ml: 120, leftover_ml: null, contents: null }
		});
	});

	it('records who edited it, so a row can read "edited by Oma"', () => {
		const edit = rev({
			entity_id: 'e1',
			merge_at: 2000,
			device_id: 'b',
			author_id: 'oma',
			fields: { volume_ml: 150 }
		});
		const [entry] = foldEntries([created, edit]);
		expect(entry.edited_by).toBe('oma');
		expect(entry.edited_at).toBe(2000);
		expect(entry.payload).toEqual({ volume_ml: 150, leftover_ml: null, contents: null });
	});

	it('keeps a tombstoned Entry, payload and all', () => {
		const del = rev({
			entity_id: 'e1',
			merge_at: 3000,
			author_id: 'mum',
			fields: { deleted_at: 3000 }
		});
		const [entry] = foldEntries([created, del]);
		expect(entry.deleted_at).toBe(3000);
		expect(entry.payload).toEqual({ volume_ml: 120, leftover_ml: null, contents: null });
		expect(isTombstoned(entry)).toBe(true);
	});

	it('drops an entity whose fold never established a type', () => {
		// A revision naming only a note, for an Entry this replica has never
		// seen the creation of, is not yet an Entry.
		const orphan = rev({ entity_id: 'e9', merge_at: 10, fields: { note: 'hm' } });
		expect(foldEntries([orphan])).toEqual([]);
	});
});

describe('resolveMerged', () => {
	it('follows merged_into transitively, so a late stop lands on the survivor', () => {
		const chain = new Map([
			['c', 'b'],
			['b', 'a']
		]);
		expect(resolveMerged('c', chain)).toBe('a');
		expect(resolveMerged('a', chain)).toBe('a');
	});

	it('stops on a cycle rather than spinning', () => {
		const cycle = new Map([
			['a', 'b'],
			['b', 'a']
		]);
		expect(['a', 'b']).toContain(resolveMerged('a', cycle));
	});
});

describe('a pending revision', () => {
	it('is the same shape as an accepted one minus the cursor', () => {
		const pending: PendingRevision = {
			id: 'r1',
			household_id: 'h1',
			kind: 'entry',
			entity_id: 'e1',
			fields: { note: 'x' },
			merge_at: 1,
			device_id: 'a',
			author_id: 'm1'
		};
		expect('seq' in pending).toBe(false);
	});
});

describe('the value a field held before a revision', () => {
	it('is the fold of everything older, which is what "was 120 ml" reads', () => {
		// ADR-0002: the UI shows "edited by Oma, was 120 ml". The old value is never
		// stored — it is recovered by folding the log up to just before the change.
		const log = [
			rev({
				entity_id: 'e1',
				merge_at: 100,
				fields: { type: 'bottle_feed', occurred_at: 50, volume_ml: 120 }
			}),
			rev({ entity_id: 'e1', merge_at: 200, device_id: 'b', fields: { volume_ml: 150 } }),
			rev({ entity_id: 'e1', merge_at: 300, device_id: 'b', fields: { volume_ml: 180 } })
		];
		const newestFirst = [...log].sort(compareRevisions).reverse();

		/* The newest revision says 180; before it, the Feed said 150. */
		expect(foldEntity(newestFirst.slice(1)).volume_ml).toBe(150);
		/* And before the one under that, 120. */
		expect(foldEntity(newestFirst.slice(2)).volume_ml).toBe(120);
		/* The creating revision has nothing older to compare with. */
		expect(newestFirst.slice(3)).toEqual([]);
	});
});
