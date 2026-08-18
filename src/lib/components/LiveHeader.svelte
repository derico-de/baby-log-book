<script lang="ts">
	/* The sticky header. Spec §8.4.

	   It carries the due information and stays visible while the timeline scrolls
	   under it, because it is the numbers people check constantly — a two-column
	   grid, sleep on the left, feed on the right:

	     - Big figure per column: the current state's elapsed time. The sleep
	       column swaps its label on state (`asleep` / `awake`); while a Sleep
	       runs the Wake Window is simply not shown, because it cannot apply.
	     - Secondary line per column: the due figure (`nap due in 55m`,
	       `next due in 50m`) — subordinate in size but readable at arm's length.
	     - Empty state per column: nothing logged means no elapsed figure and no
	       due figure. Never compute a due instant from nothing.
	     - Overdue shifts colour once and never again. No second colour, no red at
	       2h, no badge — escalation is nagging with extra steps. */
	import { app } from '$client/state.svelte';
	import { clockTime, dateShort, duration, plural } from '$lib/i18n/format';
	import { ageInMonths, dayBucketOf } from '$domain/time';
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

	/** `Lina · 4 months` — the age rides along with the name (spec §8.4). */
	const babyLine = $derived.by(() => {
		if (!baby) return '';
		const months = ageInMonths(baby.birth_date, app.now, zone);
		const age =
			months === 0
				? m.age_newborn()
				: plural(months, { one: m.baby_age_months_one, few: m.baby_age_months_few, other: m.baby_age_months_other });
		return `${baby.name} · ${age}`;
	});

	/* `last poop today` — a reported fact against the day bucket, not calendar
	   midnight, and deliberately no colour shift: the gap is stated, never
	   escalated. */
	const lastPoop = $derived.by(() => {
		const at = header?.nappies.lastPoopAt;
		if (at == null) return null;
		const bucket = dayBucketOf(at, app.dayStart, zone);
		if (bucket === app.todayKey) return m.header_last_poop_today();
		if (bucket === app.yesterdayKey) return m.header_last_poop_yesterday();
		return m.header_last_poop_on({ when: dateShort(at, zone) });
	});
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
				{babyLine}
			</button>
		{:else}
			<span class="baby">
				<span class="baby-dot">{baby?.name.slice(0, 1) ?? '?'}</span>
				{babyLine}
			</span>
		{/if}
		<div class="head-actions">
			<button class="icon-btn" type="button" onclick={onFilter} aria-label={m.filter_open()}>
				<Icon name="search" />
			</button>
		</div>
	</div>

	{#if header}
		<div class="live-grid">
			<div class="live-cell">
				<div class="live-title">{m.header_sleep_title()}</div>
				{#if header.sleep.running}
					<!-- While a Sleep runs there is no Wake Window to show. -->
					<div class="live-label">{m.header_asleep_label()}</div>
					<span class="live-num">{duration(header.sleep.asleepMs ?? 0)}</span>
					<div class="live-sub">
						{m.header_since_time({ time: clockTime(header.sleep.running.occurred_at, zone) })}
					</div>
				{:else if header.sleep.awakeMs != null}
					<div class="live-label">{m.header_awake_label()}</div>
					<span class="live-num">{duration(header.sleep.awakeMs)}</span>
					{#if header.sleep.dueAt != null}
						<div class="live-sub" data-over={header.sleep.overdue ? '1' : '0'}>
							{header.sleep.overdue
								? m.header_overdue({ over: duration(header.sleep.overdueMs ?? 0) })
								: m.header_nap_due({ left: duration(header.sleep.remainingMs ?? 0) })}
						</div>
					{/if}
				{:else}
					<div class="live-label">{m.header_no_sleep_yet()}</div>
					<span class="live-num">—</span>
				{/if}
			</div>

			<div class="live-cell">
				<div class="live-title">{m.header_feed_title()}</div>
				{#if header.feed.elapsedMs == null}
					<!-- Never compute a due instant from nothing. -->
					<div class="live-label">{m.header_no_feed_yet()}</div>
					<span class="live-num">—</span>
				{:else if header.feed.absolute}
					<!-- Past a day the date moves into the label, so the big figure
					     stays a clock time and never outgrows its column. -->
					<div class="live-label">{m.header_last_feed_at({ when: dateShort(header.feed.lastAt ?? 0, zone) })}</div>
					<span class="live-num">{clockTime(header.feed.lastAt ?? 0, zone)}</span>
				{:else}
					<div class="live-label">{m.header_since_last_feed()}</div>
					<span class="live-num">{duration(header.feed.elapsedMs)}</span>
				{/if}
				{#if header.feed.dueAt != null}
					<div class="live-sub" data-over={header.feed.overdue ? '1' : '0'}>
						{header.feed.overdue
							? m.header_overdue({ over: duration(header.feed.overdueMs ?? 0) })
							: m.header_next_due({ left: duration(header.feed.remainingMs ?? 0) })}
					</div>
				{/if}
			</div>
		</div>

		<div class="due-quiet">
			<span>
				{plural(header.nappies.total, {
					one: m.header_nappies_one,
					few: m.header_nappies_few,
					other: m.header_nappies_other
				})}
			</span>
			{#if lastPoop}
				<span>{lastPoop}</span>
			{/if}
		</div>
	{/if}
</header>
