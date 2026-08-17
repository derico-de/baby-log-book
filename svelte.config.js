import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/* The appearance resolver runs inline in <head> and blocks first paint — it is
   the only script allowed to, because a clock cannot be read from CSS and a
   resolver that runs after paint produces exactly the white flash in a dark
   bedroom that ADR-0008 exists to prevent.

   That inline script still has to survive a strict CSP, so its hash is computed
   from the shell here rather than the policy being loosened to
   `unsafe-inline`. SvelteKit adds the hashes of its own inline scripts. */
/** @returns {`sha256-${string}`} */
function shellScriptHash() {
	const shell = readFileSync('./src/app.html', 'utf8');
	const match = shell.match(/<script>([\s\S]*?)<\/script>/);
	if (!match) throw new Error('src/app.html no longer has an inline script — check the CSP hash');
	return `sha256-${createHash('sha256').update(match[1]).digest('base64')}`;
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// ADR-0012: one prerendered shell, everything else drawn client-side.
		// The service worker precaches it; registration waits until a Claim has
		// succeeded, so a Device becomes offline-capable at the moment it becomes
		// a Device (spec §9.3).
		serviceWorker: { register: false },
		// Absolute asset paths, because the service worker answers *any* navigation
		// with the precached shell: a relative href would resolve against whatever
		// URL the Member happened to open.
		paths: { relative: false },
		/** @type {NonNullable<import('@sveltejs/kit').KitConfig['csp']>} */
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', shellScriptHash()],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				// Sync is same-origin, and there is nowhere else to talk to.
				'connect-src': ['self'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none'],
				'object-src': ['none']
			}
		},
		alias: {
			$domain: 'src/lib/domain',
			$server: 'src/lib/server',
			$client: 'src/lib/client'
		}
	}
};

export default config;
