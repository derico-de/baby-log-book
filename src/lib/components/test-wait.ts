/* Test-only. Waits for an async write path to land instead of sleeping one
   fixed beat: a save runs app.log → replica → fake-indexeddb, which takes a
   few event-loop turns, and the flat 20ms the component tests used lost that
   race on a loaded CI runner (the v1.8.0 release runs). Polls the caller's
   condition, flushing Svelte between looks; on timeout it returns anyway so
   the caller's assertion reports the actual state instead of a wait error. */

import { flushSync } from 'svelte';

export async function landed(done: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		flushSync();
		if (await done()) return;
		if (Date.now() > deadline) return;
	}
}
