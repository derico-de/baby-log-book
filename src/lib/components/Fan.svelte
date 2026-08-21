<script lang="ts">
	/* The FAB fan. Spec §8.5.

	   One FAB, bottom-right in thumb reach. Tapping it expands it in place into a
	   stack of six direct actions, expanding upward — so the first item is the one
	   nearest the thumb.

	   One row per entry type, and the Nappy row opens a form like the rest of
	   them (ADR-0028): Pee and Poop are two facts about one nappy rather than
	   two rows that write two Entries. Everything else opens a
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
		/** Which entry type's colour the pill wears (issue 24). */
		t: FacetKey;
		label: string;
		sub?: string;
		run: () => void;
	}

	interface Props {
		asleep: boolean;
		/** A stretch of tummy time is running, so its row ends it instead of
		    starting a second one. */
		tummyRunning: boolean;
		onNappy: () => void;
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

	/* Rendered top-to-bottom, so the array is reversed on screen: the first
	   action in the list ends up closest to the FAB. */
	const actions = $derived.by((): Action[] => {
		const common: Action[] = [
			{ key: 'nappy', icon: 'nappy', t: 'nappy', label: m.fan_nappy(), run: props.onNappy }
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
		/* *She's awake* keeps the fan open so it can reflow in place; every other
		   action is finished with it. */
		if (action.key !== 'awake') open = false;
		action.run();
	}
</script>

{#if open}
	<button class="scrim" type="button" aria-label={m.fan_close()} onclick={() => (open = false)}></button>
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
	onclick={() => (open = !open)}
>
	<Icon name="plus" />
</button>
