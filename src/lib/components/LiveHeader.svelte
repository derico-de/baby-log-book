<script lang="ts">
	/* The sticky header. Spec §8.4.

	   It carries the due information and stays visible while the timeline scrolls
	   under it, because it is the numbers people check constantly — a two-column
	   grid, sleep on the left, feed on the right, three short rows deep:

	     - Title per column: what the column reports.
	     - State per column: the state word as a caption over its elapsed
	       figure (`asleep` / `5m`, `since last feed` / `22m`). The figure is
	       the loudest thing in the header — loud through size at a normal
	       weight, never through boldness — and the word above it stays small
	       and quiet. The sleep column swaps its word on state (`asleep` /
	       `awake`); while a Sleep runs the Wake Window is simply not shown,
	       because it cannot apply.
	     - Due bar per column: the share of the interval that has run, filled
	       from the left, with the countdown at its left end and the clock face
	       it lands on at its right (`due -55m ······ 21:18`) — the fill is
	       heading for the instant printed at its end. The bar is also the live
	       marker: grey while the column is idle, the type colour while its
	       session runs or it is the next due. A running Sleep has no Wake
	       Window; its bar fills toward the end of what the Sleep is allowed
	       instead — the Nap Length from the instant she went down, or the Day
	       Start once it counts as a Night Sleep (ADR-0046).
	     - Empty state per column: nothing logged means the word alone — no
	       elapsed figure and no bar. Never compute a due instant from nothing.
	     - Overdue shifts once and never again: the full bar takes the brand
	       colour and the label turns to `overdue 20m`. No second colour,
	       no red at 2h, no badge — escalation is nagging with extra steps. */
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

	/** The figures the due bar reads — both column shapes carry them. */
	type Due = {
		dueAt: number | null;
		remainingMs: number | null;
		overdue: boolean;
		overdueMs: number | null;
		progress: number | null;
	};

	/** `-1h19` while it is still coming, `1h19` once it has passed — the word says `overdue`. */
	function countdown(state: Due): string {
		return state.overdue ? duration(state.overdueMs ?? 0) : `-${duration(state.remainingMs ?? 0)}`;
	}

	/* Which column is next due — the Feed and the Wake Window race on the same
	   clock, and the nearer instant wins. It is a separate fact from a running
	   session: while a Sleep runs the Sleep column is live and the Feed column
	   may still be the one about to come up, so both can carry the marker. The
	   running Sleep's own instant is left out of the race — it is the end of
	   her allowance, not something due, and its column is already marked. */
	const nextDue = $derived.by(() => {
		const sleepAt = header?.sleep.running ? null : (header?.sleep.dueAt ?? null);
		const feedAt = header?.feed.dueAt ?? null;
		if (feedAt == null) return sleepAt == null ? null : 'sleep';
		if (sleepAt == null) return 'feed';
		return feedAt <= sleepAt ? 'feed' : 'sleep';
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

<!-- `awake` over `30m` — the state word as a quiet caption, the figure under
     it in the full ink, three steps up the scale and tabular digits so it does
     not jitter as it ticks. A column with nothing logged prints the word
     alone. -->
{#snippet stat(label: string, value: string | null)}
	<div class="live-stat">
		<span class="live-label">{label}</span>
		{#if value != null}<span class="live-num">{value}</span>{/if}
	</div>
{/snippet}

<!-- The bar is two layers of the same two words. The lower one is ink on the
     track; the upper one is the fill — the type colour, or the brand colour
     once overdue — carrying its own ink and clipped to the share that has
     run, so the words stay legible on both sides of the edge in every
     appearance. The joiner (`at`) is read, not seen: the bar's ends say it.
     The word and its figure are apart, so a bar short of room cuts the word
     off and keeps the figure whole. -->
{#snippet lead(word: string, figure: string)}
	<span class="live-lead"><span class="live-word">{word}</span>{' '}<span class="live-count">{figure}</span></span>
{/snippet}

{#snippet bar(word: string, figure: string, joiner: string | null, at: string, progress: number, overdue: boolean)}
	<div class="live-bar" data-over={overdue ? '1' : '0'} style:--p={progress}>
		<span class="live-bar-text">
			{@render lead(word, figure)}<span class="sr-only">{joiner == null ? ' ' : ` ${joiner} `}</span><span class="live-at">{at}</span>
		</span>
		<span class="live-bar-fill" aria-hidden="true">{@render lead(word, figure)}<span class="live-at">{at}</span></span>
	</div>
{/snippet}

<!-- `due -1h19 ······ 21:18`: how long is left at the near end, the clock face
     it lands on at the far end, the fill between them heading for it. Overdue
     turns the label to `overdue`, and the whole bar shifts to the brand
     colour — the one shift, no second one. -->
{#snippet dueBar(state: Due)}
	{@render bar(
		state.overdue ? m.header_overdue_label() : m.header_due_label(),
		countdown(state),
		m.header_due_at(),
		clockTime(state.dueAt ?? 0, zone),
		state.progress ?? 1,
		state.overdue
	)}
{/snippet}

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
			<!-- The column to watch takes the live colour in its bar — a running
			     session, and whichever column is next due; the other keeps the
			     quiet grey fill, so the marker is a colour shift on a bar that is
			     always there — no badge, no extra word, and no text moves or
			     resizes for it. -->
			<div class="live-cell" data-t="sleep" data-live={header.sleep.running || nextDue === 'sleep' ? '1' : '0'}>
				<div class="live-title">{m.header_sleep_title()}</div>
				{#if header.sleep.running}
					<!-- While a Sleep runs there is no Wake Window to show: the bar
					     fills toward the end of the Sleep's allowance instead — the
					     Nap Length, or the Day Start for a Night Sleep — and flips
					     once she has slept past it, exactly as the Feed's does. -->
					{@render stat(m.header_asleep_label(), duration(header.sleep.asleepMs ?? 0))}
					{@render dueBar(header.sleep)}
				{:else if header.sleep.awakeMs != null}
					{@render stat(m.header_awake_label(), duration(header.sleep.awakeMs))}
					{#if header.sleep.dueAt != null}
						{@render dueBar(header.sleep)}
					{/if}
				{:else}
					{@render stat(m.header_no_sleep_yet(), null)}
				{/if}
			</div>

			<div class="live-cell" data-t="feed" data-live={header.feed.running || nextDue === 'feed' ? '1' : '0'}>
				<div class="live-title">{m.header_feed_title()}</div>
				{#if header.feed.elapsedMs == null}
					<!-- Never compute a due instant from nothing. -->
					{@render stat(m.header_no_feed_yet(), null)}
				{:else if header.feed.absolute}
					<!-- Past a day the date moves into the word, so the figure stays a
					     clock time and never outgrows its column. -->
					{@render stat(
						m.header_last_feed_at({ when: dateShort(header.feed.lastAt ?? 0, zone) }),
						clockTime(header.feed.lastAt ?? 0, zone)
					)}
				{:else}
					{@render stat(m.header_since_last_feed(), duration(header.feed.elapsedMs))}
				{/if}
				{#if header.feed.dueAt != null}
					{@render dueBar(header.feed)}
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
