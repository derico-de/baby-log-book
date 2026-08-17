<script lang="ts">
	/* The other four facets. Spec §8.7.

	   Free text is a substring scan over the local replica, not an index: the whole
	   log is already on the Device and a month is ~240 entries. The date period is
	   three preset chips and deliberately no date picker in v1. */
	import { app } from '$client/state.svelte';
	import type { Period } from '$domain/filter';
	import * as m from '$lib/paraglide/messages';
	import Sheet from './Sheet.svelte';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	const PERIODS: Array<[Period, () => string]> = [
		['anytime', () => m.period_anytime()],
		['last7', () => m.period_last7()],
		['last30', () => m.period_last30()]
	];
</script>

<Sheet title={m.filter_open()} {onclose}>
	<label class="field">
		{m.filter_text()}
		<input
			type="search"
			value={app.filter.text}
			oninput={(event) => (app.filter = { ...app.filter, text: event.currentTarget.value })}
		/>
	</label>

	<h4>{m.filter_period()}</h4>
	<div class="chips">
		{#each PERIODS as [value, label] (value)}
			<button
				class="chip"
				type="button"
				aria-pressed={app.filter.period === value}
				onclick={() => (app.filter = { ...app.filter, period: value })}
			>
				{label()}
			</button>
		{/each}
	</div>

	<h4>{m.filter_member()}</h4>
	<div class="chips">
		<button
			class="chip"
			type="button"
			aria-pressed={app.filter.memberId == null}
			onclick={() => (app.filter = { ...app.filter, memberId: null })}
		>
			{m.filter_anyone()}
		</button>
		{#each app.members as member (member.id)}
			<button
				class="chip"
				type="button"
				aria-pressed={app.filter.memberId === member.id}
				onclick={() => (app.filter = { ...app.filter, memberId: member.id })}
			>
				{member.display_name}
			</button>
		{/each}
	</div>

	{#if app.liveFoods.length > 0}
		<h4>{m.filter_food()}</h4>
		<div class="chips">
			<button
				class="chip"
				type="button"
				aria-pressed={app.filter.foodId == null}
				onclick={() => (app.filter = { ...app.filter, foodId: null })}
			>
				{m.filter_any_food()}
			</button>
			{#each app.liveFoods as food (food.id)}
				<button
					class="chip"
					type="button"
					aria-pressed={app.filter.foodId === food.id}
					onclick={() => (app.filter = { ...app.filter, foodId: food.id })}
				>
					{food.name}
				</button>
			{/each}
		</div>
	{/if}

	<div class="sheet-acts">
		<button type="button" onclick={() => app.clearFilter()}>{m.filter_clear()}</button>
		<button type="button" data-primary="1" onclick={onclose}>{m.done()}</button>
	</div>
</Sheet>

<style>
	.field {
		padding: 0 var(--sp-4);
		margin-bottom: var(--sp-3);
	}
</style>
