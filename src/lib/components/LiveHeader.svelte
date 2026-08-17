<script lang="ts">
	/* The sticky header. Spec §8.4.

	   It carries the due information and stays visible while the timeline scrolls
	   under it, because it is the number people check constantly:

	     - Dominant: `since last feed 2h10` / `next due in 50m`
	     - Quiet line, swapping on state: awake / down after, or asleep while a
	       Sleep runs — the Wake Window is simply not shown when it cannot apply.
	     - Empty state: no Feed logged yet means no elapsed figure and no due
	       figure. Never compute a due instant from nothing.
	     - Overdue shifts colour once and never again. No second colour, no red at
	       2h, no badge — escalation is nagging with extra steps. */
	import { app } from '$client/state.svelte';
	import { clockTime, dateShort, duration, plural } from '$lib/i18n/format';
	import { withinLastDay } from '$domain/time';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';

	interface Props {
		onFilter: () => void;
	}
	let { onFilter }: Props = $props();

	const header = $derived(app.header);
	const baby = $derived(app.baby);
	const babies = $derived(app.liveBabies);
	const zone = $derived(app.zone);

	function absoluteLast(at: number): string {
		const label = withinLastDay(at, app.now) ? '' : `${dateShort(at, zone)} `;
		return `${label}${clockTime(at, zone)}`;
	}
</script>

<header class="head">
	<div class="head-top">
		{#if babies.length > 1}
			<button
				class="baby"
				type="button"
				onclick={() => {
					const index = babies.findIndex((b) => b.id === baby?.id);
					void app.selectBaby(babies[(index + 1) % babies.length].id);
				}}
			>
				<span class="baby-dot">{baby?.name.slice(0, 1) ?? '?'}</span>
				{baby?.name}
			</button>
		{:else}
			<span class="baby">
				<span class="baby-dot">{baby?.name.slice(0, 1) ?? '?'}</span>
				{baby?.name ?? ''}
			</span>
		{/if}
		<div class="head-actions">
			<button class="icon-btn" type="button" onclick={onFilter} aria-label={m.filter_open()}>
				<Icon name="search" />
			</button>
		</div>
	</div>

	{#if header}
		{#if header.feed.elapsedMs == null}
			<!-- Never compute a due instant from nothing. -->
			<div class="due-label">{m.header_no_feed_yet()}</div>
			<span class="due-hero">—</span>
		{:else if header.feed.absolute}
			<div class="due-label">{m.header_last_feed_at({ when: '' }).trim()}</div>
			<span class="due-hero">{absoluteLast(header.feed.lastAt ?? 0)}</span>
		{:else}
			<div class="due-label">{m.header_since_last_feed()}</div>
			<span class="due-hero">{duration(header.feed.elapsedMs)}</span>
		{/if}

		{#if header.feed.dueAt != null}
			<div class="due-next" data-over={header.feed.overdue ? '1' : '0'}>
				{header.feed.overdue
					? m.header_overdue({ over: duration(header.feed.overdueMs ?? 0) })
					: m.header_next_due({ left: duration(header.feed.remainingMs ?? 0) })}
			</div>
		{/if}

		<div class="due-quiet">
			{#if header.sleep.running}
				<!-- While a Sleep runs there is no Wake Window to show. -->
				<span>{m.header_asleep({ elapsed: duration(header.sleep.asleepMs ?? 0) })}</span>
			{:else if header.sleep.awakeMs != null}
				<span data-over={header.sleep.overdue ? '1' : '0'}>
					{m.header_awake({ elapsed: duration(header.sleep.awakeMs) })}
				</span>
				{#if header.sleep.dueAt != null}
					<span data-over={header.sleep.overdue ? '1' : '0'}>
						{header.sleep.overdue
							? m.header_overdue({ over: duration(header.sleep.overdueMs ?? 0) })
							: m.header_down_after({ target: duration(header.sleep.remainingMs ?? 0) })}
					</span>
				{/if}
			{/if}
			<span>
				{plural(header.nappies.total, {
					one: m.header_nappies_one,
					few: m.header_nappies_few,
					other: m.header_nappies_other
				})}
			</span>
		</div>
	{/if}
</header>
