/* Does it actually draw?

   These are deliberately shallow: they mount the components that carry the most
   logic and assert the sentences a Member would read. The point is to catch a
   template that throws or a figure that comes out wrong, not to re-test the
   domain — the folds have their own suite. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { app } from '$client/state.svelte';
import { ReplicaDb } from '$client/db';
import type { Baby, Entry, Household, MemberRecord, Target } from '$domain/types';
import FilterHeader from './FilterHeader.svelte';
import LiveHeader from './LiveHeader.svelte';
import TimelineRow from './TimelineRow.svelte';
import TimeSheet from './TimeSheet.svelte';
import StatCard from './StatCard.svelte';
import Fan from './Fan.svelte';
import StaleBanner from './StaleBanner.svelte';
import { statsFor } from '$domain/stats';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T14:00:00Z'); /* 16:00 Berlin */

const household: Household = { id: 'h1', name: 'Zuhause', day_start: '05:00', zone: BERLIN };
const baby: Baby = { id: 'b1', household_id: 'h1', name: 'Lina', birth_date: '2026-02-17', deleted_at: null };
const oma: MemberRecord = {
	id: 'oma',
	household_id: 'h1',
	display_name: 'Oma',
	role: 'caregiver',
	removed_at: null,
	locale: 'en'
};
const feedTarget: Target = {
	id: 't1',
	household_id: 'h1',
	baby_id: 'b1',
	activity: 'feed',
	duration_s: 3 * 3600,
	anchor: 'feed_start',
	deleted_at: null
};
const sleepTarget: Target = { ...feedTarget, id: 't2', activity: 'sleep', duration_s: 2 * 3600, anchor: 'sleep_end' };
const bottleTarget: Target = { ...feedTarget, id: 't3', activity: 'bottle', duration_s: 3600, anchor: 'bottle_start' };

let seq = 0;
function entry(p: Partial<Entry> & { type: Entry['type']; occurred_at: number }): Entry {
	seq += 1;
	return {
		id: `e${seq}`,
		household_id: 'h1',
		baby_id: 'b1',
		ended_at: null,
		recording_zone: BERLIN,
		note: null,
		payload: {} as never,
		logged_by: 'oma',
		logged_at: p.occurred_at,
		edited_by: null,
		edited_at: null,
		deleted_at: null,
		merged_into: null,
		...p
	} as Entry;
}

let host: HTMLElement;
let mounted: Record<string, unknown> | null = null;

function draw<T extends Record<string, unknown>>(component: unknown, props: T): string {
	mounted = mount(component as never, { target: host, props }) as Record<string, unknown>;
	return host.textContent ?? '';
}

beforeEach(() => {
	host = document.createElement('div');
	document.body.append(host);
	app.household = household;
	app.babies = [baby];
	app.members = [oma];
	app.foods = [];
	app.targets = [feedTarget, sleepTarget, bottleTarget];
	app.entries = [];
	app.now = NOW;
	app.identity = { memberId: 'oma', householdId: 'h1', role: 'caregiver', displayName: 'Oma' };
	app.selectedBabyId = 'b1';
	app.filter = { types: [], foodId: null, memberId: null, text: '', period: 'anytime' };
	app.filterOpen = false;
});

afterEach(() => {
	if (mounted) unmount(mounted as never, { outro: false });
	mounted = null;
	host.remove();
});

