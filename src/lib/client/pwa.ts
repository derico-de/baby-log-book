/* The PWA lifecycle. ADR-0012, spec §9.3.

   Registration waits until a Claim has succeeded — then `persist()`, then the
   initial sync — so a Device becomes offline-capable at the moment it becomes a
   Device.

   Updates:
     - Detection piggybacks on sync; nothing else polls. A second clock waking the
       radio to ask what the sync loop already asks is pure battery.
     - The new worker installs, waits, and takes over only at a moment
       indistinguishable from a cold launch: a real cold start, or a return from
       background beyond thirty minutes.
     - A running Live Session defers the reload, which closes the hole the
       thirty-minute rule opens: a Sleep runs, the phone is in a pocket for three
       hours, and the return is exactly the 3am moment the design protects. The
       deadlock is already solved — a Stale Session stops counting as running — so
       no new state and no new threshold.
     - There is no progress UI, because there is no moment to show: the worker
       finishes precaching before it enters `waiting`.
     - A version that will not install is downloaded clean on Update now
       (ADR-0047). */

import * as m from '$lib/paraglide/messages';
import { CACHE_PREFIX } from './precache';

const BACKGROUND_LIMIT_MS = 30 * 60_000;
/** How long Update now waits on a download before saying it is still running. */
const INSTALL_WAIT_MS = 30_000;

/** What Update now did, so the button can say why nothing happened. */
export type UpdateOutcome = 'reloading' | 'downloading' | 'unreachable' | 'deferred';

export function updateNote(outcome: UpdateOutcome): string | null {
	if (outcome === 'downloading') return m.update_downloading();
	if (outcome === 'unreachable') return m.update_unreachable();
	return null;
}

let waiting: ServiceWorker | null = null;
let hiddenSince: number | null = null;
/** Set once the page has been up long enough that a newly `waiting` worker can no
    longer be attributed to the previous session. */
let coldLaunchOver = false;
let reloading = false;
let installEvent: (Event & { prompt: () => Promise<void> }) | null = null;

/** Set by the app shell. Returns true while a Live Session that is *not* stale is
    running — a timer nobody stopped must not block updates forever. */
let hasLiveSession: () => boolean = () => false;

export function configurePwa(options: { hasLiveSession: () => boolean }): void {
	hasLiveSession = options.hasLiveSession;
}

export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		window.matchMedia?.('(display-mode: standalone)').matches === true ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/** One line, and the actual mitigation: an uninstalled tab holding an undrained
    outbox is a data-loss risk. */
export async function persistStorage(): Promise<boolean> {
	try {
		return (await navigator.storage?.persist?.()) ?? false;
	} catch {
		return false;
	}
}

export async function registerWorker(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	try {
		const registration = await navigator.serviceWorker.register('/service-worker.js', { type: 'module' });

		const watch = (installing: ServiceWorker | null) => {
			installing?.addEventListener('statechange', () => {
				if (installing.state === 'installed' && navigator.serviceWorker.controller) {
					waiting = installing;
					/* A cold launch may already be happening; if it is not, this waits. */
					void maybeTakeOver();
				}
			});
		};
		if (registration.waiting) waiting = registration.waiting;
		/* An install the previous page started is still running: its
		   updatefound fired before this page existed. */
		watch(registration.installing);
		registration.addEventListener('updatefound', () => watch(registration.installing));

		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (!reloading) return;
			location.reload();
		});

		/* One unconditional check on cold launch covers the Device that has been
		   offline a week. */
		void registration.update().catch(() => {});
	} catch {
		/* A browser that refuses the worker still runs the app; it is only the
		   offline shell that is lost. */
	}
}

/** Called from the sync loop when the server reports a different version, and
    from the "Update now" button with `force`. */
