<script lang="ts">
	/* A one-field sheet: the clock time of a direct action, prefilled with now.

	   Starting a Sleep and *She's awake* used to write the current instant
	   silently, which made every catch-up log ("she fell asleep ten minutes
	   ago") a two-step: log now, then reopen the row to correct it. This sheet
	   asks once, up front — confirming the prefill costs one tap, so the common
	   path stays as fast as the silent write was.

	   The sheet hands back the raw `HH:MM`; the caller decides what instant it
	   means, because a start reads backwards from now while an end reads
	   forwards from its Sleep's start. */
	import { app } from '$client/state.svelte';
	import type { FacetKey } from '$domain/filter';
	import { timeInputValue } from '$lib/i18n/format';
	import * as m from '$lib/paraglide/messages';
	import Sheet from './Sheet.svelte';
	import type { IconName } from './Icon.svelte';

	interface Props {
		title: string;
		icon?: IconName;
		t?: FacetKey;
		onsave: (time: string) => void;
		onclose: () => void;
	}
	let { title, icon, t, onsave, onclose }: Props = $props();

	let time = $state(timeInputValue(app.now, app.zone));
</script>

<Sheet {title} {icon} {t} {onclose}>
	<label class="field">
		{m.sheet_time()}
		<input type="time" bind:value={time} />
	</label>
	<div class="sheet-acts">
		<button type="button" onclick={onclose}>{m.cancel()}</button>
		<button type="button" data-primary="1" onclick={() => onsave(time)} disabled={time === ''}>
			{m.save()}
		</button>
	</div>
</Sheet>

<style>
	.field {
		margin-bottom: var(--sp-3);
	}
</style>