describe('the sticky header', () => {
	it('prints the elapsed figure and when the next feed is due', () => {
		app.entries = [entry({ type: 'bottle_feed', occurred_at: NOW - 2 * 3600_000 - 10 * 60_000 })];
		const text = draw(LiveHeader, { onFilter: () => {} });
		expect(text).toContain('Sleeping');
		expect(text).toContain('Feeding');
		expect(text).toContain('since last feed');
		expect(text).toContain('2h10');
		expect(text).toContain('50m');
	});

	it('says nothing about a due instant before anything has been logged', () => {
		const text = draw(LiveHeader, { onFilter: () => {} });
		expect(text).toContain('no feed logged yet');
		expect(text).not.toContain('due');
	});

	it('shows asleep instead of a Wake Window while a Sleep runs', () => {
		app.entries = [
			entry({ type: 'bottle_feed', occurred_at: NOW - 3600_000 }),
			entry({ type: 'sleep', occurred_at: NOW - 65 * 60_000 })
		];
		const text = draw(LiveHeader, { onFilter: () => {} });
		expect(text).toContain('asleep');
		expect(text).toContain('1h05');
		expect(text).toContain('since 14:55');
		expect(text).not.toContain('awake');
		expect(text).not.toContain('nap due');
	});

	it('shows the awake time and when the nap is due once she is up', () => {
		app.entries = [
			entry({ type: 'sleep', occurred_at: NOW - 3 * 3600_000, ended_at: NOW - 30 * 60_000 })
		];
		const text = draw(LiveHeader, { onFilter: () => {} });
		expect(text).toContain('awake');
		expect(text).toContain('30m');
		expect(text).toContain('nap due in 1h30');
	});

	it('counts today s nappies and states the last poop', () => {
		app.entries = [
			entry({ type: 'nappy', occurred_at: NOW - 3600_000, payload: { pee: true, poop: false, consistency: null } }),
			entry({ type: 'nappy', occurred_at: NOW - 7200_000, payload: { pee: true, poop: true, consistency: null } })
		];
		const text = draw(LiveHeader, { onFilter: () => {} });
		expect(text).toContain('2 nappies');
		expect(text).toContain('last poop today');
	});

	it('points the last poop at yesterday when today has none', () => {
		app.entries = [
			entry({ type: 'nappy', occurred_at: NOW - 26 * 3600_000, payload: { pee: false, poop: true, consistency: null } })
		];
		expect(draw(LiveHeader, { onFilter: () => {} })).toContain('last poop yesterday');
	});

	it('carries the age along with the name', () => {
		expect(draw(LiveHeader, { onFilter: () => {} })).toContain('Lina · 6 months');
	});

	it('marks both columns live while their sessions run — the underline, no extra word', () => {
		app.entries = [
			entry({ type: 'breast_feed', occurred_at: NOW - 10 * 60_000 }),
			entry({ type: 'sleep', occurred_at: NOW - 30 * 60_000 })
		];
		const text = draw(LiveHeader, { onFilter: () => {} });
		expect(text).not.toContain('running');
		expect(host.querySelectorAll('.live-cell[data-live="1"]')).toHaveLength(2);
	});

	it('lets both columns fall back once their sessions carry an end', () => {
		app.entries = [
			entry({ type: 'bottle_feed', occurred_at: NOW - 3600_000, ended_at: NOW - 50 * 60_000 }),
			entry({ type: 'sleep', occurred_at: NOW - 3 * 3600_000, ended_at: NOW - 30 * 60_000 })
		];
		draw(LiveHeader, { onFilter: () => {} });
		expect(host.querySelectorAll('.live-cell[data-live="1"]')).toHaveLength(0);
		expect(host.querySelectorAll('.live-cell[data-live="0"]')).toHaveLength(2);
	});
});

describe('the filter header', () => {
	it('stands open but unarmed with the teaching line, before any facet is on', () => {
		app.openFilter();
		const text = draw(FilterHeader, { onMore: () => {} });
		expect(text).toContain('Filter the log');
		expect(text).toContain('Everything');
		expect(text).toContain('pick a kind of entry, or search');
	});

	it('counts hits against the whole log once armed', () => {
		app.entries = [
			entry({ type: 'nappy', occurred_at: NOW - 3600_000, payload: { pee: true, poop: false, consistency: null } }),
			entry({ type: 'sleep', occurred_at: NOW - 7200_000, ended_at: NOW - 5400_000 })
		];
		app.openFilter({ types: ['nappy'], foodId: null, memberId: null, text: '', period: 'anytime' });
		const text = draw(FilterHeader, { onMore: () => {} });
		expect(text).toContain('Filtered');
		expect(text).toContain('Nappies');
		expect(text).toContain('1 of 2 entries');
	});

	it('clears the filter and closes when Clear is pressed', () => {
		app.openFilter({ types: ['nappy'], foodId: null, memberId: null, text: '', period: 'anytime' });
		draw(FilterHeader, { onMore: () => {} });
		(host.querySelector('.clear-btn') as HTMLButtonElement).click();
		flushSync();
		expect(app.filtered).toBe(false);
		expect(app.filterHeaderShown).toBe(false);
	});
});

