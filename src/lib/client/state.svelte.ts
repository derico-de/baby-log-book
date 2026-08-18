/* The app's state, in runes.

   One object, loaded from the local replica and refreshed after every write and
   every sync cycle. Every figure a screen prints is derived here rather than
   stored: the day bucket, the header, nap-vs-night, the stale banner, the stats.
   Nothing in this file materialises anything (spec §3.5). */

import { EMPTY_FILTER, filterEntries, isFiltered, type Filter, type FilterContext } from '$domain/filter';
import { bottleTargetOf, headerState, type HeaderState } from '$domain/targets';
import { staleSleepState, type StaleState } from '$domain/sleep';
import { addDays, dayBucketOf } from '$domain/time';
import { DEFAULT_DAY_START } from '$domain/types';
import type { Baby, Entry, Food, Household, MemberRecord, Target } from '$domain/types';
import { checkReplicaSchema, getMeta, META, replica, setMeta, type ReplicaDb } from './db';
import { deviceZone, mirrorDayStart } from './device';
import { SyncEngine, type SyncStatus } from './sync';
import type { Writer } from './mutate';
import { adoptLocale, installLocaleStrategy } from '$lib/i18n/locale.svelte';

const TICK_MS = 10_000;
const TOAST_MS = 6000;

export interface Toast {
	text: string;
	/** Undo, not confirm. The fan taxes nothing to prevent a mistake that is
	    cheap to correct (spec §8.5). */
	undo?: () => void | Promise<void>;
}

export interface Identity {
	memberId: string;
	householdId: string;
	role: MemberRecord['role'];
	displayName: string;
}

class AppState {
	/* --- lifecycle ---------------------------------------------------- */
	ready = $state(false);
	/** No session and no local replica: this Device has never been claimed. */
	unclaimed = $state(false);
	identity = $state<Identity | null>(null);

	/* --- the replica -------------------------------------------------- */
	household = $state<Household | null>(null);
	babies = $state<Baby[]>([]);
	members = $state<MemberRecord[]>([]);
	foods = $state<Food[]>([]);
	targets = $state<Target[]>([]);
	entries = $state<Entry[]>([]);

	/* --- session-lived UI state --------------------------------------- */
	now = $state(Date.now());
	/** A filter is a lookup, not a setting: it survives a trip to Stats or
	    Settings and never survives a cold start (spec §8.7). */
	filter = $state<Filter>({ ...EMPTY_FILTER });
	/** The filter header can stand before anything is armed: tapping the search
	    icon replaces the live block with the inverted header at once, so the
	    mode change is visible before the first chip is pressed (spec §8.7,
	    variant A). */
	filterOpen = $state(false);
	toast = $state<Toast | null>(null);
	selectedBabyId = $state<string | null>(null);
	sync = $state<SyncStatus>({
		state: 'idle',
		waiting: 0,
		lastSyncAt: null,
		cursor: 0,
		clockOffset: 0,
		version: null,
		updateAvailable: false,
		refused: []
	});
	/** Device-local acknowledgements of the stale-Sleep banner, keyed by Sleep. */
	staleAcks = $state<Record<string, number>>({});
	/** Has anything been logged *on this Device*? The install nudge waits for it, so
	    a grandparent's first screen is not a request (spec §9.3). */
	loggedHere = $state(false);
	/** Set when the local replica was written by a newer build and could not be
	    dropped because the outbox still holds Entries that exist nowhere else. */
	schemaBlocked = $state<number | null>(null);
	/** The zone this Device has been reporting, and since when. A layover must
	    not move a Household, so the suggestion waits 48 hours (spec §7.3). */
	zoneSuggestion = $state<string | null>(null);

	private db: ReplicaDb | null = null;
	private engine: SyncEngine | null = null;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;

	/* --- derived ------------------------------------------------------ */

	get dayStart(): string {
		return this.household?.day_start ?? DEFAULT_DAY_START;
	}

	/** The single lens: one configured Household Zone for bucketing, the
	    timeline, stats and export (spec §7.3). */
	get zone(): string {
		return this.household?.zone ?? deviceZone();
	}

