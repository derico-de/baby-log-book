/* The entry edit sheet on a bottle row (ADR-0018): the amount it shows is the
   derived Intake, the leftover input is the subtraction affordance, and
   saving an amount change on a legacy row converts it — the new Intake plus
   an explicit null on the stored leftover. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { app } from '$client/state.svelte';
import { ReplicaDb } from '$client/db';
import type { Writer } from '$client/mutate';
import type { Baby, Entry, Household, MemberRecord, Payload } from '$domain/types';
import EntrySheet from './EntrySheet.svelte';
import { landed } from './test-wait';

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

function entryOf(type: Entry['type'], payload: Payload): Entry {
	return {
		id: 'e1',
		household_id: 'h1',
		baby_id: 'b1',
		type,
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

const bottleEntry = (payload: Payload) => entryOf('bottle_feed', payload);
const nappyEntry = (payload: Payload) => entryOf('nappy', payload);

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

/** Clicks Save and waits for the write to land — `done` names what landing
    means. Without it (the nothing-changed cases) one fixed beat has to do:
    there is no arrival to poll for when the save writes nothing. */
async function save(done?: () => boolean | Promise<boolean>): Promise<void> {
	const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
	buttons.find((b) => b.getAttribute('data-primary') === '1')?.click();
	if (done) await landed(done);
	else await new Promise((resolve) => setTimeout(resolve, 20));
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
		await save(async () => (await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).count()) > 0);
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

/* A nappy is enterable as one form (ADR-0028), so it has to be correctable in
   the same fields — a value the app can write but never fix would be the one
   exception to corrections being first-class. */
describe('a nappy row in the edit sheet', () => {
	function toggle(label: string): HTMLButtonElement {
		const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
			(b) => b.textContent?.trim() === label
		);
		if (!found) throw new Error(`no button labelled ${label}`);
		return found;
	}

	it('opens on what the nappy held', () => {
		open(nappyEntry({ pee: true, poop: false, consistency: null, where: null }));
		expect(toggle('Pee').getAttribute('aria-pressed')).toBe('true');
		expect(toggle('Poop').getAttribute('aria-pressed')).toBe('false');
		expect(host.textContent).not.toContain('Runny');
	});

	it('records a correction to what was in it, and to the consistency', async () => {
		open(nappyEntry({ pee: true, poop: false, consistency: null, where: null }));
		toggle('Poop').click();
		flushSync();
		toggle('Runny').click();
		flushSync();
		await save(async () => (await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).count()) > 0);
		const revisions = await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).toArray();
		expect(revisions).toHaveLength(1);
		expect(revisions[0].fields).toEqual({ poop: true, consistency: 'runny' });
	});

	it('leaves an old row s where unsaid rather than reading it as a nappy', async () => {
		/* Every row logged before the field existed carries null, and opening the
		   sheet must not quietly assert one (ticket 26). */
		open(nappyEntry({ pee: true, poop: false, consistency: null, where: null }));
		expect(toggle('Nappy').getAttribute('aria-pressed')).toBe('false');
		expect(toggle('Potty').getAttribute('aria-pressed')).toBe('false');
		await save();
		expect(await db.revisions.count()).toBe(0);
	});

	it('records where it landed as an ordinary correction', async () => {
		open(nappyEntry({ pee: true, poop: false, consistency: null, where: 'nappy' }));
		toggle('Potty').click();
		flushSync();
		await save(async () => (await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).count()) > 0);
		const revisions = await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).toArray();
		expect(revisions[0].fields).toEqual({ where: 'potty' });
	});

	it('takes the consistency with the poop when the poop is unticked', async () => {
		open(nappyEntry({ pee: false, poop: true, consistency: 'hard', where: null }));
		toggle('Poop').click();
		flushSync();
		toggle('Pee').click();
		flushSync();
		await save(async () => (await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).count()) > 0);
		const revisions = await db.revisions.where({ kind: 'entry', entity_id: 'e1' }).toArray();
		expect(revisions[0].fields).toEqual({ pee: true, poop: false, consistency: null });
	});
});