describe('a timeline row', () => {
	it('reads a bottle feed with its volume, its milk and who logged it', () => {
		const row = entry({
			type: 'bottle_feed',
			occurred_at: NOW - 3600_000,
			payload: { volume_ml: 120, leftover_ml: null, contents: 'formula' }
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('120 ml');
		expect(text).toContain('Formula');
		expect(text).toContain('Oma');
		expect(text).toContain('15:00');
	});

	it('reads a legacy bottle with a leftover as its intake alone — the "of" form is retired', () => {
		const row = entry({
			type: 'bottle_feed',
			occurred_at: NOW - 3600_000,
			payload: { volume_ml: 180, leftover_ml: 30, contents: 'breast_milk' }
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('150 ml');
		expect(text).toContain('Breast milk');
		expect(text).not.toContain('of 180');
		expect(text).not.toContain('180 ml');
	});

	it('counts a started bottle down beside its Stop button', () => {
		const row = entry({
			type: 'bottle_feed',
			occurred_at: NOW - 20 * 60_000,
			payload: { volume_ml: 120, leftover_ml: null, contents: 'formula' }
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('bottle 40m left');
		expect(text).toContain('Stop');
	});

	it('keeps counting past the stated hour rather than going quiet', () => {
		const row = entry({
			type: 'bottle_feed',
			occurred_at: NOW - 80 * 60_000,
			payload: { volume_ml: 120, leftover_ml: null, contents: 'formula' }
		});
		app.entries = [row];
		expect(draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} })).toContain('bottle 20m past');
	});

	it('draws no countdown on a bottle that has been stopped, or on a running breast feed', () => {
		const done = entry({
			type: 'bottle_feed',
			occurred_at: NOW - 20 * 60_000,
			ended_at: NOW - 5 * 60_000,
			payload: { volume_ml: 120, leftover_ml: null, contents: 'formula' }
		});
		app.entries = [done];
		expect(draw(TimelineRow, { entry: done, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} })).not.toMatch(/bottle \d+\w* (left|past)/);

		if (mounted) unmount(mounted as never, { outro: false });
		mounted = null;
		const breast = entry({ type: 'breast_feed', occurred_at: NOW - 20 * 60_000, payload: { side: 'left' } });
		app.entries = [breast];
		expect(draw(TimelineRow, { entry: breast, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} })).not.toMatch(/bottle \d+\w* (left|past)/);
	});

	it('offers the fan s two statements on a running Sleep, not a bare Stop', () => {
		const row = entry({ type: 'sleep', occurred_at: NOW - 6 * 3600_000 });
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('running');
		expect(text).toContain("She's awake");
		expect(text).toContain('Feed while asleep');
		expect(text).not.toContain('Stop');
	});

	it('states both ends of a finished Sleep, with the duration underneath', () => {
		const row = entry({
			type: 'sleep',
			occurred_at: Date.parse('2026-08-17T11:45:00Z') /* 13:45 Berlin */,
			ended_at: Date.parse('2026-08-17T12:05:00Z') /* 14:05 Berlin */
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('13:45 – 14:05');
		expect(host.querySelector('.row-dur')?.textContent).toBe('20m');
	});

	it('keeps the single clock time on a finished feed — only a Sleep states its end', () => {
		const row = entry({
			type: 'breast_feed',
			occurred_at: NOW - 3600_000 /* 15:00 Berlin */,
			ended_at: NOW - 40 * 60_000,
			payload: { side: 'left' }
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('15:00');
		expect(text).not.toContain('–');
	});

	it('gives a Milestone an em dash where the clock time would be', () => {
		const row = entry({ type: 'milestone', occurred_at: NOW - 86_400_000, payload: { name: 'First tooth' } });
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('First tooth');
		expect(text).toContain('—');
		expect(text).not.toMatch(/\d\d:\d\d/);
	});

	it('says sleep feed on a Feed that overlaps a Sleep', () => {
		const sleep = entry({ type: 'sleep', occurred_at: NOW - 4 * 3600_000 });
		const feed = entry({ type: 'breast_feed', occurred_at: NOW - 2 * 3600_000, payload: { side: 'left' } });
		app.entries = [sleep, feed];
		expect(draw(TimelineRow, { entry: feed, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} })).toContain('sleep feed');
	});

	it('writes the Note out under the row while a filter is armed, and keeps it behind the icon otherwise', () => {
		const row = entry({
			type: 'nappy',
			occurred_at: NOW - 3600_000,
			note: 'a little red',
			payload: { pee: true, poop: false, consistency: null }
		});
		app.entries = [row];
		expect(draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} })).not.toContain('a little red');

		if (mounted) unmount(mounted as never, { outro: false });
		mounted = null;
		app.filter = { ...app.filter, types: ['nappy'] };
		expect(draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} })).toContain('a little red');
	});

	it('marks the free-text hit in the note that carries it', () => {
		const row = entry({
			type: 'nappy',
			occurred_at: NOW - 3600_000,
			note: 'blotches on her cheek',
			payload: { pee: true, poop: false, consistency: null }
		});
		app.entries = [row];
		app.filter = { ...app.filter, text: 'blotches' };
		draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(host.querySelector('mark')?.textContent).toBe('blotches');
	});
});

