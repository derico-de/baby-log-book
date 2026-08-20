<script lang="ts">
	/* The feed sheet. Spec §3.2 and §8.5.

	   Feed and Meal are separate concepts sharing one timeline: the machinery
	   differs, but the parent's question is *has she eaten*. So this is one entry
	   point with a Breast / Bottle / Food switch that reveals only the relevant
	   fields.

	   Breast feeds record the side and total duration, not per-side timers — too
	   fiddly one-handed, and the data is rarely used.

	   Picking Food while a Sleep runs switches her to awake: solids and sleep are
	   mutually exclusive, so the switch *is* the statement. The Sleep ends at the
	   Meal's Occurred At as one ordinary revision with no lasting linkage, and a
	   quiet inline line says so.

	   A running Feed works the same way: a Baby eats one thing at a time, so any
	   new feeding — the formula after the breast — ends the running Feed at the
	   new one's Occurred At, said out loud by the same kind of inline line. */
	import { app } from '$client/state.svelte';
	import { endFeedForFeed, logBottleFeed, logBreastFeed, logMeal, markAwakeForMeal, addFood } from '$client/mutate';
	import { feedingDefault } from '$client/device';
	import { clockTime, millilitres, timeInputValue } from '$lib/i18n/format';
	import { wallTimeAtOrBefore } from '$domain/time';
	import { FORMULA_PRESETS } from '$domain/entries';
	import { applyLeftoverInput } from './leftover';
	import type { BottleContents, MealAmount, MealFood, Side } from '$domain/types';
	import * as m from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		/** True when a Sleep is running: the sheet was opened from *Feed while
		    asleep*, so it must not end the Sleep unless Food is chosen. */
		asleep: boolean;
		onclose: () => void;
	}
	let { asleep, onclose }: Props = $props();

	type Mode = 'breast' | 'bottle' | 'food';

	/* The sheet opens the way this Device says feeds usually happen — a Device
	   Setting, stated in Settings and never learned from the log. Choosing a
	   different mode or contents below is session-local: nothing in this sheet
	   writes the setting back. */
	const opening = feedingDefault();
	let mode = $state<Mode>(opening === 'breast' ? 'breast' : 'bottle');
	let side = $state<Side>('both');
	let intake = $state<number | null>(null);
	let contents = $state<BottleContents | null>(opening === 'bottle_formula' ? 'formula' : 'breast_milk');
	let minutes = $state<number | null>(null);
	let note = $state('');
	let showNote = $state(false);
	let time = $state(timeInputValue(app.now, app.zone));
	let picked = $state<MealFood[]>([]);
	let foodQuery = $state('');
	let busy = $state(false);

	/* Two rows of four. The ceiling is a real bottle, not a round number: past
	   180 ml the presets are what an older Baby actually takes, and anything the
	   grid does not cover is still one tap away in the number field below. */
	const QUICK_ML = [60, 90, 120, 150, 180, 210, 240, 270];
	const AMOUNTS: MealAmount[] = ['tasted', 'some', 'lots'];
	const amountLabel = (a: MealAmount) =>
		a === 'tasted' ? m.amount_tasted() : a === 'some' ? m.amount_some() : m.amount_lots();

	const baby = $derived(app.baby);
	const runningSleep = $derived(app.runningSleep);
	const runningFeed = $derived(app.runningFeed);

	/** The Occurred At the sheet is describing, projected back through the lens.
	    Backwards from now, so the 23:45 feed you are logging at 00:20 lands on the
	    night it happened rather than tonight. */
	const occurredAt = $derived(wallTimeAtOrBefore(time, app.now, app.zone) ?? app.now);

	/* The switch is a real write, so it is visible — and undo covers it. It says so
	   only when it will actually happen: the guard is that the Meal's Occurred At
	   falls inside the running Sleep, because a back-dated Meal predating it is
	   "she ate, then went down" and leaves the Sleep alone (spec §8.5). */
	const willMarkAwake = $derived(
		mode === 'food' && asleep && runningSleep != null && occurredAt >= runningSleep.occurred_at
	);

	/* A Baby eats one thing at a time, so this save will also end a running Feed
	   at the new one's Occurred At — same shape as the awake switch: a real
	   write, said out loud, with the same back-dating guard (a new Feed predating
	   the running one is a separate, earlier feed and leaves it alone). */
	const willEndFeed = $derived(runningFeed != null && occurredAt >= runningFeed.occurred_at);

	const matchingFoods = $derived.by(() => {
		const query = foodQuery.trim().toLocaleLowerCase();
		const chosen = new Set(picked.map((p) => p.food_id));
		return app.liveFoods
			.filter((f) => !chosen.has(f.id) && (query.length === 0 || f.name.toLocaleLowerCase().includes(query)))
			.slice(0, 8);
	});

	const exactMatch = $derived.by(() => {
		const query = foodQuery.trim().toLocaleLowerCase();
		return query.length > 0 && app.liveFoods.some((f) => f.name.toLocaleLowerCase() === query);
	});

	function pickFood(id: string) {
		picked = [...picked, { food_id: id, amount: null, reaction: null }];
		foodQuery = '';
	}

	async function createFood() {
		const name = foodQuery.trim();
		if (name.length === 0) return;
		const id = await app.log(async (w) => addFood(w, name), null, { clearsFilter: false });
		if (id) pickFood(id);
	}

	async function save() {
		if (!baby || busy) return;
		busy = true;
		const at = occurredAt;
		/* Captured before the write: once the new Feed lands it is itself the
		   running Feed, and it must not be the one that gets ended. */
		const feed = runningFeed;
		const trimmed = note.trim();
		const target = { babyId: baby.id, occurredAt: at, note: trimmed.length > 0 ? trimmed : null };

		let id: string | null = null;
		/* No separate "start timer": a session saved without an end has no end,
		   and a Live Session is exactly a row with no end — the elapsed figure is
		   derived from its start instant on every paint. Saving a breast feed
		   with no duration *is* starting the timer. */
		if (mode === 'breast') {
			id = await app.log(
				(w) =>
					logBreastFeed(w, {
						...target,
						side,
						endedAt: minutes != null && minutes > 0 ? at + minutes * 60_000 : null
					}),
				{ text: m.toast_logged({ what: m.type_breast_feed() }), undo: undefined }
			);
		} else if (mode === 'bottle') {
			id = await app.log(
				(w) => logBottleFeed(w, { ...target, volumeMl: intake, contents }),
				{ text: m.toast_logged({ what: m.type_bottle_feed() }) }
			);
		} else {
			const sleep = runningSleep;
			id = await app.log((w) => logMeal(w, { ...target, foods: picked }), {
				text: m.toast_logged({ what: m.type_meal() })
			});
			if (sleep && asleep) {
				/* Guard: only when the Occurred At falls inside the running Sleep. A
				   back-dated Meal predating it is "she ate, then went down". */
				await app.edit((w) => markAwakeForMeal(w, sleep, at));
			}
		}
		if (feed) {
			/* Guard: only when the new Feed's Occurred At falls inside the running
			   one. A back-dated Feed predating it is a separate, earlier feed. */
			await app.edit((w) => endFeedForFeed(w, feed, at));
		}
		finish(id);
	}

	function finish(id: string | null) {
		busy = false;
		if (id) onclose();
	}
