<script lang="ts">
	/* Stats — the shape of a day, and then the trend.

	   Spec §9.1 built this screen as five rolling-seven-day cards and stopped
	   there: *is this getting better*, reassurance rather than reporting. The
	   cards still answer that and are untouched below the fold. What they could
	   never answer is *when* — whether the long sleep is drifting earlier,
	   whether the feeds cluster, what 3am actually looks like across a week. So
	   the grid goes on top: an hour axis, one column per day, every Entry in its
	   own slot and its own colour.

	   Two rules of §9.1 are deliberately overturned, both recorded in the
	   ticket:

	     - **"No navigation to earlier weeks in v1."** A grid you cannot step is
	       a grid you can only ever check once, and the ask was explicitly to
	       switch days. Weeks step too, for symmetry. Nothing is remembered
	       across a cold start — the window opens on today, always, because
	       nothing this app remembers overnight may surprise anyone at 3am.
	     - **"A trend screen and only that."** It is now a trend screen *and* a
	       pattern screen. The cards keep the trend job; the grid takes the new
	       one.

	   Rolling seven days rather than a calendar week, exactly as the cards do it
	   — calendar weeks start Monday in DE and RO, and a stats screen that
	   disagrees with itself across languages is an endless bug. */
	import { app } from '$client/state.svelte';
	import { statsFor } from '$domain/stats';
	import { facetsPresent } from '$domain/grid';
	import { FACET_KEYS, type FacetKey } from '$domain/filter';
	import { addDays, dayStartInstant } from '$domain/time';
	import { dateWithWeekday, dayRange } from '$lib/i18n/format';
	import type { Entry } from '$domain/types';
	import * as m from '$lib/paraglide/messages';
	import DayGrid from '$lib/components/DayGrid.svelte';
	import EntrySheet from '$lib/components/EntrySheet.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import Notices from '$lib/components/Notices.svelte';
	import StatCard from '$lib/components/StatCard.svelte';

	const WEEK = 7;

	let view = $state<'week' | 'day'>('week');
	/* Two anchors rather than one offset: stepping a week and stepping a day are
	   different journeys, and tapping a column in the week view must not throw
	   the week away. */
	let weekEndKey = $state(app.todayKey);
	let dayKey = $state(app.todayKey);
	/* Session-scoped and never persisted, like the timeline's filter. */
	let hidden = $state<FacetKey[]>([]);
	let openEntry = $state<Entry | null>(null);

	let scrollEl = $state<HTMLElement | null>(null);

	const todayKey = $derived(app.todayKey);
	const babies = $derived(app.liveBabies);

	const keys = $derived.by(() => {
		if (view === 'day') return [dayKey];
		const out: string[] = [];
		for (let i = WEEK - 1; i >= 0; i--) out.push(addDays(weekEndKey, -i));
		return out;
	});

	const containsToday = $derived(keys.includes(todayKey));
	/* Forward is capped at today. There is no empty tomorrow to page into. */
	const atLatest = $derived(keys.at(-1)! >= todayKey);

	const present = $derived.by(() => {
		const baby = app.baby;
		if (!baby) return [] as FacetKey[];
		return facetsPresent({
			entries: app.babyEntries,
			babyId: baby.id,
			keys,
			dayStart: app.dayStart,
			zone: app.zone,
			now: app.now
		});
	});
	const shown = $derived(present.filter((f) => !hidden.includes(f)));

	const FACET_GLYPH: Record<FacetKey, IconName> = {
		feed: 'feed',
		sleep: 'sleep',
		nappy: 'nappy',
		meal: 'meal',
		tummy: 'tummy',
		measure: 'measure',
		milestone: 'flag'
	};
	const FACET_NAME: Record<FacetKey, () => string> = {
		feed: () => m.facet_feed(),
		sleep: () => m.facet_sleep(),
		nappy: () => m.facet_nappy(),
		meal: () => m.facet_meal(),
		tummy: () => m.facet_tummy(),
		measure: () => m.facet_measure(),
		milestone: () => m.facet_milestone()
	};

	/* The heading *is* the period — a second static "Stats" over a tab bar that
	   already says Stats is a word doing no work. */
	const periodLabel = $derived.by(() => {
		if (view === 'day') return dateWithWeekday(dayStartInstant(dayKey, app.dayStart, app.zone), app.zone);
		const from = dayStartInstant(keys[0], app.dayStart, app.zone);
		const to = dayStartInstant(keys.at(-1)!, app.dayStart, app.zone);
		return dayRange(from, to, app.zone);
	});

	function step(by: number) {
		if (view === 'day') {
			const next = addDays(dayKey, by);
			dayKey = next > todayKey ? todayKey : next;
		} else {
			const next = addDays(weekEndKey, by * WEEK);
			weekEndKey = next > todayKey ? todayKey : next;
		}
		focusSoon();
	}

	function jumpToday() {
		weekEndKey = todayKey;
		dayKey = todayKey;
		focusSoon();
	}

	function setView(next: 'week' | 'day') {
		if (next === view) return;
		/* Coming back to the week, land on the week that holds the day you were
		   looking at rather than wherever the week anchor was left. */
		if (next === 'week' && (dayKey > weekEndKey || dayKey < addDays(weekEndKey, -(WEEK - 1)))) {
			weekEndKey = dayKey;
		}
		view = next;
		focusSoon();
	}

	function pickDay(key: string) {
		dayKey = key;
		view = 'day';
		focusSoon();
	}

	function toggle(facet: FacetKey) {
		hidden = hidden.includes(facet) ? hidden.filter((f) => f !== facet) : [...hidden, facet];
	}

	/** The hour the grid opens on when today is not in the window: 07:00, the
	    first hour of a day anyone reads back. */
	const OPENING_HOUR = 7;

	/* Open where the day is, not at the Day Start: nobody arrives here wanting
	   to look at 05:00. The now line if it is on screen, 07:00 otherwise, both
	   parked a third of the way down so there is context above it. */
	function focusGrid() {
		const el = scrollEl;
		const body = el?.querySelector('.daygrid-body') as HTMLElement | null;
		if (!el || !body) return;
		const top = (node: Element) => node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
		const marker = el.querySelector('.daygrid-now');
		const [h, mi] = app.dayStart.split(':').map(Number);
		const startHour = (Number.isFinite(h) ? h : 5) + (Number.isFinite(mi) ? mi : 0) / 60;
		const target = marker
			? top(marker)
			: top(body) + (body.offsetHeight * (((OPENING_HOUR - startHour + 24) % 24) / 24));
		/* Parked about half a screen down, so the hours that have already
		   happened are above the line rather than off the top of it. */
		el.scrollTo({ top: Math.max(0, target - el.clientHeight * 0.55) });
	}

	let focusPending = $state(0);
	const focusSoon = () => (focusPending += 1);

	/* Parking has to survive the replica arriving. On a cold start this screen
	   renders before the local replica has finished opening, so the first frame
	   has no now line to park on and no blocks to give the grid its height;
	   parking once on mount lands at the top of the day and stays there. The
	   token below changes when the window does *and* when the entries first
	   land, and never on the minute tick — so it can never fight a thumb that
	   is already scrolling. */
	let parkedFor = '';
	$effect(() => {
		const token = `${focusPending}:${view}:${keys[0]}:${app.baby?.id ?? ''}:${app.babyEntries.length > 0}`;
		if (token === parkedFor) return;
		parkedFor = token;
		requestAnimationFrame(focusGrid);
	});

	const cards = $derived.by(() => {
		const baby = app.baby;
		if (!baby) return [];
		return statsFor({
			entries: app.babyEntries,
			babyId: baby.id,
			now: app.now,
			dayStart: app.dayStart,
			zone: app.zone
		});
	});
