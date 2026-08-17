<script lang="ts">
	/* Stats — a trend screen and only that (spec §9.1).

	   The home screen already answers *when did she last eat*; the timeline already
	   answers *what happened yesterday*. The only question left is *is this getting
	   better*: reassurance, not reporting and not handover.

	   A rolling seven days with no controls at all, and no navigation to earlier
	   weeks in v1 — browsing aggregates is the v3 question, and inventing that
	   navigation now means inventing it twice. */
	import { app } from '$client/state.svelte';
	import { statsFor } from '$domain/stats';
	import * as m from '$lib/paraglide/messages';
	import Notices from '$lib/components/Notices.svelte';
	import StatCard from '$lib/components/StatCard.svelte';

	const cards = $derived.by(() => {
		const baby = app.baby;
		if (!baby) return [];
		return statsFor({
			entries: app.babyEntries,
			babyId: baby.id,
			now: app.now,
			dayStart: app.dayStart,
			zone: app.zone
		});
	});

	const babies = $derived(app.liveBabies);
</script>

<section class="screen">
	<header class="head">
		<div class="head-top">
			<h1 class="screen-title">{m.stats_title()}</h1>
			{#if babies.length > 1}
				<!-- The selector appears only when a second Baby exists. -->
				<button
					class="baby"
					type="button"
					onclick={() => {
						const index = babies.findIndex((b) => b.id === app.baby?.id);
						void app.selectBaby(babies[(index + 1) % babies.length].id);
					}}
				>
					<span class="baby-dot">{app.baby?.name.slice(0, 1)}</span>
					{app.baby?.name}
				</button>
			{/if}
		</div>
	</header>

	<Notices />

	<div class="scroll">
		{#if cards.length === 0}
			<!-- A card appears only when its entry type has data in the window, which
			     makes age-appropriateness free: no age logic, no settings, no empty
			     states per card. -->
			<div class="empty">
				<b>{m.stats_none()}</b>
				{m.stats_none_hint()}
			</div>
		{:else}
			<div class="cards">
				{#each cards as card (card.kind)}
					<StatCard {card} />
				{/each}
			</div>
		{/if}
		<div class="pad-bottom"></div>
	</div>
</section>
