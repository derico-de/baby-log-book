<script lang="ts">
	/* Undo, not confirm — decided explicitly (spec §8.5). Corrections are already
	   first-class: any Member may fix any Member's Entry and the history stays
	   visible, so a confirm step would tax every nappy every night to prevent a
	   mistake that is cheap to correct. */
	import { app } from '$client/state.svelte';
	import * as m from '$lib/paraglide/messages';

	const toast = $derived(app.toast);
</script>

{#if toast}
	<div class="toast" role="status">
		<span>{toast.text}</span>
		{#if toast.undo}
			<button
				type="button"
				onclick={async () => {
					const undo = toast.undo;
					app.dismissToast();
					await undo?.();
				}}>{m.undo()}</button
			>
		{/if}
	</div>
{/if}