describe('a tummy time row', () => {
	it('runs as a Live Session with a Stop button', () => {
		const row = entry({ type: 'tummy_time', occurred_at: NOW - 8 * 60_000 });
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('Tummy time');
		expect(text).toContain('running');
		expect(text).toContain('Stop');
		/* Not a Sleep: the Sleep row's two statements belong to a Sleep. */
		expect(text).not.toContain("She's awake");
	});

	it('states both ends and the duration once it is over', () => {
		const row = entry({
			type: 'tummy_time',
			occurred_at: NOW - 30 * 60_000,
			ended_at: NOW - 18 * 60_000
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {}, onawake: () => {}, onfeedasleep: () => {} });
		expect(text).toContain('15:30');
		expect(text).toContain('15:42');
		expect(text).toContain('12m');
		expect(text).not.toContain('running');
	});
});

describe('the fan', () => {
	const handlers = {
		onNappy: () => {},
		onSleep: () => {},
		onFeed: () => {},
		onMeasurement: () => {},
		onMilestone: () => {},
		onAwake: () => {},
		onFeedAsleep: () => {},
		onTummyStart: () => {},
		onTummyEnd: () => {}
	};

	it('opens into six direct actions — one per entry type', () => {
		draw(Fan, { asleep: false, tummyRunning: false, ...handlers });
		flushSync(() => (host.querySelector('.fab') as HTMLButtonElement).click());
		const items = [...host.querySelectorAll('.fan button')].map((b) => b.textContent?.trim() ?? '');
		expect(items).toHaveLength(6);
		expect(items.join(' ')).toContain('Nappy');
		expect(items.join(' ')).toContain('Sleep');
		expect(items.join(' ')).toContain('Feed');
		expect(items.join(' ')).toContain('Tummy time');
		/* Pee and Poop are fields on the nappy form now, not rows (ADR-0028). */
		const labels = [...host.querySelectorAll('.fan .fan-main')].map((el) => el.textContent?.trim() ?? '');
		expect(labels).not.toContain('Pee');
		expect(labels).not.toContain('Poop');
	});

	it('hands the nappy row to the form and closes, like every other writing row', () => {
		let opened = false;
		draw(Fan, { asleep: false, tummyRunning: false, ...handlers, onNappy: () => (opened = true) });
		flushSync(() => (host.querySelector('.fab') as HTMLButtonElement).click());
		flushSync(() =>
			[...host.querySelectorAll<HTMLButtonElement>('.fan button')]
				.find((b) => b.textContent?.includes('Nappy'))
				?.click()
		);
		expect(opened).toBe(true);
		expect(host.querySelector('.fan')).toBeNull();
	});

	it('offers to end the stretch instead of starting one while tummy time runs', () => {
		draw(Fan, { asleep: false, tummyRunning: true, ...handlers });
		flushSync(() => (host.querySelector('.fab') as HTMLButtonElement).click());
		const labels = [...host.querySelectorAll('.fan .fan-main')].map((el) => el.textContent?.trim() ?? '');
		expect(labels).toContain('Off her tummy');
		expect(labels).not.toContain('Tummy time');
	});

	it('reflows while a Sleep runs, with no ambiguous Feed item', () => {
		draw(Fan, { asleep: true, tummyRunning: false, ...handlers });
		flushSync(() => (host.querySelector('.fab') as HTMLButtonElement).click());
		const labels = [...host.querySelectorAll('.fan .fan-main')].map((el) => el.textContent?.trim() ?? '');
		expect(labels).toContain("She's awake");
		expect(labels).toContain('Feed while asleep');
		/* The bare "Feed" item is gone, and so is "Sleep": three
		   near-synonymous labels in one fan is the 3am discrimination problem. */
		expect(labels).not.toContain('Feed');
		expect(labels).not.toContain('Sleep');
	});
});

