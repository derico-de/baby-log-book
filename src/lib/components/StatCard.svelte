<script lang="ts">
	/* One trend card. Spec §9.1.

	   Every card states its numbers as text with the bars as the secondary read: at
	   3am a shape you have to interpret is worse than a sentence, and it is the
	   accessible version for free. Eight bars with no axes, tooltips or zoom is not
	   a charting problem, so they are hand-rolled and there is no charting
	   dependency.

	   Today is the eighth bar, drawn visibly in progress, and it is excluded from
	   the delta. */
	import { app } from '$client/state.svelte';
	import { decimal, duration, millilitres, plural, weekdayShort } from '$lib/i18n/format';
	import { dayStartInstant } from '$domain/time';
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
	const max = $derived(Math.max(1, ...card.bars.map((b) => b.value)));

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
</script>

<article class="card">
	<div class="card-head">
		<div class="card-name"><Icon name={GLYPH[card.kind]} />{NAME[card.kind]()}</div>
		{#if delta}<div class="card-delta">{delta}</div>{/if}
	</div>

	<div class="card-value">
		{value(card.today)}
		<small>{m.stats_today_avg({ avg: value(card.average) })}</small>
	</div>

	{#each secondary as line (line)}
		<div class="card-delta">{line}</div>
	{/each}

	<div class="bars" aria-hidden="true">
		{#each card.bars as bar (bar.key)}
			<div
				class="bar"
				data-today={bar.isToday ? '1' : '0'}
				style={`height:${Math.max(6, (bar.value / max) * 100)}%`}
			></div>
		{/each}
	</div>
	<div class="bar-labels">
		{#each card.bars as bar (bar.key)}
			<span data-today={bar.isToday ? '1' : '0'}>{label(bar.key, bar.isToday)}</span>
		{/each}
	</div>
</article>
