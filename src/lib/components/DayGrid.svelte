<script lang="ts">
	/* The day grid. One column per day, an hour axis down the side, every Entry
	   drawn in the slot it happened in.

	   The geometry is `grid.ts`; this file only paints it. Three things it is
	   responsible for on its own:

	     - **The hour rows are the page.** There is no inner scroller: the hours
	       flow down the same scroll the trend cards are in, so a phone never has
	       to hit a 30px target between two scroll regions. Only the weekday row
	       is sticky.
	     - **Colour is the scanning channel, never the only one.** A week column
	       is 46px wide and a fifteen-minute feed is 11px tall, which is too
	       small for a glyph — so every column carries a visually-hidden list of
	       what is in it, in order, with times and durations. The legend names
	       every hue, and the day view writes the labels out. Nothing on this
	       screen is knowable *only* by its colour.
	     - **Every Entry takes the whole column, and layering does the rest.**
	       Sleep is the ground, sessions with a duration lie over it, instants
	       lie over both — so a Sleep Feed is drawn as a band *inside* its
	       Sleep (spec §3.4) rather than as a column beside it. A ring in the
	       ground colour keeps the upper layers reading as objects on top of a
	       Sleep rather than as slices cut out of it. */
	import { app } from '$client/state.svelte';
	import { buildGrid, type BlockMember, type GridBlock, type GridColumn, type GridMark } from '$domain/grid';
	import type { FacetKey } from '$domain/filter';
	import { clockTime, dateWithWeekday, duration, hourLabel, weekdayShort } from '$lib/i18n/format';
	import { entryTitle, feedRunTitle, GLYPH_OF } from '$lib/i18n/entry-label';
	import { wallPartsOf } from '$domain/time';
	import type { Entry } from '$domain/types';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';

	interface Props {
		/** Day keys, ascending. Seven for the week view, one for the day view. */
		keys: string[];
		view: 'week' | 'day';
		facets: FacetKey[];
		/** Week view only: the day column headers are buttons into the day view. */
		onpick: (key: string) => void;
		/** Day view only: a block or a mark opens its Entry. */
		onopen: (entry: Entry) => void;
	}
	let { keys, view, facets, onpick, onopen }: Props = $props();

	const isDay = $derived(view === 'day');

	/* A mark needs about as much room as one row of type. Below that two
	   Entries ten minutes apart would be drawn on top of each other, so in the
	   day view they take lanes side by side — at their true times, never nudged
	   to a time they did not happen at. A week column has no width to spare, so
	   it passes no slot and lets them stack. */
	const markSlotMs = $derived(isDay ? 26 * 60_000 : 0);

	const columns = $derived.by(() => {
		const baby = app.baby;
		if (!baby) return [] as GridColumn[];
		return buildGrid({
			entries: app.babyEntries,
			babyId: baby.id,
			keys,
			dayStart: app.dayStart,
			zone: app.zone,
			now: app.now,
			facets,
			markSlotMs
		});
	});

	const empty = $derived(columns.every((c) => c.ordered.length === 0));

	const title = (e: Entry) => entryTitle(e, (id) => app.foodName(id));

	/** An Entry as one sentence: what it is, when it was, how long it ran.
	    This is the block's accessible name and the day view's own label. */
	function sentence(e: Entry): string {
		const parts = [title(e)];
		if (e.type === 'milestone') {
			/* A Milestone shows no clock time anywhere — its precision is dropped
			   at display, not in storage (spec §3.6). */
			return parts.join(' · ');
		}
		const from = clockTime(e.occurred_at, app.zone);
		if (e.ended_at != null) {
			parts.push(`${from}–${clockTime(e.ended_at, app.zone)}`, duration(e.ended_at - e.occurred_at));
		} else if (isSessionEntry(e)) {
			parts.push(from, m.stats_running());
		} else {
			parts.push(from);
		}
		return parts.join(' · ');
	}

	const isSessionEntry = (e: Entry) =>
		e.type === 'sleep' || e.type === 'tummy_time' || e.type === 'breast_feed' || e.type === 'bottle_feed';

	function blockName(b: GridBlock): string {
		const parts = [sentence(b.entry)];
		if (b.clippedStart || b.clippedEnd) parts.push(m.stats_continues());
		return parts.join(' · ');
	}

	/** The members of a block, split into the runs of same-content Feeds
	    `grid.ts` found. Two bottles of the same formula are one run and read as
	    one bigger feeding; breast then formula are two and read as the handover
	    they were. */
	function runs(b: GridBlock): BlockMember[][] {
		const out: BlockMember[][] = [];
		for (const part of b.members) {
			if (out.length > 0 && out[out.length - 1][0].run === part.run) out[out.length - 1].push(part);
			else out.push([part]);
		}
		return out;
	}

	/* A Combined Feed states every source it was: "Breast · Left + Bottle ·
	   Formula · 120 ml". The plus is doing real work — it says *and then*,
	   which is what a sitting from more than one source is (ADR-0019). Two
	   bottles of the same milk are not a handover and get no plus: they are one
	   figure. */
	const combinedTitle = (b: GridBlock) =>
		runs(b)
			.map((run) => feedRunTitle(run.map((part) => part.entry), (id) => app.foodName(id)))
			.join(' + ');

	/* Percentages, computed once per block rather than in the template — the
	   week view can hold a couple of hundred of them. */
	const top = (v: number) => `${(v * 100).toFixed(4)}%`;
	const height = (b: GridBlock) => `${Math.max(0, (b.to - b.from) * 100).toFixed(4)}%`;
	const span = (part: { from: number; to: number }) => `${Math.max(0, (part.to - part.from) * 100).toFixed(4)}%`;

	/** Foreground blocks share the inset track; ground blocks take the column. */
	function across(b: GridBlock): string {
		const width = 100 / b.lanes;
		return `left:${(b.lane * width).toFixed(4)}%;width:${width.toFixed(4)}%`;
	}
	/** A lone instant takes the whole column, like everything else. A cluster —
	    two Entries too close to draw at the same trailing edge — packs against
	    that edge instead of spreading across the column, because a disc adrift
	    in the middle of a Feed's label is worse than a tight row of discs. */
	function markAcross(mk: GridMark): string {
		if (mk.lanes === 1) return 'left:0;right:0';
		return `left:auto;right:${mk.lane * 28}px`;
	}

	/* One gutter serves every column, so on the two days a year a column is 23
	   or 25 hours long the labels can only be right for one length. They come
	   from whichever length most of the week has; the hour *lines* are drawn per
	   column from that column's own ticks, so the geometry never lies even on
	   the day the labels do. A single-day view has one column and is exact. */
	const axisTicks = $derived.by(() => {
		if (columns.length === 0) return [];
		const tally = new Map<number, number>();
		for (const c of columns) tally.set(c.ticks.length, (tally.get(c.ticks.length) ?? 0) + 1);
		let best = columns[0].ticks.length;
		for (const [len, n] of tally) if (n > (tally.get(best) ?? 0)) best = len;
		return (columns.find((c) => c.ticks.length === best) ?? columns[0]).ticks;
	});

	const columnLabel = (col: GridColumn) => dateWithWeekday(col.start, app.zone);
	const dayNumber = (col: GridColumn) => String(wallPartsOf(col.start, app.zone).d);
