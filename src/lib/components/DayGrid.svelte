<script lang="ts">
	/* The day grid. One column per day, an hour axis down the side, every Entry
	   drawn in the slot it happened in.

	   The geometry is `grid.ts`; this file only paints it. Three things it is
	   responsible for on its own:

	     - **The hour rows are the page.** There is no inner scroller: the hours
	       flow down the same scroll the screen is in, so a phone never has to
	       hit a 30px target between two scroll regions. Only the weekday row is
	       sticky.
	     - **Colour is the scanning channel, never the only one.** A week column
	       is 46px wide and a fifteen-minute feed is 11px tall, which is too
	       small for a glyph — so every column carries a visually-hidden list of
	       what is in it, in order, with times and durations. The legend names
	       every hue. Nothing on this screen is knowable *only* by its colour.
	     - **Every Entry takes the whole column, and layering does the rest.**
	       Sleep is the ground, sessions with a duration lie over it, instants
	       lie over both — so a Sleep Feed is drawn as a band *inside* its
	       Sleep (spec §3.4) rather than as a column beside it. A ring in the
	       ground colour keeps the upper layers reading as objects on top of a
	       Sleep rather than as slices cut out of it.

	   Two views, both patterns: a week and four weeks. There is no day view —
	   what one day held is the timeline's job, and it was the only view here
	   that answered a question another screen already answers better. A month is
	   the same drawing with the hour rows compressed: at that width no block can
	   carry a label, which is exactly why the hidden list per column is not an
	   accessibility afterthought but the readable version of this screen.

	   Sleep is drawn in two colours, because it is two things: the Night Sleep
	   that crosses the Day Start and the Naps around it (ADR-0033). Which one a
	   block is comes from `classifySleep`, the same function the Sleep card
	   counts with, so the grid and the card can never disagree about what a
	   night is. */
	import { app } from '$client/state.svelte';
	import { buildGrid, type BlockMember, type GridBlock, type GridColumn, type GridMark } from '$domain/grid';
	import { classifySleep } from '$domain/sleep';
	import type { FacetKey } from '$domain/filter';
	import { clockTime, dateWithWeekday, duration, hourLabel, weekdayShort } from '$lib/i18n/format';
	import { entryTitle, feedRunTitle } from '$lib/i18n/entry-label';
	import { wallPartsOf } from '$domain/time';
	import type { Entry } from '$domain/types';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		/** Day keys, ascending. Seven for the week view, twenty-eight for the
		    month view. */
		keys: string[];
		view: 'week' | 'month';
		/** Which types to draw. Undefined draws them all; an empty list — every
		    legend chip turned off — draws none. */
		facets?: FacetKey[];
	}
	let { keys, view, facets }: Props = $props();

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
			facets
		});
	});

	const empty = $derived(columns.every((c) => c.ordered.length === 0));

	const title = (e: Entry) => entryTitle(e, (id) => app.foodName(id));

	/** Night or Nap — the Sleep hue's two faces, and the one thing on this grid
	    that colour alone would carry. It is in the column's hidden list too, so
	    it never is. */
	const sleepKind = (e: Entry) =>
		classifySleep(e, { dayStart: app.dayStart, zone: app.zone, night: app.night }, app.now);

	/** What a block is painted as: its facet, except a Sleep, which is a Night
	    Sleep or a Nap. */
	const paintOf = (b: GridBlock) =>
		b.entry.type === 'sleep' ? (sleepKind(b.entry) === 'night' ? 'sleep' : 'nap') : b.facet;

	const isSessionEntry = (e: Entry) =>
		e.type === 'sleep' || e.type === 'tummy_time' || e.type === 'breast_feed' || e.type === 'bottle_feed';

	/** An Entry as one sentence: what it is, when it was, how long it ran. */
	function sentence(e: Entry): string {
		const parts = [sentenceHead(e)];
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

	/** What a Sleep block calls itself, before the clock times: a Sleep is a
	    Night Sleep or a Nap, and on this grid that is the difference the two
	    colours carry. */
	const sentenceHead = (e: Entry) =>
		e.type === 'sleep'
			? `${title(e)} · ${sleepKind(e) === 'night' ? m.stats_night_label() : m.stats_nap_label()}`
			: title(e);

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
	function combinedTitle(b: GridBlock): string {
		const rs = runs(b);
		return rs
			.map((run, index) =>
				feedRunTitle(
					run.map((part) => part.entry),
					(id) => app.foodName(id),
					/* The word *Bottle* only has to be said once per stretch of
					   bottles: "Bottle · Breast milk · 60 ml + Formula · 80 ml"
					   loses nothing and buys the width back. A breast in between
					   makes the next bottle say it again — it is the neighbour
					   that licenses the shorthand, not the whole sitting. */
					index > 0 && rs[index - 1][0].entry.type === run[0].entry.type
				)
			)
			.join(' + ');
	}

	/** A block as one sentence, for the hidden list. A Combined Feed is one
	    sentence and not several: it is one answer to *has she eaten*, and the
	    list is the readable version of the drawing — where it is also one
	    block. */
	function blockName(b: GridBlock): string {
		const last = b.members[b.members.length - 1].entry;
		const parts = [b.members.length > 1 ? combinedTitle(b) : sentenceHead(b.entry)];
		const from = clockTime(b.entry.occurred_at, app.zone);
		if (last.ended_at != null) {
			parts.push(
				`${from}–${clockTime(last.ended_at, app.zone)}`,
				duration(last.ended_at - b.entry.occurred_at)
			);
		} else {
			parts.push(from, m.stats_running());
		}
		if (b.clippedStart || b.clippedEnd) parts.push(m.stats_continues());
		return parts.join(' · ');
	}

	/** Everything touching a column, in the order it happened — the linear read
	    a screen reader gets, and the reason no Entry can hide behind another. */
	function readout(col: GridColumn): Array<{ id: string; text: string }> {
		return [
			...col.blocks.map((b) => ({ id: b.entry.id, at: b.from, text: blockName(b) })),
			...col.marks.map((mk: GridMark) => ({ id: mk.entry.id, at: mk.at, text: sentence(mk.entry) }))
		]
			.sort((a, b) => a.at - b.at)
			.map(({ id, text }) => ({ id, text }));
	}

	/* Percentages, computed once per block rather than in the template — the
	   month view can hold a thousand of them. */
	const top = (v: number) => `${(v * 100).toFixed(4)}%`;
	const height = (b: GridBlock) => `${Math.max(0, (b.to - b.from) * 100).toFixed(4)}%`;

	/** Foreground blocks share the inset track; ground blocks take the column. */
	function across(b: GridBlock): string {
		const width = 100 / b.lanes;
		return `left:${(b.lane * width).toFixed(4)}%;width:${width.toFixed(4)}%`;
	}
	/* One gutter serves every column, so on the two days a year a column is 23
	   or 25 hours long the labels can only be right for one length. They come
	   from whichever length most of the window has; the hour *lines* are drawn
	   per column from that column's own ticks, so the geometry never lies even
	   on the day the labels do. */
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
	<!-- The weekday strip. Sticky, and the only thing above the hours that
	     names which day a column is. A month drops the weekday name: at that
	     width the number is all that fits, and the columns are four whole weeks
	     so every row of the strip lines up with the same weekday. -->
	<div class="daygrid-days">
		<div class="daygrid-gutter-head" aria-hidden="true"></div>
		{#each columns as col, index (col.key)}
			<div class="daygrid-day" data-today={col.isToday ? '1' : '0'} aria-label={columnLabel(col)}>
				<span class="daygrid-day-name">{weekdayShort(col.start, app.zone)}</span>
				<!-- A month column is eleven pixels wide and twenty-eight dates in a
				     row come out as one long number. It is four whole weeks, so a
				     date every seventh column is a weekly ruler and the rest are
				     counted off it — plus today, which always says which day it is.
				     Every column still names itself in full to a screen reader. -->
				{#if view === 'week' || index % 7 === 0 || col.isToday}
					<span class="daygrid-day-num">{dayNumber(col)}</span>
				{/if}
			</div>
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
				     an 11px block — and the reason colour is never the only channel
				     here. A Combined Feed is one line, exactly as it is one block. -->
				<ul class="sr-only">
					{#each readout(col) as item (item.id)}
						<li>{item.text}</li>
					{/each}
				</ul>

				<div class="daygrid-lines" aria-hidden="true">
					{#each col.ticks as tick (tick.instant)}
						<span class="daygrid-line" style={`top:${top(tick.at)}`}></span>
					{/each}
				</div>

				<!-- Sleep, the ground layer: the full width of the column, and in
				     one of its two colours. -->
				<div class="daygrid-ground" aria-hidden="true" data-t="sleep">
					{#each col.blocks.filter((b) => b.ground) as b (b.entry.id)}
						<span
							class="block"
							data-t={paintOf(b)}
							data-clip-start={b.clippedStart ? '1' : '0'}
							data-clip-end={b.clippedEnd ? '1' : '0'}
							data-running={b.running ? '1' : '0'}
							style={`top:${top(b.from)};height:${height(b)};${across(b)}`}
						></span>
					{/each}
				</div>

				<!-- Feeds and tummy time, over the Sleep ground, so a Sleep Feed
				     reads as a band lying across its Sleep rather than fighting it.
				     A Combined Feed is one envelope with a hairline where one source
				     handed over to the next. -->
				<div class="daygrid-over" aria-hidden="true">
					{#each col.blocks.filter((b) => !b.ground) as b (b.entry.id)}
						<div
							class="block"
							data-t={b.facet}
							data-clip-start={b.clippedStart ? '1' : '0'}
							data-clip-end={b.clippedEnd ? '1' : '0'}
							data-running={b.running ? '1' : '0'}
							style={`top:${top(b.from)};height:${height(b)};${across(b)}`}
						>
							{#each b.members.slice(1).filter((part, i) => part.run !== b.members[i].run) as part (part.entry.id)}
								<span class="block-seam" style={`top:${top(part.from)}`}></span>
							{/each}
						</div>
					{/each}
				</div>

				<!-- The instants — a nappy, a meal, a milestone. They have one time
				     and no duration, so they get a rail of their own rather than a
				     block pretending to have a length. -->
				<div class="daygrid-marks" aria-hidden="true">
					{#each col.marks as mk (mk.entry.id)}
						<span class="mark" data-t={mk.facet} style={`top:${top(mk.at)}`}></span>
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
		<p class="daygrid-empty">{view === 'week' ? m.stats_week_empty() : m.stats_month_empty()}</p>
	{/if}
</div>