export async function requestUpdate(options: { force?: boolean } = {}): Promise<UpdateOutcome> {
	const registration =
		typeof navigator !== 'undefined' && 'serviceWorker' in navigator
			? await navigator.serviceWorker.getRegistration()
			: undefined;
	if (!registration) {
		if (!options.force) return 'deferred';
		location.reload();
		return 'reloading';
	}
	await registration.update().catch(() => {});
	/* update() resolves once a new worker starts installing, not once it has
	   finished, and a reload now would land on the old copy. */
	const installing = registration.installing;
	const installed = installing ? await settled(installing, INSTALL_WAIT_MS) : null;
	if (registration.waiting) waiting = registration.waiting;
	if (!options.force) {
		await maybeTakeOver();
		return 'deferred';
	}
	if (installed === 'installing') return 'downloading';
	if (installed === 'redundant') return downloadClean(registration);
	/* They asked. The rule is *never reload a screen nobody asked to reload*. */
	await takeOver();
	return 'reloading';
}

function settled(worker: ServiceWorker, timeoutMs: number): Promise<ServiceWorkerState> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			worker.removeEventListener('statechange', check);
			resolve(worker.state);
		};
		const check = () => {
			if (worker.state !== 'installing') done();
		};
		const timer = setTimeout(done, timeoutMs);
		worker.addEventListener('statechange', check);
		check();
	});
}

/** The new version would not install, so drop the offline copy and load it
    from the server. The replica and the outbox live in IndexedDB, untouched. */
async function downloadClean(registration: ServiceWorkerRegistration): Promise<UpdateOutcome> {
	try {
		/* Never cached by the worker, so this is the network answering. */
		const health = await fetch('/health', { cache: 'no-store' });
		if (!health.ok) return 'unreachable';
	} catch {
		return 'unreachable';
	}
	await registration.unregister();
	for (const key of await caches.keys()) {
		if (key.startsWith(CACHE_PREFIX)) await caches.delete(key);
	}
	reloading = true;
	location.reload();
	return 'reloading';
}

async function takeOver(): Promise<void> {
	reloading = true;
	if (waiting?.state === 'redundant') waiting = null;
	if (waiting) {
		waiting.postMessage({ type: 'skip-waiting' });
		/* controllerchange reloads; if the worker never answers, the page is still
		   fine as it is. */
		return;
	}
	location.reload();
}

const COLD_LAUNCH_MS = 20_000;

/** A moment indistinguishable from a cold launch, and no Live Session running.
    Two such moments exist (spec §9.3): a real cold start — a worker that was
    already waiting when this page loaded, installed in a previous session — and a
    return from background beyond thirty minutes. */
async function maybeTakeOver(): Promise<void> {
	if (!waiting) return;
	if (hasLiveSession()) return;

	const returnedFromBackground = hiddenSince != null && Date.now() - hiddenSince >= BACKGROUND_LIMIT_MS;
	if (!coldLaunchOver || returnedFromBackground) {
		await takeOver();
	}
}

export function watchForColdLaunch(): void {
	if (typeof document === 'undefined') return;
	/* After this, a worker entering `waiting` belongs to the session in front of
	   the Member, and taking over would be a reload nobody asked for. */
	setTimeout(() => {
		coldLaunchOver = true;
	}, COLD_LAUNCH_MS);
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			hiddenSince = Date.now();
			return;
		}
		void maybeTakeOver();
	});
}

/* --- install ---------------------------------------------------------- */

export function watchInstallPrompt(): void {
	if (typeof window === 'undefined') return;
	window.addEventListener('beforeinstallprompt', (event) => {
		/* Held so Settings can offer the row later. The event does not survive a
		   reload, which is why the Settings row must fall back to the instruction
		   rather than rendering a dead button. */
		event.preventDefault();
		installEvent = event as Event & { prompt: () => Promise<void> };
	});
}

export function canPromptInstall(): boolean {
	return installEvent != null;
}

export async function promptInstall(): Promise<void> {
	const event = installEvent;
	if (!event) return;
	installEvent = null;
	await event.prompt();
}
