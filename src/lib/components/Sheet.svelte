<script lang="ts">
	/* The bottom sheet — one of the six components Pico does not have.

	   Only Feeds, Measurements and Milestones open one, plus the entry detail and
	   the extra filter facets. Everything else in the app is a direct action.

	   An open sheet owns the back gesture: opening pushes a shallow history
	   entry, so Android's back button closes the sheet instead of leaving the
	   app. Closing any other way — cancel, save, scrim, Escape — consumes that
	   entry again, so history ends up exactly where it started. */
	import { onMount } from 'svelte';
	import { pushState } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		title: string;
		onclose: () => void;
		children: import('svelte').Snippet;
	}
	let { title, onclose, children }: Props = $props();

	onMount(() => {
		/* Outside the SvelteKit router — component tests mount this bare —
		   there is no history to own, and the sheet simply has no back entry. */
		try {
			pushState('', { sheet: true });
		} catch {
			return;
		}
		let inHistory = true;
		const pop = () => {
			inHistory = false;
			onclose();
		};
		window.addEventListener('popstate', pop);
		return () => {
			window.removeEventListener('popstate', pop);
			if (inHistory) history.back();
		};
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<button class="scrim" type="button" aria-label={m.close()} onclick={onclose}></button>
<div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
	<h3>{title}</h3>
	{@render children()}
</div>