	get liveBabies(): Baby[] {
		return this.babies.filter((b) => b.deleted_at == null);
	}

	get baby(): Baby | null {
		const babies = this.liveBabies;
		if (babies.length === 0) return null;
		return babies.find((b) => b.id === this.selectedBabyId) ?? babies[0];
	}

	get liveFoods(): Food[] {
		return this.foods.filter((f) => f.deleted_at == null).sort((a, b) => a.name.localeCompare(b.name));
	}

	get activeMembers(): MemberRecord[] {
		return this.members.filter((m) => m.removed_at == null);
	}

	get isParent(): boolean {
		return this.identity?.role === 'parent';
	}

	get babyEntries(): Entry[] {
		const baby = this.baby;
		if (!baby) return [];
		return this.entries.filter((e) => e.baby_id === baby.id);
	}

	get babyTargets(): Target[] {
		const baby = this.baby;
		if (!baby) return [];
		return this.targets.filter((t) => t.baby_id === baby.id && t.deleted_at == null);
	}

	/** The Bottle Life this Baby counts against — the stated Target, or the
	    seeded hour for a Baby added before the field existed. */
	get bottleTarget(): Target | null {
		const baby = this.baby;
		if (!baby) return null;
		return bottleTargetOf(this.babyTargets, baby.id);
	}

	get filterContext(): FilterContext {
		return {
			foods: new Map(this.foods.map((f) => [f.id, f.name])),
			members: new Map(this.members.map((m) => [m.id, m.display_name])),
			now: this.now,
			dayStart: this.dayStart,
			zone: this.zone
		};
	}

	get filtered(): boolean {
		return isFiltered(this.filter);
	}

	/** Whether the inverted filter header stands in the live header's place —
	    open but unarmed still shows it, because the mode change is the signal. */
	get filterHeaderShown(): boolean {
		return this.filterOpen || this.filtered;
	}

	/** What the timeline would hold unfiltered — the N in "3 of 240 entries". */
	get timelineTotal(): number {
		return filterEntries(this.babyEntries, EMPTY_FILTER, this.filterContext).length;
	}

	/** The timeline, reverse-chronological. */
	get visible(): Entry[] {
		return filterEntries(this.babyEntries, this.filter, this.filterContext);
	}

	get header(): HeaderState | null {
		const baby = this.baby;
		if (!baby) return null;
		return headerState({
			entries: this.babyEntries,
			targets: this.babyTargets,
			now: this.now,
			dayStart: this.dayStart,
			zone: this.zone,
			babyId: baby.id
		});
	}

	/** The running Sleep, if there is one — visible on every Member's Device,
	    which is the primary defence against a forgotten stop. */
	get runningSleep(): Entry | null {
		return this.header?.sleep.running ?? null;
	}

	get runningFeed(): Entry | null {
		return (
			this.babyEntries.find(
				(e) =>
					(e.type === 'breast_feed' || e.type === 'bottle_feed') &&
					e.ended_at == null &&
					e.deleted_at == null &&
					e.merged_into == null
			) ?? null
		);
	}

	get stale(): StaleState & { sleep: Entry | null } {
		const sleep = this.runningSleep;
		const baby = this.baby;
		if (!sleep || !baby) return { stale: false, reason: null, since: null, sleep: null };
		const state = staleSleepState({
			sleep,
			entries: this.babyEntries,
			now: this.now,
			birthDate: baby.birth_date,
			dayStart: this.dayStart,
			zone: this.zone,
			ackAt: this.staleAcks[sleep.id] ?? null
		});
		return { ...state, sleep };
	}

	get todayKey(): string {
		return dayBucketOf(this.now, this.dayStart, this.zone);
	}

	get yesterdayKey(): string {
		return addDays(this.todayKey, -1);
	}

	memberName(id: string | null): string | null {
		if (!id) return null;
		return this.members.find((m) => m.id === id)?.display_name ?? null;
	}

	foodName(id: string): string {
		return this.foods.find((f) => f.id === id)?.name ?? '';
	}

	/* --- the write side ----------------------------------------------- */

