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
	import { clockTime, duration, millilitres, takenOfOffered, length, weight } from '$lib/i18n/format';
	import { highlightParts, searchableText } from '$domain/filter';
	import { classifySleep, isSleepFeed } from '$domain/sleep';
	import { takenMl } from '$domain/entries';
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
	}
	let { entry, onopen, onstop }: Props = $props();

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

	const title = $derived.by(() => {
		switch (entry.type) {
			case 'breast_feed': {
				const side = (entry.payload as BreastFeedPayload).side;
				return `${m.type_breast_feed()} · ${side === 'left' ? m.side_left() : side === 'right' ? m.side_right() : m.side_both()}`;
			}
			case 'bottle_feed': {
				/* Bottle · Formula · 150 ml of 180. The milk type earns its place in
				   the title rather than the meta line: on a combined feed it is the
				   only thing telling two adjacent bottles apart. The headline figure
				   is what she drank; the offered amount trails it as context, and
				   only when the two differ. */
				const p = entry.payload as BottleFeedPayload;
				const taken = takenMl(p);
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
				if (taken != null) {
					parts.push(
						taken === p.volume_ml
							? millilitres(taken)
							: takenOfOffered(taken, p.volume_ml ?? 0)
					);
				}
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

	/* The hit that matched a free-text search, marked in the row that carries it. */
	const hit = $derived.by(() => {
		if (query.length === 0) return null;
		const text = searchableText(entry, app.filterContext);
		if (!text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return null;
		return highlightParts(text, query);
	});
</script>

<li>
	<button class="row" type="button" onclick={() => onopen(entry)}>
		<span class="glyph"><Icon name={GLYPH[entry.type]} /></span>
		<span class="row-main">
			<span class="row-title">
				{title}
				{#if entry.note}
					<span class="note-mark" title={entry.note}><Icon name="note" /></span>
				{/if}
				{#if live}
					<span class="live-pill">{m.row_live()}</span>
				{/if}
			</span>
			{#if hit}
				<span class="row-meta">
					{#each hit as part, index (index)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
				</span>
			{:else if meta}
				<span class="row-meta">{meta}</span>
			{/if}
		</span>
		{#if live}
			<span class="row-time">{clockTime(entry.occurred_at, zone)}</span>
		{:else}
			<span class="row-time">
				<!-- A Milestone gets an em dash where the clock time would be, which is
				     what makes a row with no visible time legible among timed ones. -->
				{entry.type === 'milestone' ? m.row_no_time() : clockTime(entry.occurred_at, zone)}
				{#if durationText}<span class="row-dur">{durationText}</span>{/if}
			</span>
		{/if}
	</button>
	{#if live}
		<div class="row-live-actions">
			<button class="stop-btn" type="button" onclick={() => onstop(entry)}>{m.row_stop()}</button>
		</div>
	{/if}
</li>

<style>
	/* The Stop button sits under the row rather than inside its tap target, so
	   opening a row and stopping it are never the same gesture. */
	.row-live-actions {
		display: flex;
		justify-content: flex-end;
		padding: 0 var(--sp-4) var(--sp-3);
		background: var(--surface);
	}
</style>
