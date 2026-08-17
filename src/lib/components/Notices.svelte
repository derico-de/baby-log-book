<script lang="ts">
	/* The passive lines. Spec §5.7, §9.3.

	   Nothing here interrupts. The user never sees a conflict, never gets a dialog,
	   and never gets a prompt for an ordinary version — because there is nothing to
	   decide. Being stuck is said in both directions, and the words carry the
	   weight: a banner that implied the *device* was at fault when the server is
	   older would send a grandparent hunting through Settings for a fix that does
	   not exist. */
	import { app } from '$client/state.svelte';
	import { plural } from '$lib/i18n/format';
	import { installBannerDismissed, dismissInstallBanner } from '$client/device';
	import { requestUpdate, promptInstall, canPromptInstall, isStandalone } from '$client/pwa';
	import * as m from '$lib/paraglide/messages';

	const sync = $derived(app.sync);
	let installHidden = $state(false);
	let installed = $state(false);

	$effect(() => {
		installHidden = installBannerDismissed();
		installed = isStandalone();
	});

	/* A dismissible banner after the Device has claimed *and* logged its first
	   Entry, so a grandparent's first screen is not a request. */
	const showInstall = $derived(
		!installed && !installHidden && app.loggedHere && sync.state !== 'removed'
	);
</script>

{#if sync.state === 'removed'}
	<p class="notice">{m.sync_removed()}</p>
{:else if sync.state === 'client_behind'}
	<p class="notice">
		{m.sync_client_behind()}
		<!-- Update now reloads immediately, Live Session or not: the rule is never
		     reload a screen nobody asked to reload, and they asked. -->
		<button type="button" onclick={() => void requestUpdate({ force: true })}>{m.sync_update_now()}</button>
	</p>
{:else if sync.state === 'client_ahead'}
	<p class="notice">{m.sync_client_ahead()}</p>
{:else if sync.state === 'signed_out'}
	<p class="notice">
		{plural(sync.waiting, {
			one: m.sync_signed_out_one,
			few: m.sync_signed_out_few,
			other: m.sync_signed_out_other
		})}
	</p>
{:else if sync.state === 'catching_up'}
	<p class="notice">{m.sync_catching_up()}</p>
{:else if sync.state === 'offline'}
	<p class="notice">{m.sync_offline()}</p>
{/if}

{#if sync.refused.length > 0}
	<p class="notice">{m.sync_refused({ reason: sync.refused[sync.refused.length - 1].reason })}</p>
{/if}

{#if showInstall}
	<p class="notice">
		{m.install_banner()}
		{#if canPromptInstall()}
			<button type="button" onclick={() => void promptInstall()}>{m.install_banner_yes()}</button>
		{:else}
			<span class="ios">{m.settings_install_ios()}</span>
		{/if}
		<button
			type="button"
			onclick={() => {
				dismissInstallBanner();
				installHidden = true;
			}}>{m.install_banner_no()}</button
		>
	</p>
{/if}

<style>
	.ios {
		color: var(--ink-2);
	}
</style>
