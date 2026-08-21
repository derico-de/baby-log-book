<script lang="ts">
	/* The FAB fan. Spec §8.5.

	   One FAB, bottom-right in thumb reach. Tapping it expands it in place into a
	   stack of six direct actions, expanding upward — so the first item is the one
	   nearest the thumb.

	   Nappies still log straight from the fan — no sheet, no confirm — but Pee and
	   Poop live one level down, behind the Nappy row, which reflows the fan in
	   place to the two of them (ADR-0028). A nappy is three taps rather than two;
	   what it buys is one row per entry type at the top level and a stack that
	   still fits a small phone. Everything else opens a
	   sheet — Feeds, Measurements and Milestones because they carry real data,
	   Sleep, *She's awake* and starting tummy time only a one-field time sheet
	   prefilled with now. *Off her tummy* writes straight through, because the
	   stretch ends as the thumb presses it.

	   While a Sleep runs the fan reflows and there is no ambiguous "Feed" item:
	   *She's awake* ends the Sleep and the fan reflows **in place** to the awake
	   set, so wake-then-feed is one FAB open and a few taps rather than two
	   trips. */
	import type { FacetKey } from '$domain/filter';
	import * as m from '$lib/paraglide/messages';
	import Icon, { type IconName } from './Icon.svelte';

	interface Action {
		key: string;
		icon: IconName;
		/** Which entry type's colour the pill wears (issue 24). Absent on the one
		    row that is navigation rather than an entry type: *Back*. */
		t?: FacetKey;
		label: string;
		sub?: string;
		run: () => void;
	}

	interface Props {
		asleep: boolean;
		/** A stretch of tummy time is running, so its row ends it instead of
		    starting a second one. */
		tummyRunning: boolean;
		onPee: () => void;
		onPoop: () => void;
		onSleep: () => void;
		onFeed: () => void;
		onMeasurement: () => void;
		onMilestone: () => void;
		onAwake: () => void;
		onFeedAsleep: () => void;
		onTummyStart: () => void;
		onTummyEnd: () => void;
	}
	let props: Props = $props();

	let open = $state(false);
	/** The nappy set stands in the fan's place; a level, not a second surface. */
	let nappyOpen = $state(false);

	function close() {
		open = false;
		nappyOpen = false;
	}

	/* The rows that are navigation: they move within the fan and never close it.
	   *She's awake* is here for a different reason — it writes, and the fan
	   reflows in place around the Sleep it just ended. */
	const KEEPS_OPEN = new Set(['awake', 'nappy', 'nappy-back']);

	/* Rendered top-to-bottom, so the array is reversed on screen: the first
	   action in the list ends up closest to the FAB. */
	const actions = $derived.by((): Action[] => {
		/* One level down: the two large targets a nappy has always been, and the
		   way back. Nothing else, because the whole point of the level is that
		   the top of it holds one row per entry type. */
		if (nappyOpen) {
			return [
				{ key: 'pee', icon: 'nappy', t: 'nappy', label: m.fan_pee(), run: props.onPee },
				{ key: 'poop', icon: 'nappy', t: 'nappy', label: m.fan_poop(), run: props.onPoop },
				{ key: 'nappy-back', icon: 'back', label: m.fan_back(), run: () => (nappyOpen = false) }
			];
		}

		const common: Action[] = [
			{
				key: 'nappy',
				icon: 'nappy',
				t: 'nappy',
				label: m.fan_nappy(),
				sub: m.fan_nappy_sub(),
				run: () => (nappyOpen = true)
			}
		];
		const tail: Action[] = [
			/* Tummy time reflows the way Sleep does: while a stretch is running
			   there is no second *Tummy time* to start, only the statement that
			   ends the one that is. Its end is the whole point of the entry, and
			   the fan is where a thumb already is (spec §3.7). */
			props.tummyRunning
				? {
						key: 'tummy-end',
						icon: 'tummy',
						t: 'tummy',
						label: m.fan_tummy_end(),
						sub: m.fan_tummy_end_sub(),
						run: props.onTummyEnd
					}
				: { key: 'tummy', icon: 'tummy', t: 'tummy', label: m.fan_tummy(), run: props.onTummyStart },
			{ key: 'measurement', icon: 'measure', t: 'measure', label: m.fan_measurement(), run: props.onMeasurement },
			/* Measurement holds the second-to-last slot and is just as rare as
			   Milestone, which is why frequency is not the fan's admission test. */
			{ key: 'milestone', icon: 'flag', t: 'milestone', label: m.fan_milestone(), run: props.onMilestone }
		];

		const middle: Action[] = props.asleep
			? [
					{ key: 'awake', icon: 'sleep', t: 'sleep', label: m.fan_awake(), sub: m.fan_awake_sub(), run: props.onAwake },
					{
						key: 'feed-asleep',
						icon: 'feed',
						t: 'feed',
						label: m.fan_feed_asleep(),
						sub: m.fan_feed_asleep_sub(),
						run: props.onFeedAsleep
					}
				]
			: [
					{ key: 'sleep', icon: 'sleep', t: 'sleep', label: m.fan_sleep(), run: props.onSleep },
					{ key: 'feed', icon: 'feed', t: 'feed', label: m.fan_feed(), run: props.onFeed }
				];

		return [...common, ...middle, ...tail];
	});

	function pick(action: Action) {
		/* A row that moves within the fan leaves it open; every other action is
		   finished with it. */
		if (!KEEPS_OPEN.has(action.key)) close();
		action.run();
	}
</script>

{#if open}
	<button class="scrim" type="button" aria-label={m.fan_close()} onclick={close}></button>
	<div class="fan" role="menu">
		{#each [...actions].reverse() as action, index (action.key)}
			<button
				type="button"
				role="menuitem"
				data-t={action.t}
				style={`animation-delay:${index * 22}ms`}
				onclick={() => pick(action)}
			>
				<span class="fan-glyph"><Icon name={action.icon} /></span>
				<span>
					<span class="fan-main">{action.label}</span>
					{#if action.sub}<span class="fan-sub">{action.sub}</span>{/if}
				</span>
			</button>
		{/each}
	</div>
{/if}

<button
	class="fab"
	type="button"
	data-open={open ? '1' : '0'}
	aria-expanded={open}
	aria-label={open ? m.fan_close() : m.fan_open()}
	onclick={() => (open ? close() : (open = true))}
>
	<Icon name="plus" />
</button>
