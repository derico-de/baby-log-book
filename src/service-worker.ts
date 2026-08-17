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