</script>

<Sheet title={m.sheet_feed_title()} {onclose}>
	<div class="seg" role="tablist">
		{#each [['breast', m.sheet_breast()], ['bottle', m.sheet_bottle()], ['food', m.sheet_food()]] as [value, label] (value)}
			<button
				type="button"
				role="tab"
				aria-selected={mode === value}
				onclick={() => (mode = value as Mode)}>{label}</button
			>
		{/each}
	</div>

	{#if willMarkAwake}
		<p class="note-line">{m.sheet_marked_awake({ time: clockTime(occurredAt, app.zone) })}</p>
	{/if}

	{#if willEndFeed}
		<p class="note-line">{m.sheet_ends_feed({ time: clockTime(occurredAt, app.zone) })}</p>
	{/if}

	{#if mode === 'breast'}
		<div class="seg" role="tablist" aria-label={m.sheet_breast()}>
			{#each [['left', m.side_left()], ['right', m.side_right()], ['both', m.side_both()]] as [value, label] (value)}
				<button type="button" role="tab" aria-selected={side === value} onclick={() => (side = value as Side)}>
					{label}
				</button>
			{/each}
		</div>
		<label class="field">
			{m.sheet_duration()} <small>({m.optional()})</small>
			<input type="number" inputmode="numeric" min="1" max="240" bind:value={minutes} />
		</label>
	{:else if mode === 'bottle'}
		<!-- Two buttons, not three: `other` stays a domain value for old entries
		     and remains selectable in the entry edit sheet, but at 3am the row is
		     one glance and one tap (issue 21). -->
		<div class="seg" role="tablist" aria-label={m.sheet_contents()}>
			{#each [['breast_milk', m.contents_breast_milk()], ['formula', m.contents_formula()]] as [value, label] (value)}
				<button
					type="button"
					role="tab"
					aria-selected={contents === value}
					onclick={() => (contents = value as BottleContents)}>{label}</button
				>
			{/each}
		</div>
		<div class="amounts">
			{#if contents === 'formula'}
				<!-- Water measures, because that is what a parent prepares; tapping
				     writes the *final* volume the powder brings it to (ADR-0018). -->
				{#each FORMULA_PRESETS as f (f.water)}
					<button type="button" aria-pressed={intake === f.final} onclick={() => (intake = f.final)}>
						{f.water}
						<small>{m.sheet_formula_yields({ value: f.final })}</small>
					</button>
				{/each}
			{:else}
				{#each QUICK_ML as ml (ml)}
					<button type="button" aria-pressed={intake === ml} onclick={() => (intake = ml)}>
						{millilitres(ml)}
					</button>
				{/each}
			{/if}
		</div>
	{:else}
		<div class="field">
			<label>
				{m.sheet_food_add()}
				<input type="text" bind:value={foodQuery} autocomplete="off" />
			</label>
			<div class="chips">
				{#each matchingFoods as food (food.id)}
					<button class="chip" type="button" onclick={() => pickFood(food.id)}>{food.name}</button>
				{/each}
				{#if foodQuery.trim().length > 0 && !exactMatch}
					<button class="chip" type="button" onclick={createFood}>
						<Icon name="plus" />
						{m.sheet_food_new({ name: foodQuery.trim() })}
					</button>
				{/if}
			</div>
		</div>

		{#each picked as chosen, index (chosen.food_id)}
			<div class="field picked">
				<strong>{app.foodName(chosen.food_id)}</strong>
				<div class="seg" role="tablist" aria-label={m.sheet_amount()}>
					{#each AMOUNTS as amount (amount)}
						<button
							type="button"
							role="tab"
							aria-selected={chosen.amount === amount}
							onclick={() => {
								picked = picked.map((p, i) => (i === index ? { ...p, amount } : p));
							}}>{amountLabel(amount)}</button
						>
					{/each}
				</div>
				<label>
					{m.sheet_reaction()} <small>({m.optional()})</small>
					<input
						type="text"
						value={chosen.reaction ?? ''}
						oninput={(event) => {
							const value = event.currentTarget.value;
							picked = picked.map((p, i) => (i === index ? { ...p, reaction: value || null } : p));
						}}
					/>
				</label>
			</div>
		{/each}
	{/if}

	<div class="field pair">
		<label>
			{m.sheet_time()}
			<input type="time" bind:value={time} />
		</label>
		{#if showNote}
			<label>
				{m.note()}
				<input type="text" bind:value={note} />
			</label>
		{:else}
			<div class="note-slot">
				<button class="chip" type="button" onclick={() => (showNote = true)}>
					<Icon name="note" />
					{m.note_add()}
				</button>
			</div>
		{/if}
	</div>

	{#if mode === 'bottle'}
		<div class="field pair">
			<label>
				{m.sheet_intake()}
				<input type="number" inputmode="numeric" min="0" max="5000" step="1" bind:value={intake} />
			</label>
			<!-- Not a stored field: confirming a value subtracts it from the Intake
			     and the input empties itself (ADR-0018). -->
			<label>
				{m.sheet_leftover()}
				<input type="number" inputmode="numeric" min="0" max="5000" step="1" onchange={(event) => (intake = applyLeftoverInput(event, intake))} />
			</label>
		</div>
	{/if}

	<div class="sheet-acts">
		<button type="button" onclick={onclose}>{m.cancel()}</button>
		<button type="button" data-primary="1" onclick={save} disabled={busy || (mode === 'food' && picked.length === 0)}>
			{m.save()}
		</button>
	</div>
</Sheet>

<style>
	.field {
		margin-bottom: var(--sp-3);
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
		align-items: end;
	}
	/* Keeps the *Add a note* chip on the input's baseline when its row-mate
	   is a full labelled field. */
	.note-slot {
		display: flex;
		align-items: center;
		min-height: 44px;
	}
	.picked {
		border-top: 1px solid var(--line);
		padding-top: var(--sp-3);
	}
	.picked strong {
		display: block;
		margin-bottom: var(--sp-2);
		font-size: var(--fs-2);
	}
</style>
