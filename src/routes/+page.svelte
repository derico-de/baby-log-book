<script lang="ts">
	/* The timeline — the primary screen, not a dashboard of tiles with the log
	   demoted below the fold (spec §8.4). */
	import { app } from '$client/state.svelte';
	import { addBaby, deleteEntry, endSleep, logNappy, startSleep, stopSession } from '$client/mutate';
	import { dayBucketOf, dayStartInstant, wallTimeAtOrAfter, wallTimeAtOrBefore } from '$domain/time';
	import { dayLabel } from '$lib/i18n/format';
	import type { Entry } from '$domain/types';
	import * as m from '$lib/paraglide/messages';
	import EntrySheet from '$lib/components/EntrySheet.svelte';
	import Fan from '$lib/components/Fan.svelte';
	import FeedSheet from '$lib/components/FeedSheet.svelte';
	import FilterHeader from '$lib/components/FilterHeader.svelte';
	import FilterSheet from '$lib/components/FilterSheet.svelte';
	import LiveHeader from '$lib/components/LiveHeader.svelte';
	import MeasurementSheet from '$lib/components/MeasurementSheet.svelte';
	import MilestoneSheet from '$lib/components/MilestoneSheet.svelte';
	import Notices from '$lib/components/Notices.svelte';
	import StaleBanner from '$lib/components/StaleBanner.svelte';
	import TimelineRow from '$lib/components/TimelineRow.svelte';
	import TimeSheet from '$lib/components/TimeSheet.svelte';

	type SheetName = 'feed' | 'feed-asleep' | 'measurement' | 'milestone' | 'filter' | 'sleep-start' | 'awake' | null;
	let sheet = $state<SheetName>(null);
	let openEntry = $state<Entry | null>(null);
	/** The Sleep *She's awake* is aimed at — the row's own, or the running one
	    when the statement comes from the fan. */
	let awakeTarget = $state<Entry | null>(null);
	let newBabyName = $state('');
	let newBabyBirth = $state('');

	const baby = $derived(app.baby);
	const filtered = $derived(app.filtered);
	const stale = $derived(app.stale);

	/** Day groups, derived at display time from the Day Start in the Household
	    Zone. Nothing is ever stamped onto a row (spec §7.1). */
	const groups = $derived.by(() => {
		const out: Array<{ key: string; entries: Entry[] }> = [];
		for (const entry of app.visible) {
			const key = dayBucketOf(entry.occurred_at, app.dayStart, app.zone);
			const last = out.at(-1);
			if (last && last.key === key) last.entries.push(entry);
			else out.push({ key, entries: [entry] });
		}
		return out;
	});

	async function nappy(pee: boolean, poop: boolean) {
		if (!baby) return;
		const id = await app.log((w) => logNappy(w, { babyId: baby.id, pee, poop }), {
			text: m.toast_logged({ what: poop && !pee ? m.nappy_poop() : pee && poop ? m.nappy_both() : m.nappy_pee() }),
			undo: async () => {
				if (id) await app.edit((w) => deleteEntry(w, id), { text: m.toast_undone() });
			}
		});
	}

	/** Starting a Sleep asks for its time first — prefilled with now, so the
	    common path is one confirming tap. Backwards from now, like a feed's
	    time: 23:45 typed at 00:20 is thirty-five minutes ago. */
	async function beginSleep(time: string) {
		sheet = null;
		if (!baby) return;
		const at = wallTimeAtOrBefore(time, app.now, app.zone) ?? app.now;
		const id = await app.log((w) => startSleep(w, { babyId: baby.id, occurredAt: at }), {
			text: m.toast_sleep_started(),
			undo: async () => {
				if (id) await app.edit((w) => deleteEntry(w, id), { text: m.toast_undone() });
			}
		});
	}

	/** *She's awake* ends the Sleep at the time the sheet asked for; opened from
	    the fan it aims at the running Sleep, and the fan reflows in place once
	    the end lands. The time is an end, so it reads forwards from the Sleep's
	    start — the same lens the entry edit sheet uses. */
	async function awake(time: string) {
		const target = awakeTarget ?? app.runningSleep;
		sheet = null;
		awakeTarget = null;
		if (!target) return;
		const at = wallTimeAtOrAfter(time, target.occurred_at, app.zone);
		if (at == null) return;
		await app.edit((w) => endSleep(w, target.id, at), { text: m.toast_sleep_ended() });
	}

	/** Stopping a row you are already looking at does not clear the filter. */
	async function stop(entry: Entry) {
		await app.edit((w) => stopSession(w, entry.id, Date.now()), {
			text: entry.type === 'sleep' ? m.toast_sleep_ended() : m.toast_logged({ what: m.type_breast_feed() })
		});
	}

	/** The row's *She's awake* — the same statement the fan makes, aimed at the
	    row's own Sleep rather than whichever one is running. */
	function awakeRow(entry: Entry) {
		awakeTarget = entry;
		sheet = 'awake';
	}

	async function createBaby(event: SubmitEvent) {
		event.preventDefault();
		if (newBabyName.trim().length === 0 || newBabyBirth === '') return;
		await app.log((w) => addBaby(w, newBabyName.trim(), newBabyBirth), null);
		newBabyName = '';
		newBabyBirth = '';
	}
