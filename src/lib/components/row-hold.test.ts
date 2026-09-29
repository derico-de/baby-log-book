/* Holding a timeline row is the shortcut to Duplicate (ADR-0045): it opens the
   row's sheet on the copy draft, never writes, and the click that ends the
   hold reaches nothing — by then the sheet is under the finger. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { app } from '$client/state.svelte';
import type { Baby, Entry, Household, MemberRecord } from '$domain/types';
import TimelineRow from './TimelineRow.svelte';
import { HOLD_MS } from './long-press';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T14:00:00Z');

const household: Household = { id: 'h1', name: 'Zuhause', day_start: '05:00', zone: BERLIN, night_start: null, feed_notice_s: 0, sleep_notice_s: 0, caregiving: true };
const baby: Baby = { id: 'b1', household_id: 'h1', name: 'Lina', birth_date: '2026-02-17', deleted_at: null };
const oma: MemberRecord = { id: 'oma', household_id: 'h1', display_name: 'Oma', role: 'caregiver', kind: 'person', removed_at: null, locale: 'en' };

function entryOf(type: Entry['type'], payload: object): Entry {
	return {
		id: 'e1',
		household_id: 'h1',
		baby_id: 'b1',
		type,
		occurred_at: NOW - 3600_000,
		ended_at: NOW - 3000_000,
		recording_zone: BERLIN,
		note: null,
		payload,
		logged_by: 'oma',
		logged_at: NOW - 3600_000,
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null
	} as Entry;
}

const bottle = entryOf('bottle_feed', { volume_ml: 120, leftover_ml: null, contents: 'formula' });

let host: HTMLElement;
let mounted: Record<string, unknown> | null = null;
let opened: Entry[];
let duplicated: Entry[];

function draw(entry: Entry): HTMLButtonElement {
	mounted = mount(TimelineRow, {
		target: host,
		props: {
			entry,
			onopen: (e: Entry) => opened.push(e),
			onduplicate: (e: Entry) => duplicated.push(e),
			onstop: () => {},
			onawake: () => {}
		}
	}) as Record<string, unknown>;
	flushSync();
	const row = host.querySelector<HTMLButtonElement>('button.row');
	if (!row) throw new Error('no row');
	return row;
}

const press = (el: Element, type: string, x = 10, y = 10, button = 0) =>
	el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }));

beforeEach(() => {
	vi.useFakeTimers({ now: NOW });
	opened = [];
	duplicated = [];
	host = document.createElement('div');
	document.body.append(host);
	app.household = household;
	app.babies = [baby];
	app.members = [oma];
	app.foods = [];
	app.targets = [];
	app.entries = [];
	app.now = NOW;
	app.selectedBabyId = 'b1';
});

afterEach(() => {
	if (mounted) unmount(mounted as never, { outro: false });
	mounted = null;
	host.remove();
	vi.useRealTimers();
});

describe('holding a timeline row', () => {
	it('opens the row on Duplicate once the press has been held still', () => {
		const row = draw(bottle);
		press(row, 'pointerdown');
		vi.advanceTimersByTime(HOLD_MS - 1);
		expect(duplicated).toHaveLength(0);
		vi.advanceTimersByTime(1);
		expect(duplicated).toEqual([bottle]);
	});

	it('lets the click that ends the hold reach nothing', () => {
		const row = draw(bottle);
		press(row, 'pointerdown');
		vi.advanceTimersByTime(HOLD_MS);
		press(row, 'pointerup');
		row.click();
		expect(opened).toHaveLength(0);
	});

	it('leaves a tap a tap', () => {
		const row = draw(bottle);
		press(row, 'pointerdown');
		vi.advanceTimersByTime(100);
		press(row, 'pointerup');
		row.click();
		vi.advanceTimersByTime(HOLD_MS);
		expect(opened).toEqual([bottle]);
		expect(duplicated).toHaveLength(0);
	});

	it('is not a hold when the finger moves off to scroll', () => {
		const row = draw(bottle);
		press(row, 'pointerdown');
		press(row, 'pointermove', 10, 40);
		vi.advanceTimersByTime(HOLD_MS);
		expect(duplicated).toHaveLength(0);
	});

	it('is not a hold when the browser takes the press for a scroll', () => {
		const row = draw(bottle);
		press(row, 'pointerdown');
		press(row, 'pointercancel');
		vi.advanceTimersByTime(HOLD_MS);
		expect(duplicated).toHaveLength(0);
	});

	it('takes the context-menu gesture as the hold, instead of the menu or a selection', () => {
		const row = draw(bottle);
		const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		row.dispatchEvent(menu);
		expect(menu.defaultPrevented).toBe(true);
		expect(duplicated).toEqual([bottle]);
	});

	it('counts one press once, when the context menu fires beside the timer', () => {
		const row = draw(bottle);
		press(row, 'pointerdown');
		vi.advanceTimersByTime(HOLD_MS);
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(duplicated).toHaveLength(1);
	});

	it('does not eat the next real tap after a hold that ended in no click', () => {
		const row = draw(bottle);
		press(row, 'pointerdown');
		vi.advanceTimersByTime(HOLD_MS);
		press(row, 'pointerup');
		vi.advanceTimersByTime(2000);
		press(row, 'pointerdown');
		press(row, 'pointerup');
		row.click();
		expect(opened).toEqual([bottle]);
	});

	it('does nothing on a Measurement, which is never duplicated', () => {
		const row = draw(entryOf('measurement', { weight_g: 7000, height_mm: null, head_mm: null }));
		press(row, 'pointerdown');
		vi.advanceTimersByTime(HOLD_MS);
		expect(duplicated).toHaveLength(0);
	});
});