	get writer(): Writer | null {
		const db = this.db;
		const identity = this.identity;
		if (!db || !identity) return null;
		return {
			db,
			householdId: identity.householdId,
			memberId: identity.memberId,
			mergeAt: () => this.engine?.mergeAt() ?? Date.now(),
			now: () => Date.now(),
			kick: () => void this.engine?.sync()
		};
	}

	/** Every logging action goes through here, so two rules can be kept in one
	    place: the row appears immediately, and **logging clears the filter** —
	    the FAB is the one control that can write a row the current filter would
	    hide, and a write with no visible row is how you log a nappy twice at 3am
	    (spec §8.7). */
	async log<T>(action: (w: Writer) => Promise<T>, toast: Toast | null, options: { clearsFilter?: boolean } = {}): Promise<T | null> {
		const w = this.writer;
		if (!w) return null;
		const result = await action(w);
		this.loggedHere = true;
		if (options.clearsFilter ?? true) this.clearFilter();
		await this.refresh();
		if (toast) this.showToast(toast);
		return result;
	}

	/** A write to a row you are already looking at — stopping or correcting it —
	    does not clear the filter: that write is visible by definition. */
	async edit<T>(action: (w: Writer) => Promise<T>, toast: Toast | null = null): Promise<T | null> {
		return this.log(action, toast, { clearsFilter: false });
	}

	showToast(toast: Toast): void {
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toast = toast;
		this.toastTimer = setTimeout(() => {
			this.toast = null;
		}, TOAST_MS);
	}

	dismissToast(): void {
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toast = null;
	}

	clearFilter(): void {
		this.filter = { ...EMPTY_FILTER };
		this.filterOpen = false;
	}

	/** Enter the filtered state through any door — the search icon, or the Food
	    catalogue in Settings — with the inverted header standing either way. */
	openFilter(filter?: Filter): void {
		if (filter) this.filter = filter;
		this.filterOpen = true;
	}

	/** *Still asleep* restarts the clock so the threshold does not fire again
	    immediately, and the Sleep stays running because it is genuine. */
	async ackStale(sleepId: string): Promise<void> {
		const next = { ...this.staleAcks, [sleepId]: Date.now() };
		this.staleAcks = next;
		if (this.db) await setMeta(this.db, META.staleAck, next);
	}

	/* --- the Household Zone suggestion -------------------------------- */

	/** Suggested, never applied. A Parent's Device reporting a different zone on
	    every sync for 48 hours prompts once, dismissibly, and never again for
	    that zone. */
	async trackZone(): Promise<void> {
		const db = this.db;
		const household = this.household;
		if (!db || !household) return;

		const zone = deviceZone();
		if (zone === household.zone) {
			this.zoneSuggestion = null;
			await setMeta(db, META.zoneSeenSince, null);
			return;
		}

		const seen = await getMeta<{ zone: string; since: number } | null>(db, META.zoneSeenSince, null);
		const now = Date.now();
		if (!seen || seen.zone !== zone) {
			await setMeta(db, META.zoneSeenSince, { zone, since: now });
			this.zoneSuggestion = null;
			return;
		}

		const dismissed = await getMeta<string[]>(db, META.zoneSuggestionDismissed, []);
		const longEnough = now - seen.since >= 48 * 60 * 60_000;
		this.zoneSuggestion = longEnough && !dismissed.includes(zone) ? zone : null;
	}

	async dismissZoneSuggestion(): Promise<void> {
		const db = this.db;
		const zone = this.zoneSuggestion;
		if (!db || !zone) return;
		const dismissed = await getMeta<string[]>(db, META.zoneSuggestionDismissed, []);
		await setMeta(db, META.zoneSuggestionDismissed, [...dismissed, zone]);
		this.zoneSuggestion = null;
	}

	async selectBaby(id: string): Promise<void> {
		this.selectedBabyId = id;
		if (this.db) await setMeta(this.db, META.selectedBaby, id);
	}

	/* --- loading ------------------------------------------------------ */