</script>

<section class="screen">
	<!-- The search icon swaps the header at once: the inverted block stands
	     before the first chip is pressed, because the mode change is the
	     signal (spec §8.7, variant A). -->
	{#if app.filterHeaderShown}
		<FilterHeader onMore={() => (sheet = 'filter')} />
	{:else if baby}
		<LiveHeader onFilter={() => app.openFilter()} />
	{/if}

	<Notices />

	<div class="scroll">
		{#if !app.ready}
			<p class="empty">{m.sync_catching_up()}</p>
		{:else if !baby}
			<!-- A Parent has to add a Baby before there is anything to log against.
			     Multi-baby is in the data model from day one; the selector only
			     appears once a second Baby exists (spec §3.1). -->
			<div class="empty">
				<b>{m.timeline_no_baby()}</b>
				{#if app.isParent}
					<form class="new-baby" onsubmit={createBaby}>
						<label>
							{m.settings_baby_name()}
							<input type="text" bind:value={newBabyName} required />
						</label>
						<label>
							{m.settings_baby_birth()}
							<input type="date" bind:value={newBabyBirth} required />
						</label>
						<button type="submit">{m.timeline_add_baby()}</button>
					</form>
				{/if}
			</div>
		{:else}
			<!-- The banner belongs to the live header's world, so it is absent while
			     the filter header is up and returns when the filter clears. -->
			{#if stale.stale && stale.sleep && !app.filterHeaderShown}
				<StaleBanner sleep={stale.sleep} />
			{/if}

			{#if groups.length === 0}
				<div class="empty">
					{#if filtered}
						<b>{m.filter_none()}</b>
						{m.filter_none_hint()}
					{:else}
						<b>{m.timeline_empty()}</b>
						{m.timeline_empty_hint()}
					{/if}
				</div>
			{/if}

			{#each groups as group (group.key)}
				<div class="daymark">
					{dayLabel(
						group.key,
						app.todayKey,
						app.yesterdayKey,
						dayStartInstant(group.key, app.dayStart, app.zone),
						app.zone
					)}
				</div>
				<ul class="list">
					{#each group.entries as entry (entry.id)}
						<TimelineRow
							{entry}
							onopen={(e) => (openEntry = e)}
							onstop={stop}
							onawake={awakeRow}
							onfeedasleep={() => (sheet = 'feed-asleep')}
						/>
					{/each}
				</ul>
			{/each}
		{/if}
		<div class="pad-bottom"></div>
	</div>
</section>

{#if baby}
	<Fan
		asleep={app.runningSleep != null}
		onPee={() => void nappy(true, false)}
		onPoop={() => void nappy(false, true)}
		onSleep={() => (sheet = 'sleep-start')}
		onFeed={() => (sheet = 'feed')}
		onMeasurement={() => (sheet = 'measurement')}
		onMilestone={() => (sheet = 'milestone')}
		onAwake={() => {
			awakeTarget = app.runningSleep;
			sheet = 'awake';
		}}
		onFeedAsleep={() => (sheet = 'feed-asleep')}
	/>
{/if}

{#if sheet === 'feed' || sheet === 'feed-asleep'}
	<FeedSheet asleep={sheet === 'feed-asleep'} onclose={() => (sheet = null)} />
{:else if sheet === 'measurement'}
	<MeasurementSheet onclose={() => (sheet = null)} />
{:else if sheet === 'milestone'}
	<MilestoneSheet onclose={() => (sheet = null)} />
{:else if sheet === 'filter'}
	<FilterSheet onclose={() => (sheet = null)} />
{:else if sheet === 'sleep-start'}
	<TimeSheet title={m.sheet_sleep_start_title()} onsave={(t) => void beginSleep(t)} onclose={() => (sheet = null)} />
{:else if sheet === 'awake'}
	<TimeSheet
		title={m.fan_awake()}
		onsave={(t) => void awake(t)}
		onclose={() => {
			sheet = null;
			awakeTarget = null;
		}}
	/>
{/if}

{#if openEntry}
	<EntrySheet entry={openEntry} onclose={() => (openEntry = null)} />
{/if}

<style>
	.new-baby {
		max-width: 22rem;
		margin: var(--sp-5) auto 0;
		text-align: left;
	}
</style>
