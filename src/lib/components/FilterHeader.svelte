<script lang="ts">
	/* The filter takes the header's place. Spec §8.7, variant A.

	   D1 spends its only hue on actions, so "this timeline is filtered" had to be
	   said without colour — and the winning answer says it with the largest element
	   on the screen: the live hero figure is gone and inverted ink stands where it
	   was. Same screen, same FAB, no mode.

	   The sticky header does not survive filtering: the live elapsed-vs-target
	   figures are about *now*, and there is no version of them that is correct in
	   a historical view. */
	import { app } from '$client/state.svelte';
	import { FACET_KEYS, type FacetKey } from '$domain/filter';
	import { resultsOfTotal } from '$lib/i18n/format';
	import * as m from '$lib/paraglide/messages';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		onMore: () => void;
	}
	let { onMore }: Props = $props();

	const FACET_GLYPH: Record<FacetKey, IconName> = {
		feed: 'feed',
		sleep: 'sleep',
		nappy: 'nappy',
		meal: 'meal',
		measure: 'measure',
		milestone: 'flag'
	};

	const FACET_LABEL: Record<FacetKey, () => string> = {
		feed: () => m.facet_feed(),
		sleep: () => m.facet_sleep(),
		nappy: () => m.facet_nappy(),
		meal: () => m.facet_meal(),
		measure: () => m.facet_measure(),
		milestone: () => m.facet_milestone()
	};

	/** Open but unarmed is a real state: the search icon swaps the header in
	    before the first chip is pressed, and the hint line does the teaching. */
	const armed = $derived(app.filtered);
	const count = $derived(app.visible.length);

	/** What the inverted header says it is showing. */
	const title = $derived.by(() => {
		const f = app.filter;
		const parts: string[] = [];
		if (f.foodId) parts.push(app.foodName(f.foodId));
		if (f.types.length > 0) parts.push(f.types.map((type) => FACET_LABEL[type]()).join(' + '));
		if (f.memberId) parts.push(m.filter_by({ who: app.memberName(f.memberId) ?? m.unknown_member() }));
		if (f.text.trim()) parts.push(`“${f.text.trim()}”`);
		if (f.period === 'last7') parts.push(m.period_last7());
		if (f.period === 'last30') parts.push(m.period_last30());
		return parts.length > 0 ? parts.join(' · ') : m.filter_all();
	});

	function toggle(type: FacetKey) {
		const types = app.filter.types.includes(type)
			? app.filter.types.filter((t) => t !== type)
			: [...app.filter.types, type];
		app.filter = { ...app.filter, types };
	}
</script>

<header class="head head-filter">
	<div class="filter-top">
		<div class="filter-what">
			<div class="filter-kicker">{armed ? m.filter_kicker() : m.filter_kicker_open()}</div>
			<div class="filter-title">{title}</div>
			<div class="filter-count">
				{armed ? resultsOfTotal(count, app.timelineTotal) : m.filter_hint()}
			</div>
		</div>
		<button class="clear-btn" type="button" onclick={() => app.clearFilter()}>
			<Icon name="x" />
			{m.filter_clear()}
		</button>
	</div>

	<div class="chips" role="group" aria-label={m.filter_open()}>
		<!-- An armed Food or Member facet stands first in the rail as a removable
		     chip, so what the sheet switched on can be switched off without
		     reopening it. -->
		{#if app.filter.foodId}
			<button
				class="chip"
				type="button"
				aria-pressed="true"
				onclick={() => (app.filter = { ...app.filter, foodId: null })}
			>
				{app.foodName(app.filter.foodId)}
				<Icon name="x" />
			</button>
		{/if}
		{#if app.filter.memberId}
			<button
				class="chip"
				type="button"
				aria-pressed="true"
				onclick={() => (app.filter = { ...app.filter, memberId: null })}
			>
				{app.memberName(app.filter.memberId) ?? m.unknown_member()}
				<Icon name="x" />
			</button>
		{/if}
		{#each FACET_KEYS as key (key)}
			<button
				class="chip"
				type="button"
				data-t={key}
				aria-pressed={app.filter.types.includes(key)}
				onclick={() => toggle(key)}
			>
				<Icon name={FACET_GLYPH[key]} />
				{FACET_LABEL[key]()}
			</button>
		{/each}
		<button class="chip" type="button" onclick={onMore}>
			<Icon name="sliders" />
			{m.filter_more()}
		</button>
	</div>
</header>
