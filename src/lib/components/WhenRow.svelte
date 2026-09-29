<script lang="ts">
	/* The time a new Entry is logged at, with the date and the note behind a
	   chip each: most things are logged the day they happen, and most need no
	   note. A chip turns into its field where it stood, so the time never moves
	   under the thumb; once the date takes the slot, the note goes below. */
	import { app } from '$client/state.svelte';
	import { dateInputValue } from '$lib/i18n/format';
	import { loggedAt } from '$domain/time';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';

	interface Props {
		time: string;
		/** Null until the Member asks for it; the time then reads backwards from now. */
		date?: string | null;
		/** Left unbound on a sheet that takes no note. */
		note?: string;
	}
	let { time = $bindable(), date = $bindable(null), note = $bindable() }: Props = $props();

	let showNote = $state(false);
	const takesNote = $derived(note !== undefined);
	const today = $derived(dateInputValue(app.now, app.zone));

	/* Opens on the date the time already means, so asking for it moves nothing:
	   23:45 typed at 00:20 shows yesterday. */
	function showDate() {
		date = dateInputValue(loggedAt(time, null, app.now, app.zone) ?? app.now, app.zone);
	}
</script>

<div class="field when">
	<label class="time">
		{m.sheet_time()}
		<input type="time" bind:value={time} />
	</label>
	{#if date != null}
		<label class="date">
			{m.sheet_date()}
			<input type="date" bind:value={date} max={today} />
		</label>
	{:else}
		<div class="adds">
			{#if takesNote && !showNote}
				<button class="chip" type="button" aria-label={m.note_add()} onclick={() => (showNote = true)}>
					<Icon name="plus" />
					{m.note()}
				</button>
			{/if}
			<button class="chip" type="button" aria-label={m.date_add()} onclick={showDate}>
				<Icon name="plus" />
				{m.sheet_date()}
			</button>
		</div>
	{/if}
</div>

{#if takesNote}
	{#if showNote}
		<label class="field">
			{m.note()}
			<input type="text" bind:value={note} />
		</label>
	{:else if date != null}
		<div class="field">
			<button class="chip" type="button" aria-label={m.note_add()} onclick={() => (showNote = true)}>
				<Icon name="plus" />
				{m.note()}
			</button>
		</div>
	{/if}
{/if}

<style>
	.field {
		margin-bottom: var(--sp-3);
	}
	/* The time takes what the chips leave, never less than a 12-hour
	   `02:58 PM` needs, and a date its three fields and icon; where that does
	   not fit, the chips or the date drop below whole rather than clip. */
	.when {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--sp-3);
	}
	.time {
		flex: 1 1 0;
		min-width: 8.75rem;
	}
	.date {
		flex: 1.3 1 0;
		min-width: 9.75rem;
	}
	/* Keeps the chips on the time input's baseline. */
	.adds {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
	}
	.adds .chip {
		gap: var(--sp-1);
		padding: 0 var(--sp-2);
	}
</style>
