<script lang="ts">
	/* Stats — the trend, and then the shape of a day.

	   Spec §9.1 built this screen as five rolling-seven-day cards and stopped
	   there: *is this getting better*, reassurance rather than reporting. Ticket
	   28 put a grid on top of them — an hour axis, one column per day, every
	   Entry in its own slot and its own colour — to answer the question the cards
	   never could: *when*. Whether the long sleep is drifting earlier, whether
	   the feeds cluster, what 3am actually looks like across a week.

	   Three rules of §9.1 are deliberately overturned, all recorded in the
	   tickets:

	     - **"No navigation to earlier weeks in v1."** A grid you cannot step is
	       a grid you can only ever check once. Nothing is remembered across a
	       cold start — the window opens on today, always, because nothing this
	       app remembers overnight may surprise anyone at 3am.
	     - **"A trend screen and only that."** It is a trend screen *and* a
	       pattern screen. The cards keep the trend job; the grid takes the new
	       one.
	     - **The cards were a scroll below the grid.** They are the first tab now
	       and the one this screen opens on: *is this getting better* is the
	       question somebody arrives with, and the pattern is what they step out
	       to when the answer is surprising.

	   The three tabs are Trends, Week and Month. There is no Day: what a single
	   day held is the timeline's question, answered better on the home screen,
	   and the grid's own job — a pattern you can only see by putting days beside
	   each other — starts at seven columns.

	   Rolling windows rather than calendar ones, exactly as the cards do it —
	   calendar weeks start Monday in DE and RO, and a stats screen that
	   disagrees with itself across languages is an endless bug. A "month" is
	   therefore four whole weeks: stepping it keeps every weekday in the same
	   column, so a Saturday stays comparable with a Saturday. */
	import { app } from '$client/state.svelte';
	import { statsFor, WINDOW_DAYS } from '$domain/stats';
	import { growthFor } from '$domain/growth';
	import { facetsPresent } from '$domain/grid';
	import { FACET_KEYS, type FacetKey } from '$domain/filter';
	import { addDays, dayStartInstant } from '$domain/time';
	import { dayRange } from '$lib/i18n/format';
	import * as m from '$lib/paraglide/messages';
	import DayGrid from '$lib/components/DayGrid.svelte';
	import GrowthCard from '$lib/components/GrowthCard.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import Notices from '$lib/components/Notices.svelte';
	import StatCard from '$lib/components/StatCard.svelte';

	const WEEK = 7;
	/** Four whole weeks. Calling it a month is the honest short word for it —
	    the heading states the exact range either way — and 28 columns is what
	    keeps the weekday columns aligned when the window steps. */
	const MONTH = 28;

	type Tab = 'trends' | 'week' | 'month';

	/* Trends first, and the tab this screen opens on. */
	let tab = $state<Tab>('trends');
	/* The grid view the Trends tab suspends, so coming back lands on the one you
	   left rather than resetting. */
	let view = $state<'week' | 'month'>('week');
	/* Two anchors rather than one offset: stepping a week and stepping four of
	   them are different journeys, and one should not throw the other away. */
	let weekEndKey = $state(app.todayKey);
	let monthEndKey = $state(app.todayKey);
	/* Session-scoped and never persisted, like the timeline's filter. */
	let hidden = $state<FacetKey[]>([]);

	let scrollEl = $state<HTMLElement | null>(null);

	const todayKey = $derived(app.todayKey);
	const babies = $derived(app.liveBabies);

	const days = $derived(view === 'week' ? WEEK : MONTH);
	const endKey = $derived(view === 'week' ? weekEndKey : monthEndKey);

	const keys = $derived.by(() => {
		const out: string[] = [];
		for (let i = days - 1; i >= 0; i--) out.push(addDays(endKey, -i));
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
			/* Measurements are not on this grid — see the legend below. */
		}).filter((f) => f !== 'measure');
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
		/* The cards are eight bars ending today and there is nothing to page, so
		   the heading states that window instead of offering to step it. */
		const from = tab === 'trends' ? addDays(todayKey, -WINDOW_DAYS) : keys[0];
		const to = tab === 'trends' ? todayKey : keys.at(-1)!;
		return dayRange(
			dayStartInstant(from, app.dayStart, app.zone),
			dayStartInstant(to, app.dayStart, app.zone),
			app.zone
		);
	});

	function step(by: number) {
		const next = addDays(endKey, by * days);
		const capped = next > todayKey ? todayKey : next;
		if (view === 'week') weekEndKey = capped;
		else monthEndKey = capped;
		focusSoon();
	}

	function jumpToday() {
		weekEndKey = todayKey;
		monthEndKey = todayKey;
		focusSoon();
	}

	function setTab(next: Tab) {
		if (next === tab) return;
		tab = next;
		if (next === 'trends') return;
		/* Coming back to the other window, land on the one that holds the day you
		   were looking at rather than wherever its anchor was left. */
		if (next === 'week' && (monthEndKey < weekEndKey || addDays(monthEndKey, -(MONTH - 1)) > weekEndKey)) {
			weekEndKey = monthEndKey;
		}
		if (next === 'month' && monthEndKey < weekEndKey) monthEndKey = weekEndKey;
		view = next;
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
		const token = `${focusPending}:${tab}:${view}:${keys[0]}:${app.baby?.id ?? ''}:${app.babyEntries.length > 0}`;
		if (tab === 'trends') return;
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
			zone: app.zone,
			night: app.night
		});
	});

	/* Growth is the whole log, not the window: a Baby is weighed at a check-up,
	   so a rolling week of measurements is one column and six gaps. */
	const growth = $derived.by(() => {
		const baby = app.baby;
		if (!baby) return [];
		return growthFor({ entries: app.babyEntries, babyId: baby.id });
	});
