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
import LiveHeader from './LiveHeader.svelte';
import TimelineRow from './TimelineRow.svelte';
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
	app.targets = [feedTarget, sleepTarget];
	app.entries = [];
	app.now = NOW;
	app.identity = { memberId: 'oma', householdId: 'h1', role: 'caregiver', displayName: 'Oma' };
	app.selectedBabyId = 'b1';
	app.filter = { types: [], foodId: null, memberId: null, text: '', period: 'anytime' };
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
		expect(text).toContain('asleep 1h05');
		expect(text).not.toContain('awake');
		expect(text).not.toContain('down after');
	});

	it('counts today s nappies', () => {
		app.entries = [
			entry({ type: 'nappy', occurred_at: NOW - 3600_000, payload: { pee: true, poop: false, consistency: null } }),
			entry({ type: 'nappy', occurred_at: NOW - 7200_000, payload: { pee: true, poop: true, consistency: null } })
		];
		expect(draw(LiveHeader, { onFilter: () => {} })).toContain('2 nappies');
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
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {} });
		expect(text).toContain('120 ml');
		expect(text).toContain('Formula');
		expect(text).toContain('Oma');
		expect(text).toContain('15:00');
	});

	it('reads a bottle with a leftover as what she drank, of what was offered', () => {
		const row = entry({
			type: 'bottle_feed',
			occurred_at: NOW - 3600_000,
			payload: { volume_ml: 180, leftover_ml: 30, contents: 'breast_milk' }
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {} });
		expect(text).toContain('150 ml of 180');
		expect(text).toContain('Breast milk');
		expect(text).not.toContain('180 ml');
	});

	it('drops the offered figure when she finished the bottle', () => {
		const row = entry({
			type: 'bottle_feed',
			occurred_at: NOW - 3600_000,
			payload: { volume_ml: 150, leftover_ml: 0, contents: 'formula' }
		});
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {} });
		expect(text).toContain('150 ml');
		expect(text).not.toContain('of 150');
	});

	it('draws a running Sleep as an ordinary Live Session with a Stop button', () => {
		const row = entry({ type: 'sleep', occurred_at: NOW - 6 * 3600_000 });
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {} });
		expect(text).toContain('running');
		expect(text).toContain('Stop');
	});

	it('gives a Milestone an em dash where the clock time would be', () => {
		const row = entry({ type: 'milestone', occurred_at: NOW - 86_400_000, payload: { name: 'First tooth' } });
		app.entries = [row];
		const text = draw(TimelineRow, { entry: row, onopen: () => {}, onstop: () => {} });
		expect(text).toContain('First tooth');
		expect(text).toContain('—');
		expect(text).not.toMatch(/\d\d:\d\d/);
	});

	it('says sleep feed on a Feed that overlaps a Sleep', () => {
		const sleep = entry({ type: 'sleep', occurred_at: NOW - 4 * 3600_000 });
		const feed = entry({ type: 'breast_feed', occurred_at: NOW - 2 * 3600_000, payload: { side: 'left' } });
		app.entries = [sleep, feed];
		expect(draw(TimelineRow, { entry: feed, onopen: () => {}, onstop: () => {} })).toContain('sleep feed');
	});
});

describe('the fan', () => {
	const handlers = {
		onPee: () => {},
		onPoop: () => {},
		onSleep: () => {},
		onFeed: () => {},
		onMeasurement: () => {},
		onMilestone: () => {},
		onAwake: () => {},
		onFeedAsleep: () => {}
	};

	it('opens into six direct actions', () => {
		draw(Fan, { asleep: false, ...handlers });
		flushSync(() => (host.querySelector('.fab') as HTMLButtonElement).click());
		const items = [...host.querySelectorAll('.fan button')].map((b) => b.textContent?.trim() ?? '');
		expect(items).toHaveLength(6);
		expect(items.join(' ')).toContain('Pee');
		expect(items.join(' ')).toContain('Sleep');
		expect(items.join(' ')).toContain('Feed');
	});

	it('reflows while a Sleep runs, with no ambiguous Feed item', () => {
		draw(Fan, { asleep: true, ...handlers });
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
});

describe('the replica the components read', () => {
	it('opens on a jsdom IndexedDB, so these tests exercise the real store', async () => {
		const db = new ReplicaDb('render-test');
		await db.open();
		expect(db.isOpen()).toBe(true);
		await db.delete();
	});
});
