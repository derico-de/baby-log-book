/* The entry edit sheet on a bottle row (ADR-0018): the amount it shows is the
   derived Intake, the leftover input is the subtraction affordance, and
   saving an amount change on a legacy row converts it — the new Intake plus
   an explicit null on the stored leftover. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { app } from '$client/state.svelte';
import { ReplicaDb } from '$client/db';
import type { Writer } from '$client/mutate';
import type { Baby, Entry, Household, MemberRecord } from '$domain/types';
import EntrySheet from './EntrySheet.svelte';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T14:00:00Z');

const household: Household = { id: 'h1', name: 'Zuhause', day_start: '05:00', zone: BERLIN };
const baby: Baby = { id: 'b1', household_id: 'h1', name: 'Lina', birth_date: '2026-02-17', deleted_at: null };
const mum: MemberRecord = {
	id: 'mum',
	household_id: 'h1',
	display_name: 'Mum',
	role: 'parent',
	removed_at: null,
	locale: 'en'
};

function bottleEntry(payload: Entry['payload']): Entry {
	return {
		id: 'e1',
		household_id: 'h1',
		baby_id: 'b1',
		type: 'bottle_feed',
		occurred_at: NOW - 3600_000,
		ended_at: null,
		recording_zone: BERLIN,
		note: null,
		payload,
		logged_by: 'mum',
		logged_at: NOW - 3600_000,
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null
	} as Entry;
}

let host: HTMLElement;
let mounted: Record<string, unknown> | null = null;
let db: ReplicaDb;
let names = 0;

function open(entry: Entry): void {
	mounted = mount(EntrySheet, { target: host, props: { entry, onclose: () => {} } }) as Record<string, unknown>;
	flushSync();
}

function fieldInput(labelText: string): HTMLInputElement {
	const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(labelText));
	const input = label?.querySelector('input');
	if (!input) throw new Error(`no field labelled ${labelText}`);
	return input;
}

async function save(): Promise<void> {
	const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
	buttons.find((b) => b.getAttribute('data-primary') === '1')?.click();
	await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
	host = document.createElement('div');
	document.body.append(host);
	localStorage.clear();
	app.household = household;
	app.babies = [baby];
	app.members = [mum];
	app.foods = [];
	app.targets = [];
	app.entries = [];
	app.now = NOW;
	app.identity = { memberId: 'mum', householdId: 'h1', role: 'parent', displayName: 'Mum' };
	app.selectedBabyId = 'b1';

	names += 1;
	db = new ReplicaDb(`entry-sheet-test-${names}`);
	const writer: Writer = {
		db,
		householdId: 'h1',
		memberId: 'mum',
		mergeAt: () => NOW,
		now: () => NOW,
		kick: () => {}
	};
	app.edit = (async (action: (w: Writer) => Promise<unknown>) => action(writer)) as typeof app.edit;
});

afterEach(async () => {
	if (mounted) unmount(mounted as never, { outro: false });
	mounted = null;
	host.remove();
	delete (app as unknown as Record<string, unknown>).edit;
	await db.delete();
});

describe('a bottle row in the edit sheet', () => {
	it('shows a legacy row s derived Intake as its amount', () => {
		open(bottleEntry({ volume_ml: 170, leftover_ml: 40, contents: 'formula' }));
		expect(fieldInput('Intake').value).toBe('130');
	});

	it('subtracts each confirmed leftover from the Intake once, clears itself, and clamps at zero', () => {
		open(bottleEntry({ volume_ml: 170, leftover_ml: null, contents: 'formula' }));
		const confirm = (value: string) => {
			const leftover = fieldInput('Left in the bottle');
			leftover.value = value;
			leftover.dispatchEvent(new Event('change', { bubbles: true }));
			flushSync();
			expect(leftover.value).toBe('');
		};
		confirm('40');
		expect(fieldInput('Intake').value).toBe('130');
		confirm('10');
		expect(fieldInput('Intake').value).toBe('120');
		confirm('500');
		expect(fieldInput('Intake').value).toBe('0');
	});

	it('converts a legacy row on an amount change: the new Intake, and the stored leftover nulled', async () => {
		open(bottleEntry({ volume_ml: 170, leftover_ml: 40, contents: 'formula' }));
		const intake = fieldInput('Intake');
		intake.value = '120';
		intake.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await save();
		const revisions = await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).toArray();
		expect(revisions).toHaveLength(1);
		expect(revisions[0].fields).toEqual({ volume_ml: 120, leftover_ml: null });
	});

	it('leaves an untouched legacy row s pair alone', async () => {
		open(bottleEntry({ volume_ml: 170, leftover_ml: 40, contents: 'formula' }));
		await save();
		expect(await db.revisions.count()).toBe(0);
	});

	it('still offers all four contents statements, so old entries stay editable', () => {
		open(bottleEntry({ volume_ml: 170, leftover_ml: null, contents: 'other' }));
		const select = host.querySelector('select');
		expect(select).not.toBeNull();
		const labels = [...(select?.querySelectorAll('option') ?? [])].map((o) => o.textContent?.trim());
		expect(labels).toEqual(['Not said', 'Breast milk', 'Formula', 'Other']);
	});
});