describe('the time sheet', () => {
	it('opens prefilled with the current wall time in the Household Zone', () => {
		draw(TimeSheet, { title: 'Fell asleep', onsave: () => {}, onclose: () => {} });
		expect(host.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe('16:00');
	});

	it('hands the typed wall time back on save — the caller decides what instant it means', () => {
		let saved: string | null = null;
		draw(TimeSheet, { title: "She's awake", onsave: (t: string) => (saved = t), onclose: () => {} });
		const input = host.querySelector<HTMLInputElement>('input[type="time"]');
		if (!input) throw new Error('no time input');
		input.value = '15:40';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync(() => host.querySelector<HTMLButtonElement>('[data-primary="1"]')?.click());
		expect(saved).toBe('15:40');
	});
});

describe('the stale-Sleep banner', () => {
	it('asks once, and offers a wake time rather than acting on its own', () => {
		const sleep = entry({ type: 'sleep', occurred_at: NOW - 15 * 3600_000 });
		app.entries = [sleep];
		const text = draw(StaleBanner, { sleep });
		expect(text).toContain('Is she still asleep?');
		expect(text).toContain('She woke at');
		expect(text).toContain('Still asleep');
	});
});

describe('a stats card', () => {
	it('states its numbers as text, with the bars as the secondary read', () => {
		const entries = [
			entry({ type: 'nappy', occurred_at: NOW - 86_400_000, payload: { pee: true, poop: false, consistency: null } }),
			entry({ type: 'nappy', occurred_at: NOW - 3600_000, payload: { pee: true, poop: true, consistency: null } })
		];
		const [card] = statsFor({ entries, babyId: 'b1', now: NOW, dayStart: '05:00', zone: BERLIN });
		const text = draw(StatCard, { card });
		expect(text).toContain('Nappies');
		expect(text).toContain('1 pee · 1 poop');
		expect(host.querySelectorAll('.bar')).toHaveLength(8);
		expect(host.querySelector('.bar[data-today="1"]')).not.toBeNull();
	});

	it('labels the axis with an even ceiling and its half', () => {
		const entries = [
			entry({ type: 'nappy', occurred_at: NOW - 3600_000, payload: { pee: true, poop: false, consistency: null } }),
			entry({ type: 'nappy', occurred_at: NOW - 7200_000, payload: { pee: true, poop: false, consistency: null } }),
			entry({ type: 'nappy', occurred_at: NOW - 10_800_000, payload: { pee: true, poop: false, consistency: null } })
		];
		const [card] = statsFor({ entries, babyId: 'b1', now: NOW, dayStart: '05:00', zone: BERLIN });
		draw(StatCard, { card });
		/* Three nappies today: the ceiling rounds up to 4 so the half tick is
		   a whole number. */
		const ticks = [...host.querySelectorAll('.gridline span')].map((s) => s.textContent);
		expect(ticks).toEqual(['4', '2']);
	});

	it('reads a tapped day back as a sentence, and lets go on the second tap', () => {
		const entries = [
			entry({ type: 'nappy', occurred_at: NOW - 86_400_000, payload: { pee: true, poop: false, consistency: null } }),
			entry({ type: 'nappy', occurred_at: NOW - 3600_000, payload: { pee: true, poop: true, consistency: null } })
		];
		const [card] = statsFor({ entries, babyId: 'b1', now: NOW, dayStart: '05:00', zone: BERLIN });
		draw(StatCard, { card });
		const hits = host.querySelectorAll<HTMLButtonElement>('.bar-hit');
		expect(hits).toHaveLength(8);
		flushSync(() => hits[6]?.click()); /* yesterday, 16 Aug */
		const detail = host.querySelector('.bar-detail');
		expect(detail?.textContent).toContain('Aug');
		expect(detail?.textContent).toContain(': 1');
		flushSync(() => hits[6]?.click());
		expect(host.querySelector('.bar-detail')).toBeNull();
	});

	it('states a tapped Feeds day with what she drank', () => {
		const entries = [
			entry({
				type: 'bottle_feed',
				occurred_at: NOW - 3600_000,
				payload: { volume_ml: 120, leftover_ml: null, contents: 'formula' }
			}),
			entry({
				type: 'bottle_feed',
				occurred_at: NOW - 7200_000,
				payload: { volume_ml: 90, leftover_ml: null, contents: 'formula' }
			})
		];
		const [card] = statsFor({ entries, babyId: 'b1', now: NOW, dayStart: '05:00', zone: BERLIN });
		draw(StatCard, { card });
		flushSync(() => host.querySelectorAll<HTMLButtonElement>('.bar-hit')[7]?.click()); /* today */
		expect(host.querySelector('.bar-detail')?.textContent).toBe('Today: 2 · 210 ml');
	});
});

describe('the replica the components read', () => {
	it('opens on a jsdom IndexedDB, so these tests exercise the real store', async () => {
		const db = new ReplicaDb('render-test');
		await db.open();
		expect(db.isOpen()).toBe(true);
		await db.delete();
	});
});
