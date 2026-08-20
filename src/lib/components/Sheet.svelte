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
	import type { FacetKey } from '$domain/filter';
	import * as m from '$lib/paraglide/messages';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		title: string;
		/** A typed sheet leads with its type's glyph disc (issue 24); the
		    filter sheet passes neither and keeps the bare title. */
		icon?: IconName;
		t?: FacetKey;
		onclose: () => void;
		children: import('svelte').Snippet;
	}
	let { title, icon, t, onclose, children }: Props = $props();

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
	{#if icon}
		<header class="sheet-head">
			<span class="glyph" data-t={t}><Icon name={icon} /></span>
			<h3>{title}</h3>
		</header>
	{:else}
		<h3>{title}</h3>
	{/if}
	{@render children()}
</div>
