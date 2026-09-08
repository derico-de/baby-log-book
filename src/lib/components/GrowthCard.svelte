<script lang="ts">
	/* One growth card — weight, or height.

	   The five trend cards next to it are seven bars of a rolling week. This one
	   is a line over the whole log, because a Baby is weighed at a check-up and
	   a week of measurements is one column and six gaps (see `growth.ts`).

	   Three rules it keeps that the bar cards keep too:

	     - **The number is the card; the chart is the second read.** The latest
	       weight is stated in words at hero size, the gain since the measurement
	       before it in words underneath. At 3am a curve you have to interpret is
	       worse than a sentence.
	     - **Nothing is knowable only from the drawing.** Every point is in the
	       hidden list under the chart, with its date, so a screen reader gets the
	       whole series and not "a line chart".
	     - **The curve never invents a value.** The path is monotone cubic, so it
	       cannot dip between two rising measurements — an overshoot on a growth
	       chart is the app saying she lost weight (`smoothPath`).

	   Geometry in real pixels rather than a stretched viewBox: the card is a
	   different width on every phone, and a `preserveAspectRatio="none"` box
	   would draw the dots as ellipses and the stroke thicker one way than the
	   other. The width comes from the element itself, so the first frame — before
	   layout has happened — draws the sentences and no chart, which is the right
	   half to have. */
	import { app } from '$client/state.svelte';
	import { smoothPath, type GrowthSeries } from '$domain/growth';
	import { dateShort, length, weight } from '$lib/i18n/format';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';

	interface Props {
		series: GrowthSeries;
	}
	let { series }: Props = $props();

	const NAME: Record<GrowthSeries['kind'], () => string> = {
		weight: () => m.stats_card_weight(),
		height: () => m.stats_card_height()
	};

	/* Grams and millimetres in, a paediatrician's sentence out. */
	const say = (value: number) => (series.kind === 'weight' ? weight(value) : length(value));
	const when = (at: number) => dateShort(at, app.zone);

	const previous = $derived(series.points.length > 1 ? series.points[series.points.length - 2] : null);
	const change = $derived.by(() => {
		if (!previous) return null;
		const by = series.latest.value - previous.value;
		const date = when(previous.at);
		if (by === 0) return m.stats_growth_same({ date });
		return by > 0
			? m.stats_growth_gain({ value: say(by), date })
			: m.stats_growth_drop({ value: say(-by), date });
	});

	/* The plot box. Height is fixed; width is whatever the card gives it. */
	const H = 124;
	const PAD_Y = 10;
	let boxWidth = $state(0);

	/* A flat series — one measurement, or two identical ones — has no range to
	   scale against, so it is drawn down the middle rather than pinned to an
	   edge that would read as a ceiling. Otherwise the range is padded a little
	   at both ends so the curve is a curve inside a box and not a line along
	   the top of one. */
	const span = $derived(series.max - series.min);
	const low = $derived(span === 0 ? series.min - 1 : series.min - span * 0.12);
	const high = $derived(span === 0 ? series.min + 1 : series.max + span * 0.12);

	const yOf = (value: number) => PAD_Y + (1 - (value - low) / (high - low)) * (H - 2 * PAD_Y);

	const plot = $derived.by(() => {
		if (boxWidth <= 0) return [];
		const from = series.first.at;
		const to = series.latest.at;
		const width = to - from;
		return series.points.map((p) => ({
			point: p,
			x: width === 0 ? boxWidth / 2 : ((p.at - from) / width) * boxWidth,
			y: yOf(p.value)
		}));
	});

	/* The two axis lines are drawn *through* the highest and lowest dots rather
	   than along the edges of the box: a line labelled 7.80 kg with the 7.80 kg
	   dot ten pixels under it is the chart contradicting its own axis. One
	   measurement has one line, not the same figure printed twice. */
	const ticks = $derived(span === 0 ? [series.max] : [series.max, series.min]);
	const path = $derived(smoothPath(plot.map((p) => ({ x: p.x, y: p.y }))));
</script>

<article class="card" data-t="measure">
	<div class="card-head">
		<div class="card-name"><Icon name="measure" />{NAME[series.kind]()}</div>
		{#if change}<div class="card-delta">{change}</div>{/if}
	</div>

	<div class="card-value">
		{say(series.latest.value)}
		<small>{m.stats_growth_measured({ date: when(series.latest.at) })}</small>
	</div>

	<!-- The bar cards' dashed axis lines, drawn at the two ends of the range
	     this series actually covers: a growth axis that started at zero would
	     draw every real baby as a flat line near the top. -->
	<div class="growth" style={`height:${H}px`} bind:clientWidth={boxWidth}>
		{#each ticks as tick, index (tick)}
			<!-- The ceiling label sits above its line and the floor label below it:
			     a growth curve ends at its own maximum, so a label hung under the
			     top line lands on the last dot every time. -->
			<div
				class="gridline"
				data-edge={index === 0 ? 'top' : 'bottom'}
				style={`bottom:${H - yOf(tick)}px`}
				aria-hidden="true"
			>
				<span>{say(tick)}</span>
			</div>
		{/each}
		{#if boxWidth > 0}
			<svg width={boxWidth} height={H} viewBox={`0 0 ${boxWidth} ${H}`} aria-hidden="true">
				<path class="growth-line" d={path} />
				{#each plot as p (p.point.at)}
					<circle class="growth-dot" cx={p.x} cy={p.y} r="3" />
				{/each}
			</svg>
		{/if}
	</div>

	<!-- The two ends of the x axis, said as dates. One measurement has one end
	     and states it once rather than printing the same date twice. -->
	<div class="growth-span">
		<span>{when(series.first.at)}</span>
		{#if series.points.length > 1}<span>{when(series.latest.at)}</span>{/if}
	</div>

	<!-- Every point, with its date. The chart is the second read for everyone;
	     this is the whole series for anyone who cannot see it. -->
	<ul class="sr-only">
		{#each series.points as p (p.at)}
			<li>{m.stats_day_detail({ day: when(p.at), value: say(p.value) })}</li>
		{/each}
	</ul>
</article>
