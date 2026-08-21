/* The nappy sheet: one form for what used to be two fan rows (ADR-0028).
   Mounted like the other component tests; interactions are real clicks, and the
   save path writes through a real replica. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { app } from '$client/state.svelte';
import { ReplicaDb } from '$client/db';
import type { Writer } from '$client/mutate';
import type { Baby, Household, MemberRecord, NappyPayload } from '$domain/types';
import NappySheet from './NappySheet.svelte';
import { landed } from './test-wait';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T14:00:00Z'); /* 16:00 Berlin */

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
	mounted = mount(NappySheet, { target: host, props: { onclose: () => {} } }) as Record<string, unknown>;
	flushSync();
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === label
	);
	if (!found) throw new Error(`no button labelled ${label}`);
	return found;
}

function tap(label: string): void {
	button(label).click();
	flushSync();
}

const saveButton = () => host.querySelector<HTMLButtonElement>('[data-primary="1"]');

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

describe('the form', () => {
	it('opens with nothing ticked and refuses to save until the nappy says what was in it', () => {
		open();
		expect(button('Pee').getAttribute('aria-pressed')).toBe('false');
		expect(button('Poop').getAttribute('aria-pressed')).toBe('false');
		expect(saveButton()?.disabled).toBe(true);
		tap('Pee');
		expect(saveButton()?.disabled).toBe(false);
	});

	it('takes both at once, which two separate rows could never say', () => {
		open();
		tap('Pee');
		tap('Poop');
		expect(button('Pee').getAttribute('aria-pressed')).toBe('true');
		expect(button('Poop').getAttribute('aria-pressed')).toBe('true');
	});

	it('offers the consistency only once there is a poop to describe', () => {
		open();
		expect(host.textContent).not.toContain('Runny');
		tap('Poop');
		expect(host.textContent).toContain('Runny');
		/* Optional, and tapping the chosen one again unsays it. */
		tap('Runny');
		expect(button('Runny').getAttribute('aria-pressed')).toBe('true');
		tap('Runny');
		expect(button('Runny').getAttribute('aria-pressed')).toBe('false');
	});

	it('opens on the nappy, and takes the potty instead', () => {
		open();
		expect(button('Nappy').getAttribute('aria-pressed')).toBe('true');
		expect(button('Potty').getAttribute('aria-pressed')).toBe('false');
		tap('Potty');
		expect(button('Potty').getAttribute('aria-pressed')).toBe('true');
		expect(button('Nappy').getAttribute('aria-pressed')).toBe('false');
	});

	it('opens on the potty once this Device says that is where it goes', () => {
		/* Stated in Settings, never learned from what has been logged: during
		   training the household flips it once instead of re-tapping every time. */
		localStorage.setItem('blb.whereDefault', 'potty');
		open();
		expect(button('Potty').getAttribute('aria-pressed')).toBe('true');
	});

	it('opens prefilled with the current wall time in the Household Zone', () => {
		open();
		expect(host.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe('16:00');
	});
});

describe('what a save writes', () => {
	let db: ReplicaDb;
	let names = 0;

	beforeEach(() => {
		names += 1;
		db = new ReplicaDb(`nappy-sheet-test-${names}`);
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

	it('writes one Entry for a nappy that held both, with its consistency', async () => {
		open();
		tap('Pee');
		tap('Poop');
		tap('Soft');
		saveButton()?.click();
		await landed(async () => (await db.entries.count()) === 1);
		const rows = await db.entries.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('nappy');
		expect(rows[0].payload as NappyPayload).toEqual({ pee: true, poop: true, consistency: 'soft', where: 'nappy' });
	});

	it('drops a consistency the poop took with it when it was unticked', async () => {
		open();
		tap('Poop');
		tap('Firm');
		tap('Poop');
		tap('Pee');
		saveButton()?.click();
		await landed(async () => (await db.entries.count()) === 1);
		const rows = await db.entries.toArray();
		expect(rows[0].payload as NappyPayload).toEqual({ pee: true, poop: false, consistency: null, where: 'nappy' });
	});

	it('records the potty when that is where it went', async () => {
		open();
		tap('Pee');
		tap('Potty');
		saveButton()?.click();
		await landed(async () => (await db.entries.count()) === 1);
		const rows = await db.entries.toArray();
		expect(rows[0].payload as NappyPayload).toEqual({
			pee: true,
			poop: false,
			consistency: null,
			where: 'potty'
		});
	});

	it('reads the time field backwards from now, like a feed does', async () => {
		open();
		tap('Pee');
		const time = host.querySelector<HTMLInputElement>('input[type="time"]');
		if (!time) throw new Error('no time input');
		time.value = '15:40'; /* 20 minutes before NOW, Berlin */
		time.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		saveButton()?.click();
		await landed(async () => (await db.entries.count()) === 1);
		const rows = await db.entries.toArray();
		expect(rows[0].occurred_at).toBe(NOW - 20 * 60_000);
	});
});
