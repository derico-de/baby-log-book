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
	import type {
		FeedsSecondary,
		NappiesSecondary,
		SleepSecondary,
		SolidsSecondary,
		StatsCard,
		TummySecondary
	} from '$domain/stats';
	import type { FacetKey } from '$domain/filter';
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
		solids: 'meal',
		tummy: 'tummy'
	};

	/* The card wears its entry type's colour (issue 24) — bars and the head
	   mark read it from this one attribute. */
	const T: Record<StatsCard['kind'], FacetKey> = {
		sleep: 'sleep',
		feeds: 'feed',
		nappies: 'nappy',
		solids: 'meal',
		tummy: 'tummy'
	};

	const NAME: Record<StatsCard['kind'], () => string> = {
		sleep: () => m.stats_card_sleep(),
		feeds: () => m.stats_card_feeds(),
		nappies: () => m.stats_card_nappies(),
		solids: () => m.stats_card_solids(),
		tummy: () => m.stats_card_tummy()
	};

	const isDuration = $derived(card.kind === 'sleep' || card.kind === 'tummy');

	/* Sleep is drawn as the two things it is. A single column says she slept
	   eleven hours and hides which half moved, which is the only part anybody
	   is watching: the same eleven hours as one night and as six naps are not
	   the same day (ADR-0033). Night is the base of the column and Nap sits on
	   top of it, in the Sleep hue's daytime face. */
	const isSplit = $derived(card.kind === 'sleep');
	const SPLIT = [
		{ t: 'sleep' as const, name: () => m.stats_night_label() },
		{ t: 'nap' as const, name: () => m.stats_naps_label() }
	];
	/* The two parts as fractions of their own column, bottom first, so the
	   stack draws in one pass and a day with only naps has no night sliver. */
	const parts = (bar: StatsCard['bars'][number]) => {
		const total = (bar.nightMs ?? 0) + (bar.napMs ?? 0);
		if (total <= 0) return [];
		return [
			{ t: 'sleep' as const, share: (bar.nightMs ?? 0) / total },
			{ t: 'nap' as const, share: (bar.napMs ?? 0) / total }
		].filter((p) => p.share > 0);
	};

	/* Feeds draw what she drank, not how often: five feeds of 40 ml and five of
	   150 ml are the same count and a very different day. The bars only switch
	   to millilitres once a bottle exists in the window — a breastfed week has
	   no volume to plot, so it keeps counting rounds. */
	const isVolume = $derived(card.kind === 'feeds' && card.bars.some((b) => b.volumeMl != null));
	const heightOf = (bar: StatsCard['bars'][number]) => (isVolume ? (bar.volumeMl ?? 0) : bar.value);

	/* The axis ceiling is the next even hour (Sleep), even quarter-hour (Tummy
	   time), even 50 ml (a Feeds week with bottles) or even count above the
	   tallest bar, so both tick labels are amounts a person would actually say —
	   at the price of the tallest bar stopping a little short of the top line.
	   Tummy time is measured in minutes, so an hourly axis would draw every real
	   day as a stub. */
	const unit = $derived(
		card.kind === 'sleep' ? MS.hour : card.kind === 'tummy' ? 15 * MS.minute : isVolume ? 50 : 1
	);
	const axisMax = $derived.by(() => {
		const top = Math.max(unit, ...card.bars.map(heightOf));
		return 2 * unit * Math.ceil(top / (2 * unit));
	});

	/* The tapped day. Tapping it again lets go. */
	let selectedKey = $state<string | null>(null);
	const selected = $derived(card.bars.find((b) => b.key === selectedKey) ?? null);

	const value = (n: number) => (isDuration ? duration(n) : decimal(n, Number.isInteger(n) ? 0 : 1));
	/* What a bar is worth, said the way its axis is labelled. */
	const barValue = (n: number) => (isVolume ? millilitres(n) : value(n));

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
				/* Today's split, then the same split as a daily average: today is
				   what the last bar is, and the average is what a person compares a
				   day against. There is no average until a complete logged day
				   exists, so that line simply is not there on day one. */
				return [
					m.stats_night_naps_today({ night: duration(s.nightTodayMs), naps: duration(s.napTodayMs) }),
					...(s.nightAvgMs == null || s.napAvgMs == null
						? []
						: [m.stats_night_naps({ night: duration(s.nightAvgMs), naps: duration(s.napAvgMs) })]),
					m.stats_longest({ value: duration(s.longestMs) })
				];
			}
			case 'feeds': {
				const s = card.secondary as FeedsSecondary;
				/* Volume cannot be the primary bar: a breastfed Baby has no
				   millilitres. Where there is volume it carries the average, because
				   an average number of feeds answers nothing — the question is
				   whether she is drinking as much as she was. */
				if (s.volumeMlToday == null) return [];
				const today = millilitres(s.volumeMlToday);
				return [
					s.volumeMlAverage == null
						? m.stats_volume({ value: today })
						: m.stats_volume_avg({ value: today, avg: millilitres(Math.round(s.volumeMlAverage)) })
				];
			}
			case 'nappies': {
				const s = card.secondary as NappiesSecondary;
				return [m.stats_split({ pee: String(s.peeToday), poop: String(s.poopToday) })];
			}
			case 'tummy': {
				const s = card.secondary as TummySecondary;
				/* A daily total hides the shape of the day: 30 minutes in one go is
				   not 30 minutes in six, and the difference is the whole reason
				   anyone counts stretches. */
				return s.sessionsToday === 0
					? []
					: [
							plural(s.sessionsToday, {
								one: m.stats_tummy_sessions_one,
								few: m.stats_tummy_sessions_few,
								other: m.stats_tummy_sessions_other
							}),
							m.stats_longest({ value: duration(s.longestTodayMs) })
						];
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
		/* A tapped Sleep day states its split too — reading which half of the
		   column is which is the whole reason it is drawn as two. */
		const amount = isSplit
			? `${value(selected.value)} · ${m.stats_night_naps_plain({
					night: duration(selected.nightMs ?? 0),
					naps: duration(selected.napMs ?? 0)
				})}`
			: selected.volumeMl == null
				? value(selected.value)
				: `${value(selected.value)} · ${millilitres(selected.volumeMl)}`;
		return m.stats_day_detail({ day, value: amount });
	});
