<script lang="ts">
	/* The timeline — the primary screen, not a dashboard of tiles with the log
	   demoted below the fold (spec §8.4). */
	import { app } from '$client/state.svelte';
	import { addBaby, deleteEntry, endSleep, logNappy, startSleep, stopSession } from '$client/mutate';
	import { dayBucketOf, dayStartInstant } from '$domain/time';
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

	type SheetName = 'feed' | 'feed-asleep' | 'measurement' | 'milestone' | 'filter' | null;
	let sheet = $state<SheetName>(null);
	let openEntry = $state<Entry | null>(null);
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

	async function beginSleep() {
		if (!baby) return;
		const id = await app.log((w) => startSleep(w, { babyId: baby.id }), {
			text: m.toast_sleep_started(),
			undo: async () => {
				if (id) await app.edit((w) => deleteEntry(w, id), { text: m.toast_undone() });
			}
		});
	}

	/** *She's awake* ends the Sleep; the fan stays open and reflows in place. */
	async function awake() {
		const running = app.runningSleep;
		if (!running) return;
		await app.edit((w) => endSleep(w, running.id), { text: m.toast_sleep_ended() });
	}

	/** Stopping a row you are already looking at does not clear the filter. */
	async function stop(entry: Entry) {
		await app.edit((w) => stopSession(w, entry.id, Date.now()), {
			text: entry.type === 'sleep' ? m.toast_sleep_ended() : m.toast_logged({ what: m.type_breast_feed() })
		});
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
						<TimelineRow {entry} onopen={(e) => (openEntry = e)} onstop={stop} />
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
		onSleep={() => void beginSleep()}
		onFeed={() => (sheet = 'feed')}
		onMeasurement={() => (sheet = 'measurement')}
		onMilestone={() => (sheet = 'milestone')}
		onAwake={() => void awake()}
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
