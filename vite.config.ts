import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/* Version and git SHA are baked in and shown in the UI beside a source link.
   That is how AGPL §13 is satisfied for every operator automatically rather
   than every self-hoster being non-compliant by default — and it doubles as
   the first question in every bug report (spec §4.4). */
const version = JSON.parse(readFileSync('./package.json', 'utf8')).version;
const sha =
	process.env.GIT_SHA ??
	(() => {
		try {
			return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
				.toString()
				.trim();
		} catch {
			/* A source tarball with no .git is a legitimate way to build this. */
			return 'unknown';
		}
	})();

/* The dev server usually runs in a container and is reached under whatever
   hostname the developer's machine answers to, which Vite rejects by default as
   a DNS-rebinding guard. VITE_ALLOWED_HOSTS is a comma-separated list for
   anything not covered here. */
const allowedHosts = [
	'localhost',
	'powerman',
	...(process.env.VITE_ALLOWED_HOSTS?.split(',')
		.map((host) => host.trim())
		.filter(Boolean) ?? [])
];

export default defineConfig({
	server: { allowedHosts },
	define: {
		__APP_VERSION__: JSON.stringify(version),
		__GIT_SHA__: JSON.stringify(sha)
	},
	plugins: [
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// The locale is decided by the Member's own preference, mirrored into a
			// cookie and a synchronous rune. Nothing about it lives in the URL.
			strategy: ['custom-account', 'cookie', 'preferredLanguage', 'baseLocale'],
			cookieName: 'blb_locale'
		}),
		sveltekit()
	],
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'domain',
					environment: 'node',
					include: ['src/lib/domain/**/*.test.ts', 'src/lib/server/**/*.test.ts']
				}
			},
			{
				extends: true,
				test: {
					name: 'client',
					environment: 'node',
					setupFiles: ['src/lib/client/test-setup.ts'],
					include: ['src/lib/client/**/*.test.ts', 'src/lib/i18n/**/*.test.ts']
				}
			},
			{
				extends: true,
				/* Svelte ships a server build and a client build; a component test that
				   resolved the server one cannot mount anything. */
				resolve: { conditions: ['browser'] },
				test: {
					name: 'components',
					environment: 'jsdom',
					setupFiles: ['src/lib/client/test-setup.ts'],
					include: ['src/lib/components/**/*.test.ts']
				}
			}
		]
	}
});