</script>

<article class="card" data-t={T[card.kind]}>
	<div class="card-head">
		<div class="card-name"><Icon name={GLYPH[card.kind]} />{NAME[card.kind]()}</div>
		{#if delta}<div class="card-delta">{delta}</div>{/if}
	</div>

	<div class="card-value">
		{value(card.today)}
		<!-- No average on the first logged day: until a complete logged day
		     exists there is nothing to state, and a made-up zero would read as
		     "worse than every day before". A Feeds week with bottles states its
		     average in millilitres on the line below instead: how many times she
		     fed on an average day is not a fact anybody acts on. -->
		{#if card.average != null && !isVolume}
			<small>{m.stats_today_avg({ avg: value(card.average) })}</small>
		{/if}
	</div>

	{#each secondary as line (line)}
		<div class="card-delta">{line}</div>
	{/each}

	<div class="bars">
		{#each [1, 0.5] as tick (tick)}
			<div class="gridline" style={`bottom:${tick * 100}%`} aria-hidden="true">
				<span>{barValue(axisMax * tick)}</span>
			</div>
		{/each}
		{#each card.bars as bar (bar.key)}
			<!-- The whole column is the tap target — the bar itself can be three
			     pixels tall. -->
			<button
				type="button"
				class="bar-hit"
				aria-pressed={selectedKey === bar.key}
				aria-label={`${label(bar.key, bar.isToday)}: ${barValue(heightOf(bar))}${
					isSplit
						? ` · ${m.stats_night_naps_plain({
								night: duration(bar.nightMs ?? 0),
								naps: duration(bar.napMs ?? 0)
							})}`
						: ''
				}`}
				onclick={() => (selectedKey = selectedKey === bar.key ? null : bar.key)}
			>
				<!-- A day with nothing on it draws nothing: the six-percent floor is
				     there to keep a small day visible, and lending it to zero says
				     she had a nappy when she had none. -->
				{#if heightOf(bar) > 0}
					{#if isSplit}
						<span
							class="bar bar-stack"
							data-today={bar.isToday ? '1' : '0'}
							data-selected={selectedKey === bar.key ? '1' : '0'}
							style={`height:${Math.max(6, (heightOf(bar) / axisMax) * 100)}%`}
						>
							{#each parts(bar) as part (part.t)}
								<span class="bar-part" data-t={part.t} style={`height:${part.share * 100}%`}></span>
							{/each}
						</span>
					{:else}
						<span
							class="bar"
							data-today={bar.isToday ? '1' : '0'}
							data-selected={selectedKey === bar.key ? '1' : '0'}
							style={`height:${Math.max(6, (heightOf(bar) / axisMax) * 100)}%`}
						></span>
					{/if}
				{/if}
			</button>
		{/each}
	</div>
	<div class="bar-labels">
		{#each card.bars as bar (bar.key)}
			<span data-today={bar.isToday ? '1' : '0'}>{label(bar.key, bar.isToday)}</span>
		{/each}
	</div>
	{#if isSplit}
		<!-- The colour key. Two hues on one column is a second channel, so the
		     words that name them have to be on the screen: the split is stated
		     in text above and keyed here, and nothing about the chart is
		     knowable from the colour alone. -->
		<div class="bar-key">
			{#each SPLIT as part (part.t)}
				<span data-t={part.t}><i></i>{part.name()}</span>
			{/each}
		</div>
	{/if}
	{#if detail}
		<div class="bar-detail">{detail}</div>
	{/if}
</article>