</script>

<div class="daygrid" data-view={view} style={`--cols:${keys.length}`}>
	<!-- The weekday strip. Sticky, and every cell is the way into that day —
	     pick the odd-looking column, land in it. Hidden in the day view, where
	     the heading above the grid already names the day. -->
	<div class="daygrid-days">
		<div class="daygrid-gutter-head" aria-hidden="true"></div>
		{#each columns as col (col.key)}
			<button
				class="daygrid-day"
				type="button"
				data-today={col.isToday ? '1' : '0'}
				aria-label={m.stats_open_day({ day: columnLabel(col) })}
				onclick={() => onpick(col.key)}
			>
				<span class="daygrid-day-name">{weekdayShort(col.start, app.zone)}</span>
				<span class="daygrid-day-num">{dayNumber(col)}</span>
			</button>
		{/each}
	</div>

	<div class="daygrid-body">
		<!-- The hour axis. Real text, one label per tick: on a spring-forward day
		     it skips an hour, because the day did. -->
		<div class="daygrid-gutter" aria-hidden="true">
			{#each axisTicks as tick (tick.instant)}
				<span class="daygrid-hour" style={`top:${top(tick.at)}`}>{hourLabel(tick.hour, tick.minute)}</span>
			{/each}
		</div>

		{#each columns as col (col.key)}
			<section class="daygrid-col" aria-label={columnLabel(col)}>
				<!-- Every Entry in the column, in order, for anyone who cannot see
				     an 11px block — and the reason colour is never the only
				     channel here. Written once per column in the week view; the
				     day view labels its blocks directly, so it is skipped there. -->
				{#if !isDay}
					<ul class="sr-only">
						{#each col.ordered as e (e.id)}
							<li>{sentence(e)}</li>
						{/each}
					</ul>
				{/if}

				<div class="daygrid-lines" aria-hidden="true">
					{#each col.ticks as tick (tick.instant)}
						<span class="daygrid-line" style={`top:${top(tick.at)}`}></span>
					{/each}
				</div>

				<!-- Sleep, the ground layer: the full width of the column. -->
				<div class="daygrid-ground" aria-hidden={!isDay} data-t="sleep">
					{#each col.blocks.filter((b) => b.ground) as b (b.entry.id)}
						{#if isDay}
							<button
								class="block"
								type="button"
								data-clip-start={b.clippedStart ? '1' : '0'}
								data-clip-end={b.clippedEnd ? '1' : '0'}
								data-running={b.running ? '1' : '0'}
								style={`top:${top(b.from)};height:${height(b)};${across(b)}`}
								aria-label={blockName(b)}
								onclick={() => onopen(b.entry)}
							>
								<!-- Glyph and duration, and no clock time: the block already
								     sits on an hour axis that states where it begins and ends,
								     and the word "Sleep" is said twice over by the glyph and
								     the legend. What is left is the fact worth reading — how
								     long. It also keeps the label inside the narrow strip the
								     feed track never covers, so it cannot be half-hidden by a
								     Sleep Feed drawn on top of it. -->
								<span class="block-label">
									<Icon name={GLYPH_OF[b.entry.type]} />
									<span class="block-text"
										>{b.entry.ended_at != null
											? duration(b.entry.ended_at - b.entry.occurred_at)
											: m.stats_running()}</span
									>
								</span>
							</button>
						{:else}
							<span
								class="block"
								data-clip-start={b.clippedStart ? '1' : '0'}
								data-clip-end={b.clippedEnd ? '1' : '0'}
								data-running={b.running ? '1' : '0'}
								style={`top:${top(b.from)};height:${height(b)};${across(b)}`}
							></span>
						{/if}
					{/each}
				</div>

				<!-- Feeds and tummy time, over the Sleep ground, so a Sleep Feed
				     reads as a band lying across its Sleep rather than fighting it.
				     A Combined Feed is one envelope carrying both sources' values,
				     divided where one source handed over to the next — each still
				     its own tap target and its own accessible name, because a
				     sitting is one thing to read and two things to correct. -->
				<div class="daygrid-over" aria-hidden={!isDay}>
					{#each col.blocks.filter((b) => !b.ground) as b (b.entry.id)}
						<div
							class="block"
							data-t={b.facet}
							data-clip-start={b.clippedStart ? '1' : '0'}
							data-clip-end={b.clippedEnd ? '1' : '0'}
							data-running={b.running ? '1' : '0'}
							style={`top:${top(b.from)};height:${height(b)};${across(b)}`}
						>
							{#if isDay}
								<span class="block-label" aria-hidden="true">
									<Icon name={GLYPH_OF[b.entry.type]} />
									<span class="block-text">{combinedTitle(b)}</span>
								</span>
								{#each b.members as part (part.entry.id)}
									<button
										class="block-part"
										type="button"
										style={`top:${top(part.from)};height:${span(part)}`}
										aria-label={sentence(part.entry)}
										onclick={() => onopen(part.entry)}
									></button>
								{/each}
							{:else}
								<!-- The seam where one source handed over to the next. A week
								     column has no room for a label, so the hairline is all
								     there is to say the sitting had two sources; in the day
								     view the label says it in words, and a line drawn at the
								     handover would cut straight through them. -->
								{#each b.members.slice(1).filter((part, i) => part.run !== b.members[i].run) as part (part.entry.id)}
									<span class="block-seam" style={`top:${top(part.from)}`}></span>
								{/each}
							{/if}
						</div>
					{/each}
				</div>

				<!-- The instants — a nappy, a meal, a measurement, a milestone.
				     They have one time and no duration, so they get a rail of
				     their own rather than a block pretending to have a length. -->
				<div class="daygrid-marks" aria-hidden={!isDay}>
					{#each col.marks as mk (mk.entry.id)}
						{#if isDay}
							<button
								class="mark"
								type="button"
								data-t={mk.facet}
								style={`top:${top(mk.at)};${markAcross(mk)}`}
								aria-label={sentence(mk.entry)}
								onclick={() => onopen(mk.entry)}
							>
								<span class="mark-disc"><Icon name={GLYPH_OF[mk.entry.type]} /></span>
								{#if mk.lanes === 1}
									<!-- Two Entries within half an hour take lanes side by side, and
									     half a rail cannot hold a word. The disc keeps the glyph and
									     the hue; the accessible name keeps the sentence. -->
									<span class="mark-text">{title(mk.entry)}</span>
								{/if}
							</button>
						{:else}
							<span class="mark" data-t={mk.facet} style={`top:${top(mk.at)};${markAcross(mk)}`}></span>
						{/if}
					{/each}
				</div>

				{#if col.now != null}
					<!-- The one accent on this screen. `--live` and `--accent` are
					     the same token by design: the brand hue means *the thing
					     happening now*, here as on the home screen. -->
					<span class="daygrid-now" style={`top:${top(col.now)}`} aria-label={m.stats_now()}></span>
				{/if}
			</section>
		{/each}
	</div>

	{#if empty}
		<!-- The axis is still drawn underneath: an outlined grid teaches what the
		     screen is far better than a blank page with a sentence on it. -->
		<p class="daygrid-empty">{isDay ? m.stats_day_empty() : m.stats_week_empty()}</p>
	{/if}
</div>
