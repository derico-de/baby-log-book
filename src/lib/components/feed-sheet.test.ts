/* The feed sheet's bottle behavior: the Device-set opening state (issue 21)
   and the Intake field with its presets and leftover affordance (issue 22,
   ADR-0018). Mounted like the other component tests; interactions are real
   clicks and change events, and the save path writes through a real replica. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { app } from '$client/state.svelte';
import { ReplicaDb } from '$client/db';
import { logBreastFeed, startSleep } from '$client/mutate';
import type { Writer } from '$client/mutate';
import type { Baby, BottleFeedPayload, Household, MealPayload, MemberRecord } from '$domain/types';
import FeedSheet from './FeedSheet.svelte';
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

let host: HTMLElement;
let mounted: Record<string, unknown> | null = null;

function open(asleep = false): void {
	mounted = mount(FeedSheet, {
		target: host,
		props: { asleep, onclose: () => {} }
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
		await landed(async () => (await db.entries.count()) === 1);
		const rows = await db.entries.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('bottle_feed');
		expect(rows[0].payload as BottleFeedPayload).toEqual({
			volume_ml: 170,
			leftover_ml: null,
			contents: 'formula'
		});
	});

	it('saves a breast feed with no duration as a running timer, started at the sheet’s time field', async () => {
		open();
		const time = fieldInput('Time');
		time.value = '15:40'; /* 20 minutes before NOW, Berlin */
		time.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		host.querySelector<HTMLButtonElement>('[data-primary="1"]')?.click();
		await landed(async () => (await db.entries.count()) === 1);
		const rows = await db.entries.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('breast_feed');
		expect(rows[0].occurred_at).toBe(NOW - 20 * 60_000);
		expect(rows[0].ended_at).toBeNull();
	});
});

/* A Baby eats one thing at a time: a new feeding ends a running Feed at the
   new one's Occurred At — the formula after the breast stops the breast timer. */
describe('one feed at a time', () => {
	let db: ReplicaDb;
	let writer: Writer;
	let names = 0;

	beforeEach(() => {
		names += 1;
		db = new ReplicaDb(`feed-sheet-running-${names}`);
		/* The merge clock ticks: a real Device's later revision carries a later
		   merge_at, and the fold breaks a frozen-clock tie by random id. */
		let tick = 0;
		writer = { db, householdId: 'h1', memberId: 'mum', mergeAt: () => NOW + ++tick, now: () => NOW, kick: () => {} };
		app.log = (async (action: (w: Writer) => Promise<unknown>) => action(writer)) as typeof app.log;
		app.edit = (async (action: (w: Writer) => Promise<unknown>) => action(writer)) as typeof app.edit;
	});

	afterEach(async () => {
		delete (app as unknown as Record<string, unknown>).log;
		delete (app as unknown as Record<string, unknown>).edit;
		await db.delete();
	});

	/** Seeds a breast timer through the real write path and mirrors the replica
	    into the app state the sheet reads. */
	async function startBreastTimer(at: number): Promise<string> {
		const id = await logBreastFeed(writer, { babyId: 'b1', occurredAt: at, side: 'left' });
		app.entries = await db.entries.toArray();
		return id;
	}

	it('saving a bottle while a breast feed runs ends it at the bottle’s Occurred At, and says so', async () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_formula');
		const runningId = await startBreastTimer(NOW - 10 * 60_000);
		open();
		expect(host.textContent).toContain('ends the running feed at');
		tapPreset('150');
		host.querySelector<HTMLButtonElement>('[data-primary="1"]')?.click();
		await landed(async () => (await db.entries.count()) === 2);
		const running = await db.entries.get(runningId);
		expect(running?.ended_at).toBe(NOW);
	});

	it('leaves the running feed alone when the new one is back-dated before it', async () => {
		localStorage.setItem('blb.feedingDefault', 'bottle_formula');
		const runningId = await startBreastTimer(NOW - 10 * 60_000);
		open();
		// The running feed started 15:50 Berlin; 15:00 predates it — a separate,
		// earlier feed, so the sheet neither warns nor writes an end.
		const timeInput = fieldInput('Time');
		timeInput.value = '15:00';
		timeInput.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(host.textContent).not.toContain('ends the running feed at');
		tapPreset('150');
		host.querySelector<HTMLButtonElement>('[data-primary="1"]')?.click();
		await landed(async () => (await db.entries.count()) === 2);
		const running = await db.entries.get(runningId);
		expect(running?.ended_at).toBeNull();
	});

	it('saving a second open-ended feed ends the first and leaves only the new one running', async () => {
		const runningId = await startBreastTimer(NOW - 10 * 60_000);
		open();
		host.querySelector<HTMLButtonElement>('[data-primary="1"]')?.click();
		await landed(async () => (await db.entries.count()) === 2);
		const rows = await db.entries.toArray();
		expect(rows.find((r) => r.id === runningId)?.ended_at).toBe(NOW);
		const stillRunning = rows.filter((r) => r.ended_at == null);
		expect(stillRunning).toHaveLength(1);
		expect(stillRunning[0].id).not.toBe(runningId);
	});
});