	async start(): Promise<void> {
		installLocaleStrategy();
		this.db = replica();
		await this.db.open();

		/* Before anything reads it: a replica written by a newer build is dropped
		   and re-pulled rather than misread (spec §5.4). */
		const schema = await checkReplicaSchema(this.db);
		if (!schema.compatible && !schema.reset) {
			this.schemaBlocked = schema.waiting;
		}

		const memberId = await getMeta<string | null>(this.db, META.memberId, null);
		const householdId = await getMeta<string | null>(this.db, META.householdId, null);
		this.staleAcks = await getMeta<Record<string, number>>(this.db, META.staleAck, {});
		this.loggedHere = await getMeta<boolean>(this.db, META.loggedFirstEntry, false);
		this.selectedBabyId = await getMeta<string | null>(this.db, META.selectedBaby, null);

		await this.refresh();

		const session = await this.fetchSession();
		if (session) {
			this.identity = session;
			await setMeta(this.db, META.memberId, session.memberId);
			await setMeta(this.db, META.householdId, session.householdId);
		} else if (memberId && householdId) {
			/* Offline, or signed out. Neither blocks anything local. */
			const known = this.members.find((m) => m.id === memberId);
			this.identity = {
				memberId,
				householdId,
				role: known?.role ?? 'caregiver',
				displayName: known?.display_name ?? ''
			};
		}

		if (this.identity) {
			this.engine = new SyncEngine({
				db: this.db,
				householdId: this.identity.householdId,
				onStatus: (status) => {
					this.sync = status;
					if (status.state === 'idle' || status.state === 'catching_up') void this.refresh();
				}
			});
			await this.engine.load();
			this.sync = this.engine.getStatus();
			this.engine.start();
		} else {
			this.unclaimed = true;
		}

		adoptLocale(this.members.find((m) => m.id === this.identity?.memberId)?.locale ?? null);
		await this.trackZone();
		this.startTicking();
		this.ready = true;
	}

	private async fetchSession(): Promise<Identity | null> {
		try {
			const response = await fetch('/api/session');
			if (!response.ok) return null;
			const body = (await response.json()) as {
				member: { id: string; display_name: string; role: MemberRecord['role']; locale: string | null };
				household: { id: string; day_start: string; zone: string } | null;
			};
			if (body.household) mirrorDayStart(body.household.day_start);
			adoptLocale(body.member.locale);
			return {
				memberId: body.member.id,
				householdId: body.household?.id ?? '',
				role: body.member.role,
				displayName: body.member.display_name
			};
		} catch {
			return null;
		}
	}

	/** Re-reads the replica. A year is ~7,300 entries and under 2 MB, which is
	    why nothing here is cached or paginated. */
	async refresh(): Promise<void> {
		const db = this.db;
		if (!db) return;
		const [households, babies, members, foods, targets, entries] = await Promise.all([
			db.households.toArray(),
			db.babies.toArray(),
			db.members.toArray(),
			db.foods.toArray(),
			db.targets.toArray(),
			db.entries.toArray()
		]);
		this.household = households[0] ?? null;
		this.babies = babies;
		this.members = members;
		this.foods = foods;
		this.targets = targets;
		this.entries = entries;
		if (this.household) mirrorDayStart(this.household.day_start);
		if (this.identity) {
			const me = members.find((m) => m.id === this.identity!.memberId);
			if (me) {
				this.identity = {
					...this.identity,
					role: me.role,
					displayName: me.display_name
				};
			}
		}
	}

	private startTicking(): void {
		if (typeof window === 'undefined') return;
		setInterval(() => {
			this.now = Date.now();
		}, TICK_MS);
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) this.now = Date.now();
		});
	}

	syncNow(): void {
		void this.engine?.sync();
	}

	/** The replica itself, for the two callers that need the whole store: the
	    Export and the reset lever. */
	get dbRef(): ReplicaDb | null {
		return this.db;
	}

	/** How many revisions have not reached the server. The outbox holds the only
	    copy of each of them, which is why sign-out asks first. */
	async outboxCount(): Promise<number> {
		return this.db ? this.db.outbox.count() : 0;
	}
}

export const app = new AppState();
