<script lang="ts">
	/* Weight, height and head circumference — all optional, entered together
	   behind one action (spec §3.2). Stored as integer grams and millimetres;
	   these inputs are the display units and nothing else. */
	import { app } from '$client/state.svelte';
	import { logMeasurement } from '$client/mutate';
	import { timeInputValue } from '$lib/i18n/format';
	import { wallTimeAtOrBefore } from '$domain/time';
	import * as m from '$lib/paraglide/messages';
	import Sheet from './Sheet.svelte';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let kg = $state<number | null>(null);
	let heightCm = $state<number | null>(null);
	let headCm = $state<number | null>(null);
	let note = $state('');
	let time = $state(timeInputValue(app.now, app.zone));
	let busy = $state(false);

	const baby = $derived(app.baby);
	const nothingEntered = $derived(kg == null && heightCm == null && headCm == null);

	const occurredAt = $derived(wallTimeAtOrBefore(time, app.now, app.zone) ?? app.now);

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

<Sheet title={m.sheet_measurement_title()} {onclose}>
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
			{m.sheet_time()}
			<input type="time" bind:value={time} />
		</label>
	</div>
	<label class="field">
		{m.note()} <small>({m.optional()})</small>
		<input type="text" bind:value={note} />
	</label>

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
