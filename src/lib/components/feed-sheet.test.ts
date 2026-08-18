/* The feed sheet's bottle behavior: the Device-set opening state (issue 21)
   and the Intake field with its presets and leftover affordance (issue 22,
   ADR-0018). Mounted like the other component tests; interactions are real
   clicks and change events, and the save path writes through a real replica. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { app } from '$client/state.svelte';
import { ReplicaDb } from '$client/db';
import type { Writer } from '$client/mutate';
import type { Baby, BottleFeedPayload, Household, MemberRecord } from '$domain/types';
import FeedSheet from './FeedSheet.svelte';

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

let host: HTMLElement;
let mounted: Record<string, unknown> | null = null;

function open(): void {
	mounted = mount(FeedSheet, {
		target: host,
		props: { asleep: false, onclose: () => {} }
	}) as Record<string, unknown>;
	flushSync();
}

function tab(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
		(b) => b.textContent?.trim() === label
	);
	if (!found) throw new Error(`no tab labelled ${label}`);
	return found;
}

function fieldInput(labelText: string): HTMLInputElement {
	const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(labelText));
	const input = label?.querySelector('input');
	if (!input) throw new Error(`no field labelled ${labelText}`);
	return input;
}

function presets(): HTMLButtonElement[] {
	return [...host.querySelectorAll<HTMLButtonElement>('.amounts button')];
}

function tapPreset(startsWith: string): void {
	const button = presets().find((b) => (b.textContent?.trim() ?? '').startsWith(startsWith));
	if (!button) throw new Error(`no preset starting with ${startsWith}`);
	button.click();
	flushSync();
}

function confirmLeftover(value: string): void {
	const input = fieldInput('Left in the bottle');
	input.value = value;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
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
});

afterEach(() => {
	if (mounted) unmount(mounted as never, { outro: false });
	mounted = null;
	host.remove();
});

describe('how the feed sheet opens', () => {
	it('opens on Breast with breast-milk contents when nothing is stored — exactly the old behavior', () => {
		open();
		expect(tab('Breast').getAttribute('aria-selected')).toBe('true');
		tab('Bottle').click();
		flushSync();
		expect(tab('Breast milk').getAttribute('aria-selected')).toBe('true');
		expect(tab('Formula').getAttribute('aria-selected')).toBe('false');
	});

	it('opens on Bottle with Formula preselected when the Device Setting says so', () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_formula');
		open();
		expect(tab('Bottle').getAttribute('aria-selected')).toBe('true');
		expect(tab('Formula').getAttribute('aria-selected')).toBe('true');
	});

	it('opens on Bottle with Breast milk for the third state', () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_breast_milk');
		open();
		expect(tab('Bottle').getAttribute('aria-selected')).toBe('true');
		expect(tab('Breast milk').getAttribute('aria-selected')).toBe('true');
	});

	it('treats a different choice in the sheet as session-local — the stored default is untouched', () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_formula');
		open();
		tab('Breast milk').click();
		flushSync();
		expect(tab('Breast milk').getAttribute('aria-selected')).toBe('true');
		expect(localStorage.getItem('blb.feedingDefault')).toBe('bottle_formula');
	});

	it('renders contents as a two-button row, with no select left in the sheet', () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_breast_milk');
		open();
		expect(host.querySelector('select')).toBeNull();
		// Other stays a domain value for old entries, but is not offered here.
		expect([...host.querySelectorAll('[role="tab"]')].map((b) => b.textContent?.trim())).not.toContain('Other');
	});
});

describe('the Intake field and its presets (ADR-0018)', () => {
	it('speaks water measures under formula, and tapping one writes the final volume', () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_formula');
		open();
		expect(presets().map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'60 → 70',
			'90 → 100',
			'120 → 135',
			'150 → 170',
			'180 → 200',
			'210 → 235',
			'240 → 270',
			'270 → 305'
		]);
		tapPreset('150');
		expect(fieldInput('Intake').value).toBe('170');
	});

	it('keeps the plain list under breast milk — what is poured is what is drinkable', () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_breast_milk');
		open();
		tapPreset('150');
		expect(fieldInput('Intake').value).toBe('150');
	});

	it('subtracts a confirmed leftover from the Intake once, clears itself, and clamps at zero', () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_formula');
		open();
		tapPreset('150');
		confirmLeftover('40');
		expect(fieldInput('Intake').value).toBe('130');
		expect(fieldInput('Left in the bottle').value).toBe('');
		confirmLeftover('10');
		expect(fieldInput('Intake').value).toBe('120');
		confirmLeftover('500');
		expect(fieldInput('Intake').value).toBe('0');
	});
});

describe('what a save writes', () => {
	let db: ReplicaDb;
	let names = 0;

	beforeEach(async () => {
		names += 1;
		db = new ReplicaDb(`feed-sheet-test-${names}`);
		const writer: Writer = {
			db,
			householdId: 'h1',
			memberId: 'mum',
			mergeAt: () => NOW,
			now: () => NOW,
			kick: () => {}
		};
		app.log = (async (action: (w: Writer) => Promise<unknown>) => action(writer)) as typeof app.log;
	});

	afterEach(async () => {
		delete (app as unknown as Record<string, unknown>).log;
		await db.delete();
	});

	it('stores the untouched default as a formula bottle with the field value and no leftover', async () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_formula');
		open();
		tapPreset('150');
		host.querySelector<HTMLButtonElement>('[data-primary="1"]')?.click();
		await new Promise((resolve) => setTimeout(resolve, 20));
		const rows = await db.entries.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('bottle_feed');
		expect(rows[0].payload as BottleFeedPayload).toEqual({
			volume_ml: 170,
			leftover_ml: null,
			contents: 'formula'
		});
	});
});
