/* The sync loop. Spec §5.4, §5.7, §9.3.

   Push the outbox, pull from the cursor, repeat when woken. Three things it must
   never do, because each of them loses data or trust:

     - It never blocks a local write. Logging goes to the outbox regardless of
       what the network is doing, including during the initial sync.
     - It never wipes local data on a 401. Only a *removed* response does that,
       and that response is deliberately a different one.
     - It never discards the outbox. Not on a protocol bump, not on a version
       mismatch, not on sign-out without warning first.

   Update detection piggybacks on this loop and nothing else polls: the response
   carries the protocol version, app version and git SHA, and a difference calls
   `registration.update()`. A second clock waking the radio to ask what the sync
   loop already asks is pure battery on a phone idle twenty hours a day. */

import { PROTOCOL_VERSION, type Revision } from '$domain/types';
import { applyRevisions } from './apply';
import { deviceId } from './device';
import { getMeta, META, setMeta, wipeEverything, type OutboxRow, type ReplicaDb } from './db';

export const POLL_MS = 30_000;
export const PUSH_BATCH = 200;

export type SyncState =
	| 'idle'
	| 'syncing'
	/** Caught up is not a state worth naming separately from idle; this one means
	    the initial sync is still running, which the timeline shows as a quiet
	    "catching up" line while logging stays live. */
	| 'catching_up'
	| 'offline'
	/** The proof is stale. Local writes continue; the UI shows a passive
	    "signed out — 14 entries waiting" line. */
	| 'signed_out'
	/** Access has ended. Best-effort local wipe, said plainly. */
	| 'removed'
	/** A protocol bump: pushes stop, pulls continue, the banner offers Update
	    now. Reads are unaffected because a bump is about writes that would be
	    wrong. */
	| 'client_behind'
	/** Arrives by design, because rollback is real. The words must say that the
	    SERVER is older, or a grandparent goes hunting through Settings. */
	| 'client_ahead';

export interface ServerVersion {
	protocol_version: number;
	app_version: string;
	git_sha: string;
	source: string;
	server_time: number;
}

export interface SyncStatus {
	state: SyncState;
	/** How many revisions are waiting. The number the passive line prints. */
	waiting: number;
	lastSyncAt: number | null;
	cursor: number;
	/** serverTime - clientTime, from the last response. */
	clockOffset: number;
	version: ServerVersion | null;
	/** Set when the server reports an app version or SHA different from ours, so
	    the caller can call registration.update(). */
	updateAvailable: boolean;
	/** Revisions the server refused, so the UI can say what happened rather than
	    silently dropping a Member's write. */
	refused: Array<{ id: string; reason: string }>;
}

export interface SyncDeps {
	db: ReplicaDb;
	householdId: string;
	fetch?: typeof globalThis.fetch;
	now?: () => number;
	onStatus?: (status: SyncStatus) => void;
	onWake?: () => void;
}

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const GIT_SHA = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'unknown';

export class SyncEngine {
	private db: ReplicaDb;
	private householdId: string;
	private fetcher: typeof globalThis.fetch;
	private clock: () => number;
	private onStatus?: (status: SyncStatus) => void;

	private status: SyncStatus = {
		state: 'idle',
		waiting: 0,
		lastSyncAt: null,
		cursor: 0,
		clockOffset: 0,
		version: null,
		updateAvailable: false,
		refused: []
	};

	private running = false;
	private again = false;
	/** Keeps the merge key strictly increasing on this Device. */
	private lastMergeAt = 0;
	private events: EventSource | null = null;
	private poll: ReturnType<typeof setInterval> | null = null;

	constructor(deps: SyncDeps) {
		this.db = deps.db;
		this.householdId = deps.householdId;
		this.fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
		this.clock = deps.now ?? Date.now;
		this.onStatus = deps.onStatus;
	}

	getStatus(): SyncStatus {
		return { ...this.status };
	}

	/** The merge key for a new local write: this Device's clock corrected by its
	    observed server offset. Never the server's arrival order — a phone offline
	    for three days would beat yesterday's correction simply by landing later.

	    Strictly increasing per Device, because two writes in the same millisecond
	    from the same Device would otherwise tie on both the timestamp and the
	    `device_id` tie-breaker, and the fold would order them arbitrarily —
	    a stop could lose to the start it followed. Across Devices the tie-break
	    is still `device_id`, exactly as specified. */
	mergeAt(): number {
		const corrected = this.clock() + this.status.clockOffset;
		this.lastMergeAt = corrected > this.lastMergeAt ? corrected : this.lastMergeAt + 1;
		return this.lastMergeAt;
	}

