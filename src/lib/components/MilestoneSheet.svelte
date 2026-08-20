<script lang="ts">
	/* The Milestone sheet. ADR-0011, spec §3.6.

	   A single-line input, not a textarea. The name is written, not chosen, and
	   stored exactly as typed; the suggestions below it are *derived* from the
	   Milestones this Household has already used, plus ten localised starters that
	   are UI text and nothing more.

	   No age annotation and no age filtering: the moment it reads "crawling: 7–10
	   months", a logging app has become a developmental schedule telling a parent
	   their nine-month-old is late. */
	import { app } from '$client/state.svelte';
	import { logMilestone } from '$client/mutate';
	import { milestoneSuggestions, STARTER_MILESTONE_KEYS } from '$domain/milestones';
	import { dateInputValue } from '$lib/i18n/format';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let name = $state('');
	let note = $state('');
	let showNote = $state(false);
	let date = $state(dateInputValue(app.now, app.zone));
	let busy = $state(false);

	const baby = $derived(app.baby);

	const STARTERS: Record<(typeof STARTER_MILESTONE_KEYS)[number], () => string> = {
		first_smile: m.milestone_first_smile,
		first_laugh: m.milestone_first_laugh,
		rolled_over: m.milestone_rolled_over,
		sat_up_unaided: m.milestone_sat_up_unaided,
		first_tooth: m.milestone_first_tooth,
		started_crawling: m.milestone_started_crawling,
		pulled_to_stand: m.milestone_pulled_to_stand,
		first_steps: m.milestone_first_steps,
		first_word: m.milestone_first_word,
		waved: m.milestone_waved
	};

	const suggestions = $derived(
		milestoneSuggestions(
			app.babyEntries,
			STARTER_MILESTONE_KEYS.map((key) => STARTERS[key]())
		).slice(0, 12)
	);

	async function save() {
		const written = name.trim();
		if (!baby || busy || written.length === 0) return;
		busy = true;
		const trimmed = note.trim();
		const id = await app.log(
			(w) =>
				logMilestone(w, {
					babyId: baby.id,
					name: written,
					/* Dated today → the moment of logging. Back-dated → the Day Start of
					   that date, so it sits at the head of its day. */
					dateKey: date === dateInputValue(app.now, app.zone) ? null : date,
					dayStart: app.dayStart,
					zone: app.zone,
					note: trimmed.length > 0 ? trimmed : null
				}),
			{ text: m.toast_logged({ what: m.type_milestone() }) }
		);
		busy = false;
		if (id) onclose();
	}
</script>

<Sheet title={m.sheet_milestone_title()} icon="flag" t="milestone" {onclose}>
	<label class="field">
		{m.sheet_milestone_name()}
		<input type="text" bind:value={name} maxlength="200" autocomplete="off" />
	</label>

	<div class="chips">
		{#each suggestions as suggestion (suggestion)}
			<button class="chip" type="button" aria-pressed={name === suggestion} onclick={() => (name = suggestion)}>
				{suggestion}
			</button>
		{/each}
	</div>

	<label class="field">
		{m.sheet_milestone_when()}
		<input type="date" bind:value={date} max={dateInputValue(app.now, app.zone)} />
	</label>

	{#if showNote}
		<label class="field">
			{m.note()}
			<input type="text" bind:value={note} />
		</label>
	{:else}
		<div class="field">
			<button class="chip" type="button" onclick={() => (showNote = true)}>
				<Icon name="note" />
				{m.note_add()}
			</button>
		</div>
	{/if}

	<div class="sheet-acts">
		<button type="button" onclick={onclose}>{m.cancel()}</button>
		<button type="button" data-primary="1" disabled={busy || name.trim().length === 0} onclick={save}>
			{m.save()}
		</button>
	</div>
</Sheet>

<style>
	.field {
		margin-bottom: var(--sp-3);
		padding: 0 var(--sp-4);
	}
</style>
