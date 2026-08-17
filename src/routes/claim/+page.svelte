<script lang="ts">
	/* The claim page. ADR-0005, spec §6.1 and §9.3.

	   An ordinary route in the same shell — and the one that decides whether this
	   browser becomes a Device. The link is **claimed by the POST behind this
	   button, never by the GET that fetched the page**: every messenger fetches a
	   URL server-side to build its preview card, so a link that claimed on GET
	   would be burnt by the bot before the recipient ever saw it.

	   The worker registers only after a Claim succeeds — then `persist()`, then the
	   initial sync. A Device becomes offline-capable at the moment it becomes a
	   Device. */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { deviceId, deviceZone } from '$client/device';
	import { persistStorage, registerWorker } from '$client/pwa';
	import * as m from '$lib/paraglide/messages';

	type Preview =
		| { ok: true; kind: 'invite' | 'rescue' | 'bootstrap'; display_name: string | null; expires_at: number }
		| { ok: false; reason: 'unknown' | 'expired' | 'used' | 'burnt' };

	let preview = $state<Preview | null>(null);
	let name = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);

	const token = $derived(page.url.searchParams.get('t') ?? '');

	$effect(() => {
		if (token === '') {
			preview = { ok: false, reason: 'unknown' };
			return;
		}
		void fetch(`/api/claim?t=${encodeURIComponent(token)}`)
			.then((response) => response.json())
			.then((body: Preview) => {
				preview = body;
			})
			.catch(() => {
				preview = { ok: false, reason: 'unknown' };
			});
	});

	const reasonText = (reason: 'unknown' | 'expired' | 'used' | 'burnt' | 'rate_limited' | 'invalid') =>
		reason === 'expired'
			? m.claim_expired()
			: reason === 'used'
				? m.claim_used()
				: reason === 'burnt'
					? m.claim_burnt()
					: reason === 'rate_limited'
						? m.claim_rate_limited()
						: reason === 'invalid'
							? m.claim_invalid()
							: m.claim_unknown();

	async function claim() {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const response = await fetch('/api/claim', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					token,
					device_id: deviceId(),
					/* On first boot this becomes the Household Zone. */
					zone: deviceZone(),
					display_name: name.trim() || undefined
				})
			});
			const body = (await response.json()) as { ok: boolean; reason?: string };
			if (!response.ok || !body.ok) {
				error = reasonText((body.reason ?? 'invalid') as 'invalid');
				busy = false;
				return;
			}
			done = true;
			/* One line, and the actual mitigation against a browser evicting an
			   undrained outbox. */
			await persistStorage();
			await registerWorker();
			await goto('/', { invalidateAll: true });
		} catch {
			error = m.claim_unknown();
			busy = false;
		}
	}
</script>

<main class="claim">
	<article class="claim-card">
		{#if preview == null}
			<p>{m.claim_loading()}</p>
		{:else if !preview.ok}
			<h1>{m.app_name()}</h1>
			<p>{reasonText(preview.reason)}</p>
		{:else if done}
			<h1>{m.claim_ready()}</h1>
			<a href="/" role="button">{m.claim_open()}</a>
		{:else}
			<h1>
				{preview.kind === 'bootstrap'
					? m.claim_title_bootstrap()
					: preview.kind === 'rescue'
						? m.claim_title_rescue()
						: m.claim_title_invite({ household: m.app_name() })}
			</h1>
			<p>
				{preview.kind === 'bootstrap'
					? m.claim_bootstrap_body()
					: preview.kind === 'rescue'
						? m.claim_rescue_body()
						: m.claim_invite_body({ name: preview.display_name ?? '' })}
			</p>

			{#if preview.kind === 'bootstrap'}
				<!-- An Invite already carries the name an Owner typed; the first Owner
				     has to type their own. -->
				<label>
					{m.claim_name()}
					<input type="text" bind:value={name} maxlength="200" autocomplete="name" />
					<small>{m.claim_name_hint()}</small>
				</label>
			{/if}

			{#if error}<p role="alert">{error}</p>{/if}

			<button type="button" onclick={claim} disabled={busy}>
				{busy ? m.claim_working() : m.claim_button()}
			</button>
		{/if}
	</article>
</main>
