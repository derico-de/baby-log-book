<script lang="ts">
	/* One nappy, entered as one form (ADR-0028).

	   Pee and Poop used to be two fan rows and therefore two Entries: a change
	   that held both was logged twice, or logged as half of what it was. They
	   are two facts about one nappy, so they are two toggles on one sheet, and
	   the sheet is what finally makes the consistency field reachable — it has
	   been in the payload and the three locales since v1 with nowhere to type
	   it.

	   Nothing is prefilled: the app never writes data nobody entered, and a
	   ticked-by-default Pee would be a fact the form invented. Save stays
	   disabled until the nappy says what was in it. */
	import { app } from '$client/state.svelte';
	import { logNappy } from '$client/mutate';
	import { timeInputValue } from '$lib/i18n/format';
	import { wallTimeAtOrBefore } from '$domain/time';
	import type { Consistency } from '$domain/types';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let pee = $state(false);
	let poop = $state(false);
	let consistency = $state<Consistency | null>(null);
	let note = $state('');
	let showNote = $state(false);
	/* Backwards from now, like a feed's time: 23:45 typed at 00:20 is
	   thirty-five minutes ago, not tomorrow night. */
	let time = $state(timeInputValue(app.now, app.zone));
	let busy = $state(false);

	const baby = $derived(app.baby);
	const occurredAt = $derived(wallTimeAtOrBefore(time, app.now, app.zone) ?? app.now);
	const nothingSaid = $derived(!pee && !poop);

	const CONSISTENCIES: Array<[Consistency, () => string]> = [
		['soft', () => m.consistency_soft()],
		['firm', () => m.consistency_firm()],
		['runny', () => m.consistency_runny()],
		['hard', () => m.consistency_hard()]
	];

	/** Tapping the chosen one again clears it: the field is optional, and an
	    unsaid consistency is a real answer rather than a missing one. */
	function pickConsistency(value: Consistency) {
		consistency = consistency === value ? null : value;
	}

	async function save() {
		if (!baby || busy || nothingSaid) return;
		busy = true;
		const trimmed = note.trim();
		const id = await app.log(
			(w) =>
				logNappy(w, {
					babyId: baby.id,
					occurredAt,
					note: trimmed.length > 0 ? trimmed : null,
					pee,
					poop,
					/* A consistency belongs to a poop; ticking it off takes the
					   answer with it rather than leaving it on a pee. */
					consistency: poop ? consistency : null
				}),
			{ text: m.toast_logged({ what: pee && poop ? m.nappy_both() : poop ? m.nappy_poop() : m.nappy_pee() }) }
		);
		busy = false;
		if (id) onclose();
	}
</script>

<Sheet title={m.type_nappy()} icon="nappy" t="nappy" {onclose}>
	<!-- Two toggles rather than a Pee / Poop / Both switch: "both" is not a
	     third kind of nappy, it is the two facts the model already stores. -->
	<div class="seg toggles">
		<button type="button" aria-pressed={pee} onclick={() => (pee = !pee)}>
			{m.fan_pee()}
		</button>
		<button type="button" aria-pressed={poop} onclick={() => (poop = !poop)}>
			{m.fan_poop()}
		</button>
	</div>

	{#if poop}
		<div class="field-label">{m.consistency()}</div>
		<div class="seg" role="group" aria-label={m.consistency()}>
			{#each CONSISTENCIES as [value, label] (value)}
				<button type="button" aria-pressed={consistency === value} onclick={() => pickConsistency(value)}>
					{label()}
				</button>
			{/each}
		</div>
	{/if}

	<div class="field pair">
		<label>
			{m.sheet_time()}
			<input type="time" bind:value={time} />
		</label>
		{#if showNote}
			<label>
				{m.note()}
				<input type="text" bind:value={note} />
			</label>
		{:else}
			<div class="note-slot">
				<button class="chip" type="button" onclick={() => (showNote = true)}>
					<Icon name="note" />
					{m.note_add()}
				</button>
			</div>
		{/if}
	</div>

	<div class="sheet-acts">
		<button type="button" onclick={onclose}>{m.cancel()}</button>
		<button type="button" data-primary="1" disabled={busy || nothingSaid} onclick={save}>{m.save()}</button>
	</div>
</Sheet>

<style>
	/* The segmented control's own state attribute is aria-selected, which is for
	   one-of-many. These are independent toggles, so they say aria-pressed and
	   borrow the same look. */
	.seg button[aria-pressed='true'] {
		background: var(--surface-raised);
		color: var(--ink);
		box-shadow: var(--shadow);
	}
	/* The two headline answers carry the type's colour when they are on: this
	   is the one sheet where the toggle *is* the entry. */
	.toggles button[aria-pressed='true'] {
		background: var(--t-nappy);
		color: var(--t-nappy-ink);
	}
	.toggles button {
		min-height: 54px;
		font-size: var(--fs-3);
	}
	.field-label {
		padding: 0 var(--sp-4);
		margin-bottom: var(--sp-2);
		font-size: var(--fs-1);
		color: var(--ink-2);
	}
	.field {
		margin-bottom: var(--sp-3);
		padding: 0 var(--sp-4);
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1.3fr;
		gap: var(--sp-3);
		align-items: end;
	}
	/* Keeps the *Add a note* chip on the time input's baseline. */
	.note-slot {
		display: flex;
		align-items: center;
		min-height: 44px;
	}
</style>
