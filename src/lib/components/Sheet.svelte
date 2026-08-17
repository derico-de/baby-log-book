<script lang="ts">
	/* The bottom sheet — one of the six components Pico does not have.

	   Only Feeds, Measurements and Milestones open one, plus the entry detail and
	   the extra filter facets. Everything else in the app is a direct action. */
	import * as m from '$lib/paraglide/messages';

	interface Props {
		title: string;
		onclose: () => void;
		children: import('svelte').Snippet;
	}
	let { title, onclose, children }: Props = $props();

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
