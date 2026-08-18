<script lang="ts">
	/* The stale-Sleep banner. Spec §8.6.

	   A banner in the timeline at the threshold, offering *She woke at…* / *Still
	   asleep* / *Delete*, with the timeline still usable behind it. Not a modal:
	   blocking the timeline until answered is hostile at exactly the moment it
	   fires, and it punishes the person who opens the app rather than the one who
	   forgot to press stop.

	   The app never acts on its own. Auto-close was rejected: ending a Sleep at a
	   guess would preserve more records, but every revision is attributed to a
	   Member, and an app-authored revision is a concept the model should not gain
	   for this.

	   The picker defaults to her usual wake time, not to now. "Now" is the honest
	   we-know-nothing answer and is almost always wrong — she woke hours ago, which
	   is why the banner appeared. */
	import { app } from '$client/state.svelte';
	import { endSleep, deleteEntry } from '$client/mutate';
	import { usualWakeInstant } from '$domain/sleep';
	import { clockTime, timeInputValue } from '$lib/i18n/format';
	import { wallTimeAtOrAfter } from '$domain/time';
	import type { Entry } from '$domain/types';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		sleep: Entry;
	}
	let { sleep }: Props = $props();

	let picking = $state(false);
	let busy = $state(false);

	const zone = $derived(app.zone);
	const suggested = $derived(
		usualWakeInstant(sleep, app.babyEntries, app.now, { dayStart: app.dayStart, zone })
	);
	let woke = $state('');

	$effect(() => {
		if (picking && woke === '') woke = timeInputValue(suggested, zone);
	});

	async function confirm() {
		if (busy) return;
		/* The first time the clock read this after she went down — not today, and
		   never before the Sleep started: the banner fires hours after she woke,
		   and the Sleep it is closing usually crossed a midnight. */
		const at = wallTimeAtOrAfter(woke, sleep.occurred_at, zone);
		if (at == null) return;
		busy = true;
		await app.edit((w) => endSleep(w, sleep.id, at), { text: m.toast_sleep_ended() });
		busy = false;
		picking = false;
	}

	async function remove() {
		if (busy) return;
		busy = true;
		await app.edit((w) => deleteEntry(w, sleep.id), { text: m.toast_deleted({ what: m.type_sleep() }) });
		busy = false;
	}
</script>

<div class="banner" role="region" aria-label={m.stale_title()}>
	<div class="banner-q">{m.stale_title()}</div>
	<div class="banner-sub">{m.stale_sub({ since: clockTime(sleep.occurred_at, zone) })}</div>

	{#if picking}
		<label class="field">
			{m.stale_woke_when()}
			<input type="time" bind:value={woke} />
		</label>
		<div class="banner-acts">
			<button type="button" data-quiet="1" onclick={() => (picking = false)}>{m.cancel()}</button>
			<button type="button" data-primary="1" onclick={confirm} disabled={busy}>{m.save()}</button>
		</div>
	{:else}
		<div class="banner-acts">
			<button type="button" data-primary="1" onclick={() => (picking = true)}>{m.stale_woke()}</button>
			<!-- It prompts, and it stops asking: this restarts the clock, and the
			     Sleep stays running because it is genuine. -->
			<button type="button" onclick={() => void app.ackStale(sleep.id)}>{m.stale_still()}</button>
			<button type="button" data-quiet="1" onclick={remove}>{m.stale_delete()}</button>
		</div>
	{/if}
</div>

<style>
	.field {
		display: block;
		margin-bottom: var(--sp-3);
	}
</style>
