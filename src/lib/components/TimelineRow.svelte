<script lang="ts">
	/* One timeline row. Spec §8.4.

	   Reverse-chronological, attribution on every row (`Oma · 14:05`), the Note
	   behind an icon so it costs no vertical space in the common path.

	   Two details that are rules rather than decoration:
	     - A Milestone shows no clock time — an em dash where the time would be —
	       because its precision is dropped at display, not in storage (spec §3.6).
	     - A six-hour running Feed renders as an ordinary Live Session with a Stop
	       button and draws nothing else: nothing downstream depends on when a Feed
	       ended, so a forgotten stop is harmless (spec §3.3). */
	import { app } from '$client/state.svelte';
	import { clockTime, duration, millilitres, length, weight } from '$lib/i18n/format';
	import { highlightParts } from '$domain/filter';
	import { classifySleep, isSleepFeed } from '$domain/sleep';
	import { intakeMl } from '$domain/entries';
	import { bottleLife } from '$domain/targets';
	import type {
		BottleFeedPayload,
		BreastFeedPayload,
		Entry,
		MealPayload,
		MeasurementPayload,
		MilestonePayload,
		NappyPayload
	} from '$domain/types';
	import * as m from '$lib/paraglide/messages';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		entry: Entry;
		onopen: (entry: Entry) => void;
		onstop: (entry: Entry) => void;
		/** The running Sleep's row speaks the fan's language — *She's awake* and
		    *Feed while asleep* — instead of a bare Stop (spec §8.5). */
		onawake: (entry: Entry) => void;
		onfeedasleep: () => void;
	}
	let { entry, onopen, onstop, onawake, onfeedasleep }: Props = $props();

	const GLYPH: Record<Entry['type'], IconName> = {
		breast_feed: 'feed',
		bottle_feed: 'feed',
		meal: 'meal',
		sleep: 'sleep',
		nappy: 'nappy',
		measurement: 'measure',
		milestone: 'flag'
	};

	const zone = $derived(app.zone);
	const live = $derived(entry.ended_at == null && (entry.type === 'sleep' || entry.type === 'breast_feed' || entry.type === 'bottle_feed'));
	const query = $derived(app.filter.text.trim());

	/* The countdown on a started bottle. Per row, not per Baby: a Combined Feed
	   can have two bottles open at once, and a single figure could not say which
	   one it meant. Neutral wording throughout — it counts against the hour the
	   Household typed, and the Feed's start is the only instant it has, so it
	   reads younger than the milk when the bottle was poured earlier (ADR-0016). */
	const bottle = $derived(app.bottleTarget ? bottleLife(entry, app.bottleTarget, app.now) : null);

	const title = $derived.by(() => {
		switch (entry.type) {
			case 'breast_feed': {
				const side = (entry.payload as BreastFeedPayload).side;
				return `${m.type_breast_feed()} · ${side === 'left' ? m.side_left() : side === 'right' ? m.side_right() : m.side_both()}`;
			}
			case 'bottle_feed': {
				/* Bottle · Formula · 150 ml. The milk type earns its place in the
				   title rather than the meta line: on a combined feed it is the only
				   thing telling two adjacent bottles apart. The figure is the Intake,
				   on legacy and new rows alike — the "X of Y" form is retired
				   (ADR-0018). */
				const p = entry.payload as BottleFeedPayload;
				const intake = intakeMl(p);
				const parts: string[] = [m.type_bottle_feed()];
				if (p.contents) {
					parts.push(
						p.contents === 'breast_milk'
							? m.contents_breast_milk()
							: p.contents === 'formula'
								? m.contents_formula()
								: m.contents_other()
					);
				}
				if (intake != null) parts.push(millilitres(intake));
				return parts.join(' · ');
			}
			case 'meal': {
				const foods = (entry.payload as MealPayload).foods.map((f) => app.foodName(f.food_id)).filter(Boolean);
				return foods.length > 0 ? foods.join(', ') : m.type_meal();
			}
			case 'sleep':
				return m.type_sleep();
			case 'nappy': {
				const p = entry.payload as NappyPayload;
				if (p.pee && p.poop) return m.nappy_both();
				return p.poop ? m.nappy_poop() : m.nappy_pee();
			}
			case 'measurement': {
				const p = entry.payload as MeasurementPayload;
				const parts = [
					p.weight_g == null ? null : weight(p.weight_g),
					p.height_mm == null ? null : length(p.height_mm),
					p.head_mm == null ? null : length(p.head_mm)
				].filter(Boolean);
				return parts.length > 0 ? parts.join(' · ') : m.type_measurement();
			}
			case 'milestone':
				return (entry.payload as MilestonePayload).name || m.type_milestone();
		}
	});

	/** The secondary line: who logged it, and whatever this type derives. */
	const meta = $derived.by(() => {
		const parts: string[] = [];
		const who = app.memberName(entry.logged_by);
		if (who) parts.push(who);
		if (entry.type === 'sleep') {
			parts.push(classifySleep(entry, { dayStart: app.dayStart, zone }, app.now) === 'night' ? m.row_night_sleep() : m.row_nap());
		}
		if ((entry.type === 'breast_feed' || entry.type === 'bottle_feed') && isSleepFeed(entry, app.babyEntries)) {
			parts.push(m.row_sleep_feed());
		}
		if (entry.edited_by) parts.push(m.row_edited_by({ who: app.memberName(entry.edited_by) ?? m.the_app() }));
		return parts.join(' · ');
	});

	const durationText = $derived.by(() => {
		if (entry.ended_at == null) return null;
		if (entry.type === 'sleep' || entry.type === 'breast_feed' || entry.type === 'bottle_feed') {
			return duration(entry.ended_at - entry.occurred_at);
		}
		return null;
	});

	/* Filtering returns the answer *with its context* (spec §8.7): while a
	   filter is armed the Note — and a Meal's reaction notes — are written out
	   under the row rather than hiding behind the icon, because the reaction
	   note is half of what the lookup was for. The free-text hit is marked
	   wherever it lands — title, meta or note. */
	const noteText = $derived.by(() => {
		const parts: string[] = [];
		if (entry.type === 'meal') {
			for (const f of (entry.payload as MealPayload).foods) {
				if (f.reaction) parts.push(`${app.foodName(f.food_id)}: ${f.reaction}`);
			}
		}
		if (entry.note) parts.push(entry.note);
		return parts.join(' · ');
	});
	const noteShown = $derived(noteText !== '' && app.filtered);
