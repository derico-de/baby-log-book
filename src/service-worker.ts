/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/* The precached shell. ADR-0012.

   One prerendered shell, cache-first for every navigation, everything drawn
   client-side from the replica. That makes the shell and its hashed chunks **one
   atomic versioned unit**, which *deletes* the old-page-404s-on-a-new-chunk-name
   bug rather than mitigating it — and it puts the inline appearance resolver in
   exactly one file.

   The worker finishes precaching before it enters `waiting`, which is why there
   is no progress UI: there is no moment to show. */

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `blb-${version}`;

/* `build` carries the hashed chunks — including the compiled message modules, so
   offline language switching is a consequence of the architecture rather than a
   feature anyone configures (spec §9.5). */
const PRECACHE = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			/* Deliberately NOT skipWaiting: the new worker waits for a moment
			   indistinguishable from a cold launch (spec §9.3). */
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

/* The app asks for the takeover when it is ready, never the other way round. */
sw.addEventListener('message', (event) => {
	if ((event.data as { type?: string })?.type === 'skip-waiting') void sw.skipWaiting();
});

/* A Notice, when the phone is asleep (ADR-0030, ADR-0031).

   The payload arrives encrypted to this Device and is decrypted by the browser
   before it gets here, so what the push service carried was ciphertext. The
   text is composed on the server, in the Member's own language: this worker has
   no locale of its own — it is one file for every Household on the deployment —
   and a notification in the wrong language at 3am is worse than none.

   `until` is the one thing this worker decides for itself, and it is the last
   guard on the honesty of the whole feature: a push is queued by somebody
   else's service and handed over whenever the phone next surfaces, which can be
   long after the bottle was stopped or the Feed was logged. The server already
   asks for a TTL of exactly what is left, so a stale push should never get this
   far — but *should* is not a guarantee anyone else is keeping, and popping
   "bottle nearly out" over a Feed that ended twenty minutes ago is worse than
   staying quiet.

   Staying quiet spends this app's `userVisibleOnly` promise, which is why it is
   reachable only by a push service that overran the TTL it was given: rare
   enough that the browser's budget for it is never in question, and the honest
   trade either way. */
sw.addEventListener('push', (event) => {
	let notice: { title?: string; body?: string; tag?: string; until?: number } = {};
	try {
		notice = (event.data?.json() ?? {}) as typeof notice;
	} catch {
		/* Something we did not send, or nothing at all. A push must still show
		   something — the permission was granted on that promise. */
	}
	if (typeof notice.until === 'number' && Date.now() >= notice.until) return;
	event.waitUntil(
		sw.registration.showNotification(notice.title ?? 'Baby Log Book', {
			body: notice.body ?? '',
			/* One notification per bottle, per Feed, per Wake Window: a second tick
			   replaces it rather than stacking a pile of them on the lock screen. */
			tag: notice.tag ?? 'blb',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png'
		})
	);
});

/* Straight into the app, and into the one that is already open if there is one:
   the notification exists to get someone looking at the timeline. */
sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(
		(async () => {
			const open = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of open) {
				if ('focus' in client) return client.focus();
			}
			return sw.clients.openWindow('/');
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	/* The sync endpoints, the claim endpoints and the health check are never
	   cached: a stale answer from any of them is worse than no answer. */
	if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			/* Navigations are answered from the precached shell, which is what makes
			   the app open at 3am with no network at all. */
			if (request.mode === 'navigate') {
				const shell = (await cache.match('/')) ?? (await cache.match(url.pathname));
				if (shell) return shell;
			}

			const hit = await cache.match(request, { ignoreSearch: false });
			if (hit) return hit;

			try {
				const response = await fetch(request);
				/* Only ever store what this version asked for; the precache is the
				   contract. */
				if (response.ok && PRECACHE.includes(url.pathname)) {
					await cache.put(request, response.clone());
				}
				return response;
			} catch (error) {
				const fallback = await cache.match('/');
				if (fallback) return fallback;
				throw error;
			}
		})()
	);
});