</script>

<section class="screen">
	<header class="head">
		<div class="head-top">
			<div class="seg seg-view" role="tablist" aria-label={m.stats_view_label()}>
				<button type="button" role="tab" aria-selected={tab === 'trends'} onclick={() => setTab('trends')}>
					{m.stats_trends()}
				</button>
				<button type="button" role="tab" aria-selected={tab === 'week'} onclick={() => setTab('week')}>
					{m.stats_view_week()}
				</button>
				<button type="button" role="tab" aria-selected={tab === 'month'} onclick={() => setTab('month')}>
					{m.stats_view_month()}
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
			{#if tab !== 'trends'}
				<button
					class="icon-btn"
					type="button"
					aria-label={view === 'week' ? m.stats_prev_week() : m.stats_prev_month()}
					onclick={() => step(-1)}
				>
					<Icon name="back" />
				</button>
			{/if}
			<h1 class="period-label num">{periodLabel}</h1>
			{#if tab !== 'trends'}
				<button
					class="icon-btn"
					type="button"
					aria-label={view === 'week' ? m.stats_next_week() : m.stats_next_month()}
					disabled={atLatest}
					onclick={() => step(1)}
				>
					<Icon name="chev" />
				</button>
				{#if !containsToday}
					<button class="chip period-today" type="button" onclick={jumpToday}>{m.stats_today()}</button>
				{/if}
			{/if}
		</div>
	</header>

	<Notices />

	<div class="scroll" bind:this={scrollEl}>
		{#if tab === 'trends'}
			<!-- The other question: the grid says what her day looks like, the cards
			     say whether it is getting better. Growth comes last, because it is
			     the one card nobody is checking at 3am. -->
			{#if cards.length > 0 || growth.length > 0}
				<div class="cards">
					{#each cards as card (card.kind)}
						<StatCard {card} />
					{/each}
					{#each growth as series (series.kind)}
						<GrowthCard {series} />
					{/each}
				</div>
			{:else}
				<!-- A card appears only where its type has data, so an empty tab
				     means an empty week rather than a screen to fix. -->
				<div class="empty">
					<b>{m.stats_none()}</b>
					{m.stats_none_hint()}
				</div>
			{/if}
		{:else}
			{#if present.length > 0}
				<!-- The legend is also the filter: it names every hue on the grid —
				     which is what keeps colour a scanning aid rather than the only
				     channel — and turning one off isolates a type. Only facets with
				     something in the window appear, the same admission test the cards
				     use, so nothing here is an empty category.

				     Measurements are not on it and not on the grid: a weight is a
				     fact about a Baby and not about a time of day, so a disc at
				     14:20 on a Tuesday says nothing this screen exists to say. It
				     has its own card in Trends, where it is a line over her whole
				     life. -->
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
				{#if present.includes('sleep')}
					<!-- Sleep is the one type drawn in two colours, so the two are
					     named here. It is a key and not a filter: a Night Sleep and a
					     Nap are one type wearing two faces (ADR-0033), and a chip
					     that turned one of them off would be inventing a category
					     the rest of the app does not have. -->
					<div class="bar-key daygrid-key">
						<span data-t="sleep"><i></i>{m.stats_night_label()}</span>
						<span data-t="nap"><i></i>{m.stats_naps_label()}</span>
					</div>
				{/if}
			{/if}

			{#key `${view}:${keys[0]}`}
				<div class="daygrid-swap">
					<DayGrid {keys} {view} facets={shown} />
				</div>
			{/key}
		{/if}
		<div class="pad-bottom"></div>
	</div>
</section>
