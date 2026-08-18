<script lang="ts">
	/* One Entry, opened from the timeline: correct it, read its history, delete it.

	   Corrections are first-class — any Member may fix any Member's Entry and the
	   history stays visible (ADR-0002) — which is exactly why the fan has no
	   confirm step. Correcting a row you are already looking at does **not** clear
	   the filter: that write is visible by definition (spec §8.7).

	   The history is the evidence a conflict leaves behind. The user never sees a
	   conflict dialog; what they can see, here, is "edited by Oma, was 120 ml" and
	   the app-attributed line a Session Merge leaves. */
	import { untrack } from 'svelte';
	import { app } from '$client/state.svelte';
	import { correctEntry, deleteEntry, undoDelete } from '$client/mutate';
	import { compareRevisions, foldEntity } from '$domain/revisions';
	import {
		clockTime,
		dateAndTime,
		dateInputValue,
		dateShort,
		millilitres,
		timeInputValue,
		weight,
		length
	} from '$lib/i18n/format';
	import { instantOnDate, wallTimeAtOrAfter } from '$domain/time';
	import { intakeMl } from '$domain/entries';
	import { applyLeftoverInput } from './leftover';
	import type {
		BottleContents,
		BottleFeedPayload,
		BreastFeedPayload,
		Entry,
		MealPayload,
		MeasurementPayload,
		MilestonePayload,
		NappyPayload,
		Revision,
		Side
	} from '$domain/types';
	import * as m from '$lib/paraglide/messages';
	import Sheet from './Sheet.svelte';

	interface Props {
		entry: Entry;
		onclose: () => void;
	}
	let { entry, onclose }: Props = $props();

	/* Read once, on open: this sheet is mounted per Entry, and the inputs below are
	   a draft the Member is editing rather than a mirror of the row. */
	const opened = untrack(() => entry);
	const zone = $derived(app.zone);
	const isSession = $derived(entry.type === 'sleep' || entry.type === 'breast_feed' || entry.type === 'bottle_feed');

	let startDate = $state(dateInputValue(opened.occurred_at, app.zone));
	let startTime = $state(timeInputValue(opened.occurred_at, app.zone));
	let endTime = $state(opened.ended_at == null ? '' : timeInputValue(opened.ended_at, app.zone));
	let note = $state(opened.note ?? '');
	/* The amount is the Intake, on every era of row: a legacy pair opens as its
	   derived figure, and saving a change converts the row (ADR-0018). */
	let intake = $state(intakeMl(opened.payload as BottleFeedPayload));
	let contents = $state((opened.payload as BottleFeedPayload).contents ?? null);
	let side = $state((opened.payload as BreastFeedPayload).side ?? 'both');
	let milestoneName = $state((opened.payload as MilestonePayload).name ?? '');
	let busy = $state(false);
	let history = $state<Revision[]>([]);

	/* The date is asked for once, on the start; the end takes its date from the
	   start, being the first time the clock reads it after she went down. */
	const startAt = $derived(instantOnDate(startDate, startTime, zone));
	const endAt = $derived(
		!isSession || endTime === ''
			? null
			: wallTimeAtOrAfter(endTime, startAt ?? entry.occurred_at, zone)
	);
	const endsOnAnotherDay = $derived(endAt != null && dateInputValue(endAt, zone) !== startDate);

	$effect(() => {
		const db = app.dbRef;
		if (!db) return;
		void db.revisions
			.where({ kind: 'entry', entity_id: entry.id })
			.toArray()
			.then((rows) => {
				history = rows.sort(compareRevisions).reverse();
			});
	});

	const title = $derived.by(() => {
		switch (entry.type) {
			case 'breast_feed':
				return m.type_breast_feed();
			case 'bottle_feed':
				return m.type_bottle_feed();
			case 'meal':
				return m.type_meal();
			case 'sleep':
				return m.type_sleep();
			case 'nappy':
				return m.type_nappy();
			case 'measurement':
				return m.type_measurement();
			case 'milestone':
				return m.type_milestone();
		}
	});

	const detail = $derived.by(() => {
		switch (entry.type) {
			case 'meal':
				return (entry.payload as MealPayload).foods
					.map((f) => {
						const name = app.foodName(f.food_id);
						return f.reaction ? `${name} — ${f.reaction}` : name;
					})
					.join(' · ');
			case 'nappy': {
				const p = entry.payload as NappyPayload;
				return p.pee && p.poop ? m.nappy_both() : p.poop ? m.nappy_poop() : m.nappy_pee();
			}
			case 'measurement': {
				const p = entry.payload as MeasurementPayload;
				return [
					p.weight_g == null ? null : weight(p.weight_g),
					p.height_mm == null ? null : length(p.height_mm),
					p.head_mm == null ? null : length(p.head_mm)
				]
					.filter(Boolean)
					.join(' · ');
			}
			default:
				return '';
		}
	});

	const contentsLabel = (value: BottleContents) =>
		value === 'breast_milk' ? m.contents_breast_milk() : value === 'formula' ? m.contents_formula() : m.contents_other();

	const FIELD_LABEL: Record<string, () => string> = {
		occurred_at: m.field_occurred_at,
		ended_at: m.field_ended_at,
		note: m.field_note,
		volume_ml: m.field_volume_ml,
		leftover_ml: m.field_leftover_ml,
		contents: m.field_contents,
		side: m.field_side,
		pee: m.field_pee,
		poop: m.field_poop,
		consistency: m.field_consistency,
		weight_g: m.field_weight_g,
		height_mm: m.field_height_mm,
		head_mm: m.field_head_mm,
		name: m.field_name,
		foods: m.field_foods,
		deleted_at: m.field_deleted_at
	};

	/** The value a field held *before* this revision: the fold of everything older
	    than it. This is what makes the row read "edited by Oma, was 120 ml" rather
	    than merely naming the field (ADR-0002, spec §3.4). */
	function previousValue(index: number, field: string): string | null {
		/* `history` is newest-first, so everything older sits after this index. */
		const older = history.slice(index + 1);
		if (older.length === 0) return null;
		const before = foldEntity(older)[field];
		return formatFieldValue(field, before);
	}

	function formatFieldValue(field: string, value: unknown): string | null {
		if (value == null) return null;
		switch (field) {
			case 'occurred_at':
			case 'ended_at':
				return clockTime(Number(value), zone);
			case 'volume_ml':
			case 'leftover_ml':
				return millilitres(Number(value));
			case 'contents':
				return contentsLabel(value as BottleContents);
			case 'weight_g':
				return weight(Number(value));
			case 'height_mm':
			case 'head_mm':
				return length(Number(value));
			case 'side':
				return value === 'left' ? m.side_left() : value === 'right' ? m.side_right() : m.side_both();
			case 'pee':
			case 'poop':
				return value === true ? m.nappy_pee() : null;
			case 'foods':
				return Array.isArray(value)
					? value.map((f) => app.foodName((f as { food_id: string }).food_id)).join(', ')
					: null;
			default:
				return typeof value === 'string' && value.length > 0 ? value : null;
		}
	}

	/** What a revision changed, in words a parent can read. */
	function describe(revision: Revision, index: number): string {
		const who = revision.author_id == null ? m.the_app() : (app.memberName(revision.author_id) ?? m.unknown_member());
		if (revision.fields.merged_into != null) return m.sheet_history_merged();
		if (index === history.length - 1) return m.sheet_history_created({ who });
		if (revision.fields.deleted_at != null) return m.sheet_history_deleted({ who });

		const named = Object.keys(revision.fields).filter((f) => FIELD_LABEL[f] != null);
		const fields = named.map((f) => FIELD_LABEL[f]()).join(', ');
		const line = m.sheet_history_changed({ who, fields: fields || Object.keys(revision.fields).join(', ') });

		/* "was 120 ml" only when one field changed and it had a value to lose. */
		if (named.length === 1) {
			const was = previousValue(index, named[0]);
			if (was) return `${line} · ${m.row_was({ value: was })}`;
		}
		return line;
	}

	async function save() {
		if (busy) return;
		busy = true;
		const fields: Record<string, unknown> = {};

		if (startAt != null && startAt !== entry.occurred_at) fields.occurred_at = startAt;

		if (isSession) {
			if (endTime === '' && entry.ended_at != null) fields.ended_at = null;
			else if (endAt != null && endAt !== entry.ended_at) fields.ended_at = endAt;
		}

		const trimmedNote = note.trim();
		if ((entry.note ?? '') !== trimmedNote) fields.note = trimmedNote.length > 0 ? trimmedNote : null;

		if (entry.type === 'bottle_feed') {
			const p = entry.payload as BottleFeedPayload;
			if (intake !== intakeMl(p)) {
				fields.volume_ml = intake;
				/* Converting a legacy row: the new Intake is the whole statement,
				   so the stored leftover is explicitly nulled — a real field write
				   that converges under last-write-wins (ADR-0018). An untouched
				   amount leaves the pair alone. */
				if (p.leftover_ml != null) fields.leftover_ml = null;
			}
			if (contents !== p.contents) fields.contents = contents;
		}
		if (entry.type === 'breast_feed' && side !== (entry.payload as BreastFeedPayload).side) {
			fields.side = side;
		}
		if (entry.type === 'milestone') {
			const written = milestoneName.trim();
			if (written.length > 0 && written !== (entry.payload as MilestonePayload).name) fields.name = written;
		}

		if (Object.keys(fields).length > 0) {
			await app.edit((w) => correctEntry(w, entry.id, fields));
		}
		busy = false;
		onclose();
	}

	async function remove() {
		if (busy) return;
		busy = true;
		await app.edit((w) => deleteEntry(w, entry.id), {
			text: m.toast_deleted({ what: title }),
			/* A tombstone keeps the payload permanently, so undo is a revision and
			   not a resurrection. */
			undo: async () => {
				await app.edit((w) => undoDelete(w, entry.id), { text: m.toast_undone() });
			}
		});
		busy = false;
		onclose();
	}
