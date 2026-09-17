<script lang="ts">
	/* The one confirmation the app has. Every destructive act — deleting an
	   Entry, a Baby, removing a Member, signing out over an unsynced outbox —
	   asks through this dialog and no other surface, so a question always looks
	   the same wherever it is asked (ADR-0044).

	   A question is a modal: it sits centred above whatever asked it — a sheet
	   included — and it takes nothing but the two answers. A dangerous enough
	   act may also ask for a name typed back, which is the only extra it has. */
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		title: string;
		body?: string;
		/** The confirming button's label — the verb, never "OK". */
		confirm: string;
		/** When set, the confirming button stays disabled until this is typed. */
		typed?: string;
		typedLabel?: string;
		onconfirm: () => void | Promise<void>;
		oncancel: () => void;
	}
	let { title, body, confirm, typed, typedLabel, onconfirm, oncancel }: Props = $props();

	let busy = $state(false);
	let typedValue = $state('');
	let cancelButton = $state<HTMLButtonElement | null>(null);

	const armed = $derived(
		typed == null || typedValue.trim().toLowerCase() === typed.trim().toLowerCase()
	);

	/* Focus lands on Cancel: Enter from wherever the thumb was must not delete. */
	onMount(() => cancelButton?.focus());

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			oncancel();
		}
	}

	async function go() {
		if (busy || !armed) return;
		busy = true;
		try {
			await onconfirm();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window {onkeydown} />

<button class="scrim dialog-scrim" type="button" aria-label={m.cancel()} onclick={oncancel}></button>
<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
	<h3 id="dialog-title">{title}</h3>
	{#if body}
		<p>{body}</p>
	{/if}
	{#if typed != null}
		<label>
			{typedLabel}
			<input
				type="text"
				bind:value={typedValue}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				onkeydown={(event) => {
					if (event.key === 'Enter') void go();
				}}
			/>
		</label>
	{/if}
	<div class="dialog-acts">
		<button type="button" bind:this={cancelButton} onclick={oncancel} disabled={busy}>{m.cancel()}</button>
		<button type="button" data-primary="1" onclick={go} disabled={busy || !armed}>{confirm}</button>
	</div>
</div>
