<script lang="ts">
  import ImpeccableLiveRoot from '$lib/impeccable/ImpeccableLiveRoot.svelte';
	/* The shell. Everything is drawn client-side from the replica; the server
	   renders no UI (ADR-0012). */
	import '../app.css';
	import { page } from '$app/state';
	import { app } from '$client/state.svelte';
	import { configurePwa, registerWorker, watchForColdLaunch, watchInstallPrompt } from '$client/pwa';
	import { requestUpdate } from '$client/pwa';
	import { activeLocale } from '$lib/i18n/locale.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();

	const onClaim = $derived(page.url.pathname.startsWith('/claim'));

	$effect(() => {
		/* What defers a reload is a running Sleep that is not yet stale.

		   A Stale Session stops counting, which is what closes the deadlock a
		   forgotten timer would otherwise create (spec §6.6, §9.3) — and a running
		   *Feed* is deliberately not counted at all: nothing downstream depends on
		   when a Feed ended, staleness is a Sleep concept, so a Feed nobody stopped
		   would block every update forever while costing nothing to reload
		   through (spec §3.3). */
		configurePwa({
			hasLiveSession: () => app.runningSleep != null && !app.stale.stale
		});
		watchForColdLaunch();
		watchInstallPrompt();
		void app.start().then(() => {
			/* The worker registers only after a Claim has succeeded — which, on a
			   Device that already has an identity, is true by the time we get here. */
			if (app.identity) void registerWorker();
		});
	});

	/* Detection piggybacks on sync; nothing else polls. */
	$effect(() => {
		if (app.sync.updateAvailable) void requestUpdate();
	});
</script>

<svelte:head>
	<title>{m.app_name()}</title>
</svelte:head>

<!-- One root key, so switching the language re-renders every string without a
     reload: offline, a reload is answered from the precache and a cached document
     has the old language baked into its markup (spec §9.5). -->
{#key activeLocale()}
	{#if onClaim}
		<!-- impeccable-live-svelte-start -->
<ImpeccableLiveRoot />
<!-- impeccable-live-svelte-end -->
{@render children()}
	{:else}
		<div class="app">
			{@render children()}
			<TabBar />
			<Toast />
		</div>
	{/if}
{/key}