</script>

<section class="screen">
	<header class="head">
		<div class="head-top">
			<div class="seg seg-view" role="tablist" aria-label={m.stats_view_label()}>
				<button type="button" role="tab" aria-selected={view === 'week'} onclick={() => setView('week')}>
					{m.stats_view_week()}
				</button>
				<button type="button" role="tab" aria-selected={view === 'day'} onclick={() => setView('day')}>
					{m.stats_view_day()}
				</button>
			</div>
			{#if babies.length > 1}
				<!-- The selector appears only when a second Baby exists. -->
				<button
					class="baby"
					type="button"
					onclick={() => {
						const index = babies.findIndex((b) => b.id === app.baby?.id);
						void app.selectBaby(babies[(index + 1) % babies.length].id);
					}}
				>
					<span class="baby-dot">{app.baby?.name.slice(0, 1)}</span>
					{app.baby?.name}
				</button>
			{/if}
		</div>

		<div class="period">
			<button
				class="icon-btn"
				type="button"
				aria-label={view === 'day' ? m.stats_prev_day() : m.stats_prev_week()}
				onclick={() => step(-1)}
			>
				<Icon name="back" />
			</button>
			<h1 class="period-label num">{periodLabel}</h1>
			<button
				class="icon-btn"
				type="button"
				aria-label={view === 'day' ? m.stats_next_day() : m.stats_next_week()}
				disabled={atLatest}
				onclick={() => step(1)}
			>
				<Icon name="chev" />
			</button>
			{#if !containsToday}
				<button class="chip period-today" type="button" onclick={jumpToday}>{m.stats_today()}</button>
			{/if}
		</div>
	</header>

	<Notices />

	<div class="scroll" bind:this={scrollEl}>
		{#if present.length > 0}
			<!-- The legend is also the filter: it names every hue on the grid —
			     which is what keeps colour a scanning aid rather than the only
			     channel — and turning one off isolates a type. Only facets with
			     something in the window appear, the same admission test the cards
			     use, so nothing here is an empty category. -->
			<div class="chips daygrid-legend" role="group" aria-label={m.stats_legend()}>
				{#each FACET_KEYS.filter((f) => present.includes(f)) as facet (facet)}
					<button
						class="chip"
						type="button"
						data-t={facet}
						aria-pressed={!hidden.includes(facet)}
						onclick={() => toggle(facet)}
					>
						<Icon name={FACET_GLYPH[facet]} />
						{FACET_NAME[facet]()}
					</button>
				{/each}
			</div>
		{/if}

		{#key `${view}:${keys[0]}`}
			<div class="daygrid-swap">
				<DayGrid {keys} {view} facets={shown} onpick={pickDay} onopen={(e) => (openEntry = e)} />
			</div>
		{/key}

		{#if cards.length > 0}
			<!-- The other question, kept: the grid says what her day looks like,
			     the cards say whether it is getting better. Same scroll, no
			     switcher — they are not alternatives. -->
			<section class="trends">
				<h2 class="trends-head">{m.stats_trends()}</h2>
				<div class="cards">
					{#each cards as card (card.kind)}
						<StatCard {card} />
					{/each}
				</div>
			</section>
		{/if}
		<div class="pad-bottom"></div>
	</div>
</section>

{#if openEntry}
	<EntrySheet entry={openEntry} onclose={() => (openEntry = null)} />
{/if}