	private update(patch: Partial<SyncStatus>) {
		this.status = { ...this.status, ...patch };
		this.onStatus?.(this.getStatus());
	}

	async load(): Promise<void> {
		this.update({
			cursor: await getMeta(this.db, META.cursor, 0),
			clockOffset: await getMeta(this.db, META.clockOffset, 0),
			lastSyncAt: await getMeta<number | null>(this.db, META.lastSyncAt, null),
			waiting: await this.db.outbox.count()
		});
	}

	/** Coalesces overlapping requests: while one cycle runs, another request only
	   sets a flag, so an SSE storm cannot produce a stampede. */
	async sync(): Promise<void> {
		if (this.running) {
			this.again = true;
			return;
		}
		this.running = true;
		try {
			do {
				this.again = false;
				await this.cycle();
			} while (this.again);
		} finally {
			this.running = false;
		}
	}

	/** States that survive a cycle rather than being reset to 'syncing': each one
	    is a standing fact about this Device, not a phase of one sync. */
	private stuck(): boolean {
		return (
			this.status.state === 'client_behind' ||
			this.status.state === 'client_ahead' ||
			this.status.state === 'removed'
		);
	}

	private canPush(): boolean {
		return !this.stuck();
	}

	private async cycle(): Promise<void> {
		const waiting = await this.db.outbox.count();
		/* Do not paint over a stuck state: the whole point of the banner is that it
		   stays until the thing it describes changes. */
		this.update({ state: this.stuck() ? this.status.state : 'syncing', waiting });

		if (waiting > 0 && this.canPush()) {
			const sent = await this.pushBatch();
			if (!sent) return;
		}

		await this.pullAll();

		if (this.status.state === 'syncing' || this.status.state === 'catching_up') {
			this.update({
				state: 'idle',
				waiting: await this.db.outbox.count(),
				lastSyncAt: this.clock()
			});
			await setMeta(this.db, META.lastSyncAt, this.status.lastSyncAt);
		}
	}

	private noteVersion(body: Partial<ServerVersion> & Record<string, unknown>): void {
		const version: ServerVersion | null =
			typeof body.protocol_version === 'number'
				? {
						protocol_version: body.protocol_version,
						app_version: String(body.app_version ?? ''),
						git_sha: String(body.git_sha ?? ''),
						source: String(body.source ?? ''),
						server_time: Number(body.server_time ?? this.clock())
					}
				: null;
		if (!version) return;

		const offset = version.server_time - this.clock();
		void setMeta(this.db, META.clockOffset, offset);

		/* Which side is stuck decides which banner appears, and the words carry
		   the weight (spec §9.3). */
		let state = this.status.state;
		if (version.protocol_version > PROTOCOL_VERSION) state = 'client_behind';
		else if (version.protocol_version < PROTOCOL_VERSION) state = 'client_ahead';
		else if (state === 'client_behind' || state === 'client_ahead') state = 'syncing';

		this.update({
			version,
			clockOffset: offset,
			state,
			updateAvailable: version.app_version !== APP_VERSION || version.git_sha !== GIT_SHA
		});
	}