</script>

{#snippet highlighted(text: string)}
	{#if query.length > 0}
		{#each highlightParts(text, query) as part, index (index)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
	{:else}{text}{/if}
{/snippet}

<li>
	<button class="row" type="button" onclick={() => onopen(entry)}>
		<span class="glyph"><Icon name={GLYPH[entry.type]} /></span>
		<span class="row-main">
			<span class="row-title">
				{@render highlighted(title)}
				{#if entry.note && query.length === 0}
					<span class="note-mark" title={entry.note}><Icon name="note" /></span>
				{/if}
				{#if live}
					<span class="live-pill">{m.row_live()}</span>
				{/if}
			</span>
			{#if meta}
				<span class="row-meta">{@render highlighted(meta)}</span>
			{/if}
			{#if noteShown}
				<span class="row-note">{@render highlighted(noteText)}</span>
			{/if}
		</span>
		{#if live}
			<span class="row-time">{clockTime(entry.occurred_at, zone)}</span>
		{:else}
			<span class="row-time">
				<!-- A Milestone gets an em dash where the clock time would be, which is
				     what makes a row with no visible time legible among timed ones. -->
				{#if entry.type === 'milestone'}
					{m.row_no_time()}
				{:else if entry.type === 'sleep' && entry.ended_at != null}
					<!-- A finished Sleep states both ends — `13:45 – 14:05` — because
					     when it ended matters as much as when it began: the Wake Window
					     counts from the end. The duration stays underneath. -->
					{m.row_time_range({
						start: clockTime(entry.occurred_at, zone),
						end: clockTime(entry.ended_at, zone)
					})}
				{:else}
					{clockTime(entry.occurred_at, zone)}
				{/if}
				{#if durationText}<span class="row-dur">{durationText}</span>{/if}
			</span>
		{/if}
	</button>
	{#if live}
		<div class="row-live-actions">
			{#if entry.type === 'sleep'}
				<!-- The same two statements the fan offers while she sleeps, in the
				     same words — *She's awake* rightmost, under the thumb. -->
				<button class="stop-btn" type="button" onclick={onfeedasleep}>{m.fan_feed_asleep()}</button>
				<button class="stop-btn" type="button" onclick={() => onawake(entry)}>{m.fan_awake()}</button>
			{:else}
				{#if bottle}
					<span class="bottle-life" title={m.row_bottle_hint()} data-over={bottle.past ? '1' : '0'}>
						{bottle.past
							? m.row_bottle_past({ over: duration(bottle.pastMs ?? 0) })
							: m.row_bottle_left({ left: duration(bottle.remainingMs) })}
					</span>
				{/if}
				<button class="stop-btn" type="button" onclick={() => onstop(entry)}>{m.row_stop()}</button>
			{/if}
		</div>
	{/if}
</li>

<style>
	/* The Stop button sits under the row rather than inside its tap target, so
	   opening a row and stopping it are never the same gesture. */
	.row-live-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--sp-3);
		padding: 0 var(--sp-4) var(--sp-3);
		background: var(--surface);
	}

	/* The one colour shift the countdown makes, and it makes it once — the same
	   discipline the overdue figure in the header keeps. No second colour, no
	   badge, no escalation. */
	.bottle-life {
		font-size: var(--fs-1);
		color: var(--ink-3);
	}
	.bottle-life[data-over='1'] {
		color: var(--warn);
	}
</style>