/* Food mode writes through the same replica as the other modes. The foods list
   the sheet holds is a reactive proxy, and IndexedDB's structured clone refuses
   a Proxy — so the save path must hand over plain objects, or every Meal save
   throws before anything lands. fake-indexeddb refuses proxies the same way,
   which is what lets these tests stand guard. */
describe('food mode', () => {
	let db: ReplicaDb;
	let writer: Writer;
	let names = 0;

	beforeEach(() => {
		names += 1;
		db = new ReplicaDb(`feed-sheet-food-${names}`);
		let tick = 0;
		writer = { db, householdId: 'h1', memberId: 'mum', mergeAt: () => NOW + ++tick, now: () => NOW, kick: () => {} };
		app.log = (async (action: (w: Writer) => Promise<unknown>) => action(writer)) as typeof app.log;
		app.edit = (async (action: (w: Writer) => Promise<unknown>) => action(writer)) as typeof app.edit;
	});

	afterEach(async () => {
		delete (app as unknown as Record<string, unknown>).log;
		delete (app as unknown as Record<string, unknown>).edit;
		await db.delete();
	});

	const settle = landed;

	/** Types a new Food's name and taps the Add “…” chip the query reveals. */
	async function addNewFood(name: string): Promise<void> {
		const input = fieldInput('Add a food');
		input.value = name;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		const chip = [...host.querySelectorAll<HTMLButtonElement>('.chip')].find((b) => b.textContent?.includes(name));
		if (!chip) throw new Error(`no Add chip for ${name}`);
		chip.click();
		await settle(async () => (await db.foods.toArray()).some((f) => f.name === name));
	}

	function save(): void {
		host.querySelector<HTMLButtonElement>('[data-primary="1"]')?.click();
	}

	async function seedRunningSleep(at: number): Promise<string> {
		const id = await startSleep(writer, { babyId: 'b1', occurredAt: at });
		app.entries = await db.entries.toArray();
		return id;
	}

	it('saves a Meal with the picked Food and amount, as plain data the replica accepts', async () => {
		open();
		tab('Food').click();
		flushSync();
		await addNewFood('Banane');
		tab('Lots').click();
		flushSync();
		save();
		await settle(async () => (await db.entries.toArray()).some((e) => e.type === 'meal'));
		const foods = await db.foods.toArray();
		expect(foods).toHaveLength(1);
		expect(foods[0].name).toBe('Banane');
		const meal = (await db.entries.toArray()).find((e) => e.type === 'meal');
		expect(meal).toBeDefined();
		expect((meal?.payload as MealPayload).foods).toEqual([
			{ food_id: foods[0].id, amount: 'lots', reaction: null }
		]);
	});

	it('back-dated before the running Sleep, a Meal leaves the Sleep running — she ate, then went down', async () => {
		const sleepId = await seedRunningSleep(NOW - 30 * 60_000); /* 15:30 Berlin */
		open(true);
		tab('Food').click();
		flushSync();
		await addNewFood('Brei');
		const time = fieldInput('Time');
		time.value = '15:00'; /* before she went down */
		time.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(host.textContent).not.toContain('marked awake from');
		save();
		await settle(async () => (await db.entries.toArray()).some((e) => e.type === 'meal'));
		const sleep = await db.entries.get(sleepId);
		expect(sleep?.ended_at).toBeNull();
		const meal = (await db.entries.toArray()).find((e) => e.type === 'meal');
		expect(meal?.occurred_at).toBe(NOW - 60 * 60_000);
	});

	it('inside the running Sleep, a Meal marks her awake at its Occurred At, and says so beforehand', async () => {
		const sleepId = await seedRunningSleep(NOW - 30 * 60_000);
		open(true);
		tab('Food').click();
		flushSync();
		await addNewFood('Brei');
		expect(host.textContent).toContain('marked awake from');
		save();
		await settle(async () => (await db.entries.get(sleepId))?.ended_at != null);
		const sleep = await db.entries.get(sleepId);
		expect(sleep?.ended_at).toBe(NOW);
	});
});