	/** Returns false when the cycle should stop here. */
	private async pushBatch(): Promise<boolean> {
		const rows = await this.db.outbox.orderBy('queued_at').limit(PUSH_BATCH).toArray();
		if (rows.length === 0) return true;
		const waitingBefore = await this.db.outbox.count();

		let response: Response;
		try {
			response = await this.fetcher('/api/sync/push', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					device_id: deviceId(),
					protocol_version: PROTOCOL_VERSION,
					revisions: rows.map(toWireRevision)
				})
			});
		} catch {
			this.update({ state: 'offline' });
			return false;
		}

		if (!(await this.handleAuth(response))) return false;

		const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
		this.noteVersion(body);

		if (response.status === 409) {
			/* Protocol mismatch. Nothing was applied and nothing is discarded. */
			return false;
		}
		if (!response.ok) {
			await this.db.outbox
				.where('id')
				.anyOf(rows.map((r) => r.id))
				.modify((row) => {
					row.attempts += 1;
				});
			this.update({ state: 'offline' });
			return false;
		}

		const accepted = Array.isArray(body.accepted) ? (body.accepted as string[]) : [];
		const rejected = Array.isArray(body.rejected)
			? (body.rejected as Array<{ id: string; reason: string }>)
			: [];

		/* Accepted and refused both leave the outbox.

		   ADR-0013 says the outbox is data and is never discarded, and that rule is
		   kept for everything the server has not answered: a protocol bump, a 401, an
		   offline stretch. A revision the server has *refused* is different — an
		   invalid payload or a write the Member's role forbids can never become
		   acceptable, so keeping it would block every later write behind it forever.
		   What it must not do is disappear silently, which is why the reason goes to
		   the status and the UI says it. */
		await this.db.outbox.bulkDelete([...accepted, ...rejected.map((r) => r.id)]);
		if (rejected.length > 0) this.update({ refused: [...this.status.refused, ...rejected] });

		const remaining = await this.db.outbox.count();
		this.update({ waiting: remaining });
		/* More may be queued than one batch holds — but only go round again if the
		   queue actually shrank. A server that answers with ids we never sent must
		   not spin this loop. */
		if (remaining > 0 && remaining < waitingBefore) this.again = true;
		return true;
	}

	private async pullAll(): Promise<void> {
		for (let page = 0; page < 200; page++) {
			let response: Response;
			try {
				response = await this.fetcher(`/api/sync/pull?since=${this.status.cursor}`);
			} catch {
				this.update({ state: 'offline' });
				return;
			}

			if (!(await this.handleAuth(response))) return;

			const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
			this.noteVersion(body);
			if (!response.ok) {
				this.update({ state: 'offline' });
				return;
			}

			const revisions = Array.isArray(body.revisions) ? (body.revisions as Revision[]) : [];
			await applyRevisions(this.db, this.householdId, revisions);

			const cursor = Number(body.cursor ?? this.status.cursor);
			if (cursor !== this.status.cursor) {
				await setMeta(this.db, META.cursor, cursor);
				this.update({ cursor });
			}

			if (body.more !== true) return;
			/* The timeline fills as pages land, behind a quiet line. */
			this.update({ state: 'catching_up' });
		}
	}

	/** True when the caller may carry on. */
	private async handleAuth(response: Response): Promise<boolean> {
		if (response.status === 401) {
			/* Never blocks local writes and never wipes local data. */
			this.update({ state: 'signed_out', waiting: await this.db.outbox.count() });
			return false;
		}
		if (response.status === 403) {
			const body = (await response.clone().json().catch(() => ({}))) as { code?: string };
			if (body.code === 'removed') {
				await wipeEverything(this.db);
				this.update({ state: 'removed', waiting: 0, cursor: 0 });
				return false;
			}
		}
		return true;
	}

	/* --- liveness ------------------------------------------------------- */

	/** An SSE wake-up plus a foreground poll as the fallback when the connection
	    drops. The signal carries no data: there stays exactly one path by which
	    rows arrive. */
	start(): void {
		this.listen();
		this.poll = setInterval(() => {
			if (typeof document !== 'undefined' && document.hidden) return;
			/* Only when the wake-up channel is not carrying us. */
			if (this.events && this.events.readyState === EventSource.OPEN) return;
			void this.sync();
		}, POLL_MS);
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this.onVisible);
		}
		if (typeof window !== 'undefined') {
			window.addEventListener('online', this.onOnline);
		}
		void this.sync();
	}

	stop(): void {
		this.events?.close();
		this.events = null;
		if (this.poll) clearInterval(this.poll);
		this.poll = null;
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
		if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
	}

	private onVisible = () => {
		if (!document.hidden) {
			this.listen();
			void this.sync();
		}
	};

	private onOnline = () => {
		this.listen();
		void this.sync();
	};

	private listen(): void {
		if (typeof EventSource === 'undefined') return;
		if (this.events && this.events.readyState !== EventSource.CLOSED) return;
		this.events?.close();
		try {
			const source = new EventSource('/api/sync/live');
			source.addEventListener('wake', () => void this.sync());
			source.addEventListener('error', () => {
				/* The poll covers the gap; EventSource reconnects on its own. */
			});
			this.events = source;
		} catch {
			this.events = null;
		}
	}
}

export function toWireRevision(row: OutboxRow) {
	return {
		id: row.id,
		kind: row.kind,
		entity_id: row.entity_id,
		fields: row.fields,
		merge_at: row.merge_at,
		device_id: row.device_id
	};
}
