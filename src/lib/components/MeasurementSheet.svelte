<script lang="ts">
	/* Weight, height and head circumference — all optional, entered together
	   behind one action (spec §3.2). Stored as integer grams and millimetres;
	   these inputs are the display units and nothing else. */
	import { app } from '$client/state.svelte';
	import { logMeasurement } from '$client/mutate';
	import { dateInputValue } from '$lib/i18n/format';
	import { dayStartInstant } from '$domain/time';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let kg = $state<number | null>(null);
	let heightCm = $state<number | null>(null);
	let headCm = $state<number | null>(null);
	let note = $state('');
	let showNote = $state(false);
	/* A date, not a clock time: a weight is a fact about a day — the scale at
	   the check-up, not a minute on the clock. */
	let date = $state(dateInputValue(app.now, app.zone));
	let busy = $state(false);

	const baby = $derived(app.baby);
	const nothingEntered = $derived(kg == null && heightCm == null && headCm == null);

	/* Dated today → the moment of logging. Back-dated → the Day Start of that
	   date, so it sits at the head of its day — the Milestone rule (spec §3.6). */
	const occurredAt = $derived(
		date === dateInputValue(app.now, app.zone) ? app.now : dayStartInstant(date, app.dayStart, app.zone)
	);

	async function save() {
		if (!baby || busy || nothingEntered) return;
		busy = true;
		const trimmed = note.trim();
		const id = await app.log(
			(w) =>
				logMeasurement(w, {
					babyId: baby.id,
					occurredAt,
					note: trimmed.length > 0 ? trimmed : null,
					/* Canonical units, rounded to the integer they are stored as. */
					weightG: kg == null ? null : Math.round(kg * 1000),
					heightMm: heightCm == null ? null : Math.round(heightCm * 10),
					headMm: headCm == null ? null : Math.round(headCm * 10)
				}),
			{ text: m.toast_logged({ what: m.type_measurement() }) }
		);
		busy = false;
		if (id) onclose();
	}
</script>

<Sheet title={m.sheet_measurement_title()} icon="measure" t="measure" {onclose}>
	<div class="field pair">
		<label>
			{m.sheet_weight()} <small>(kg)</small>
			<input type="number" inputmode="decimal" step="0.01" min="0" max="60" bind:value={kg} />
		</label>
		<label>
			{m.sheet_height()} <small>(cm)</small>
			<input type="number" inputmode="decimal" step="0.1" min="0" max="200" bind:value={heightCm} />
		</label>
	</div>
	<div class="field pair">
		<label>
			{m.sheet_head()} <small>(cm)</small>
			<input type="number" inputmode="decimal" step="0.1" min="0" max="200" bind:value={headCm} />
		</label>
		<label>
			{m.sheet_date()}
			<input type="date" bind:value={date} max={dateInputValue(app.now, app.zone)} />
		</label>
	</div>
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
		<button type="button" data-primary="1" disabled={busy || nothingEntered} onclick={save}>{m.save()}</button>
	</div>
</Sheet>

<style>
	.field {
		margin-bottom: var(--sp-3);
		padding: 0 var(--sp-4);
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
	}
</style>
