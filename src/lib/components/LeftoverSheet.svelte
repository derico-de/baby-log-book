<script lang="ts">
	/* Stopping a bottle asks the one thing only the bottle can answer, and only
	   now: what came back in it.

	   The leftover is not stored — it is subtracted from the Intake, the way it
	   is in the feed sheet and the entry sheet (ADR-0018) — so this sheet hands
	   a number back and the caller writes the end and the corrected Intake as
	   one revision.

	   The field starts at nothing left, the common answer, so ending costs one
	   tap. Cancel ends nothing: a mis-tapped Stop must not stop the Feed, so
	   the running bottle is left exactly as it was. */
	import { subtractLeftover } from '$domain/entries';
	import { millilitres } from '$lib/i18n/format';
	import * as m from '$lib/paraglide/messages';
	import Sheet from './Sheet.svelte';

	interface Props {
		/** The Intake as it stands — for a running bottle, what was poured. */
		intake: number;
		/** Millilitres left, `0` for a finished bottle, `null` for a cleared field. */
		onsave: (leftoverMl: number | null) => void;
		onclose: () => void;
	}
	let { intake, onsave, onclose }: Props = $props();

	let leftover = $state<number | null>(0);
	const taken = $derived(leftover == null ? intake : (subtractLeftover(intake, leftover) ?? intake));
</script>

<Sheet title={m.sheet_leftover()} icon="feed" t="feed" {onclose}>
	<p class="note-line">{m.sheet_leftover_poured({ value: millilitres(intake) })}</p>
	<label class="field">
		{m.sheet_leftover_amount()}
		<input type="number" inputmode="numeric" min="0" max="5000" step="1" bind:value={leftover} />
	</label>
	<!-- What the Stop is about to write, in the figure the row will show. -->
	<p class="note-line intake">{m.sheet_leftover_intake({ value: millilitres(taken) })}</p>
	<div class="sheet-acts">
		<button type="button" onclick={onclose}>{m.cancel()}</button>
		<button type="button" data-primary="1" onclick={() => onsave(leftover)}>
			{m.sheet_leftover_end()}
		</button>
	</div>
</Sheet>

<style>
	.field {
		margin-bottom: var(--sp-2);
	}
	.intake {
		font-variant-numeric: tabular-nums;
	}
</style>
