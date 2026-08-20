<script lang="ts">
	/* One trend card. Spec §9.1.

	   Every card states its numbers as text with the bars as the secondary read: at
	   3am a shape you have to interpret is worse than a sentence, and it is the
	   accessible version for free. Eight bars, two dashed axis lines and a
	   tapped day read back as text are still not a charting problem, so it all
	   stays hand-rolled and there is no charting dependency.

	   Today is the eighth bar, drawn visibly in progress, and it is excluded from
	   the delta. */
	import { app } from '$client/state.svelte';
	import { dateShort, decimal, duration, millilitres, plural, weekdayShort } from '$lib/i18n/format';
	import { dayStartInstant, MS } from '$domain/time';
	import type { FeedsSecondary, NappiesSecondary, SleepSecondary, SolidsSecondary, StatsCard } from '$domain/stats';
	import * as m from '$lib/paraglide/messages';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		card: StatsCard;
	}
	let { card }: Props = $props();

	const GLYPH: Record<StatsCard['kind'], IconName> = {
		sleep: 'sleep',
		feeds: 'feed',
		nappies: 'nappy',
		solids: 'meal'
	};

	const NAME: Record<StatsCard['kind'], () => string> = {
		sleep: () => m.stats_card_sleep(),
		feeds: () => m.stats_card_feeds(),
		nappies: () => m.stats_card_nappies(),
		solids: () => m.stats_card_solids()
	};

	const isDuration = $derived(card.kind === 'sleep');

	/* The axis ceiling is the next even hour (Sleep) or even count above the
	   tallest bar, so both tick labels are amounts a person would actually say
	   — at the price of the tallest bar stopping a little short of the top
	   line. */
	const unit = $derived(isDuration ? MS.hour : 1);
	const axisMax = $derived.by(() => {
		const top = Math.max(unit, ...card.bars.map((b) => b.value));
		return 2 * unit * Math.ceil(top / (2 * unit));
	});

	/* The tapped day. Tapping it again lets go. */
	let selectedKey = $state<string | null>(null);
	const selected = $derived(card.bars.find((b) => b.key === selectedKey) ?? null);

	const value = (n: number) => (isDuration ? duration(n) : decimal(n, Number.isInteger(n) ? 0 : 1));

	const delta = $derived.by(() => {
		if (card.delta == null) return null;
		const rounded = isDuration ? Math.round(card.delta / 60_000) * 60_000 : Math.round(card.delta * 10) / 10;
		if (rounded === 0) return m.stats_delta_flat();
		const shown = value(Math.abs(rounded));
		return rounded > 0 ? m.stats_delta_up({ value: shown }) : m.stats_delta_down({ value: shown });
	});

	const secondary = $derived.by(() => {
		switch (card.kind) {
			case 'sleep': {
				const s = card.secondary as SleepSecondary;
				return [
					m.stats_longest({ value: duration(s.longestMs) }),
					m.stats_night_naps({ night: duration(s.nightMs), naps: duration(s.napMs) })
				];
			}
			case 'feeds': {
				const s = card.secondary as FeedsSecondary;
				/* Volume cannot be the primary bar: a breastfed Baby has no
				   millilitres. */
				return s.volumeMlToday == null ? [] : [m.stats_volume({ value: millilitres(s.volumeMlToday) })];
			}
			case 'nappies': {
				const s = card.secondary as NappiesSecondary;
				return [m.stats_split({ pee: String(s.peeToday), poop: String(s.poopToday) })];
			}
			case 'solids': {
				const s = card.secondary as SolidsSecondary;
				return s.newFoods === 0
					? []
					: [
							plural(s.newFoods, {
								one: m.stats_new_foods_one,
								few: m.stats_new_foods_few,
								other: m.stats_new_foods_other
							})
						];
			}
		}
	});

	const label = (key: string, isToday: boolean) =>
		isToday ? m.stats_bar_today() : weekdayShort(dayStartInstant(key, app.dayStart, app.zone), app.zone);

	/* The tapped day as a sentence — the same text-first rule the card itself
	   follows. A Feeds day states its volume too, once bottles exist. */
	const detail = $derived.by(() => {
		if (!selected) return null;
		const day = selected.isToday
			? m.stats_bar_today()
			: dateShort(dayStartInstant(selected.key, app.dayStart, app.zone), app.zone);
		const amount =
			selected.volumeMl == null
				? value(selected.value)
				: `${value(selected.value)} · ${millilitres(selected.volumeMl)}`;
		return m.stats_day_detail({ day, value: amount });
	});
</script>

<article class="card">
	<div class="card-head">
		<div class="card-name"><Icon name={GLYPH[card.kind]} />{NAME[card.kind]()}</div>
		{#if delta}<div class="card-delta">{delta}</div>{/if}
	</div>

	<div class="card-value">
		{value(card.today)}
		<!-- No average on the first logged day: until a complete logged day
		     exists there is nothing to state, and a made-up zero would read as
		     "worse than every day before". -->
		{#if card.average != null}
			<small>{m.stats_today_avg({ avg: value(card.average) })}</small>
		{/if}
	</div>

	{#each secondary as line (line)}
		<div class="card-delta">{line}</div>
	{/each}

	<div class="bars">
		{#each [1, 0.5] as tick (tick)}
			<div class="gridline" style={`bottom:${tick * 100}%`} aria-hidden="true">
				<span>{value(axisMax * tick)}</span>
			</div>
		{/each}
		{#each card.bars as bar (bar.key)}
			<!-- The whole column is the tap target — the bar itself can be three
			     pixels tall. -->
			<button
				type="button"
				class="bar-hit"
				aria-pressed={selectedKey === bar.key}
				aria-label={`${label(bar.key, bar.isToday)}: ${value(bar.value)}`}
				onclick={() => (selectedKey = selectedKey === bar.key ? null : bar.key)}
			>
				<span
					class="bar"
					data-today={bar.isToday ? '1' : '0'}
					data-selected={selectedKey === bar.key ? '1' : '0'}
					style={`height:${Math.max(6, (bar.value / axisMax) * 100)}%`}
				></span>
			</button>
		{/each}
	</div>
	<div class="bar-labels">
		{#each card.bars as bar (bar.key)}
			<span data-today={bar.isToday ? '1' : '0'}>{label(bar.key, bar.isToday)}</span>
		{/each}
	</div>
	{#if detail}
		<div class="bar-detail">{detail}</div>
	{/if}
</article>