</script>

<Sheet {title} {onclose}>
	{#if detail}
		<p class="note-line">{detail}</p>
	{/if}

	<div class="field pair">
		<label>
			{m.sheet_date()}
			<input type="date" bind:value={startDate} />
		</label>
		<label>
			{m.sheet_time()}
			<input type="time" bind:value={startTime} />
		</label>
	</div>

	{#if isSession}
		<label class="field">
			{m.stale_woke_when()}
			<!-- The derived date, shown rather than assumed: a Sleep that starts at
			     22:30 and ends at 06:00 ends the next morning, and this is where you
			     can see that it did. -->
			{#if endsOnAnotherDay && endAt != null}
				<small>{dateShort(endAt, zone)}</small>
			{/if}
			<input type="time" bind:value={endTime} />
		</label>
	{/if}

	{#if entry.type === 'bottle_feed'}
		<label class="field">
			{m.sheet_intake()}
			<input type="number" inputmode="numeric" min="0" max="5000" bind:value={intake} />
		</label>
		<!-- Not a stored field: confirming a value subtracts it from the Intake
		     and the input empties itself (ADR-0018). -->
		<label class="field">
			{m.sheet_leftover()} <small>({m.optional()})</small>
			<input type="number" inputmode="numeric" min="0" max="5000" onchange={(event) => (intake = applyLeftoverInput(event, intake))} />
		</label>
		<label class="field">
			{m.sheet_contents()}
			<select bind:value={contents}>
				<option value={null}>{m.contents_unsaid()}</option>
				<option value="breast_milk">{m.contents_breast_milk()}</option>
				<option value="formula">{m.contents_formula()}</option>
				<option value="other">{m.contents_other()}</option>
			</select>
		</label>
	{:else if entry.type === 'breast_feed'}
		<div class="field seg" role="tablist">
			{#each [['left', m.side_left()], ['right', m.side_right()], ['both', m.side_both()]] as [value, label] (value)}
				<button type="button" role="tab" aria-selected={side === value} onclick={() => (side = value as Side)}>
					{label}
				</button>
			{/each}
		</div>
	{:else if entry.type === 'milestone'}
		<label class="field">
			{m.sheet_milestone_name()}
			<input type="text" bind:value={milestoneName} maxlength="200" />
		</label>
	{/if}

	<label class="field">
		{m.note()}
		<input type="text" bind:value={note} />
	</label>

	<h4>{m.sheet_history()}</h4>
	<ul class="history">
		{#each history as revision, index (revision.id)}
			<li>
				<span>{describe(revision, index)}</span>
				<time>{dateAndTime(revision.merge_at, zone)}</time>
			</li>
		{/each}
	</ul>

	<div class="sheet-acts">
		<button type="button" onclick={onclose}>{m.cancel()}</button>
		{#if entry.deleted_at == null}
			<button type="button" onclick={remove} disabled={busy}>{m.delete()}</button>
		{/if}
		<button type="button" data-primary="1" onclick={save} disabled={busy}>{m.save()}</button>
	</div>
</Sheet>

<style>
	.field {
		margin-bottom: var(--sp-3);
		padding: 0 var(--sp-4);
	}
	.pair {
		display: grid;
		/* The date input carries three fields and an icon; the time carries two. */
		grid-template-columns: 1.3fr 1fr;
		gap: var(--sp-3);
	}
	.history {
		list-style: none;
		margin: 0;
		padding: 0 var(--sp-4);
	}
	.history li {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-3);
		padding: var(--sp-2) 0;
		border-bottom: 1px solid var(--line);
		font-size: var(--fs-1);
		color: var(--ink-2);
	}
	.history time {
		color: var(--ink-3);
		white-space: nowrap;
	}
</style>
