import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { resolveSession, SESSION_COOKIE } from '$server/auth';
import { boot } from '$server/boot';

/* Boot here rather than on the first request, so a missing ORIGIN or a failed
   migration stops the container instead of serving a half-configured app.

   Prerendering the shell is exempt: it renders no server-owned data, and a build
   machine has no volume to migrate. */
export const init: ServerInit = async () => {
	if (!building) boot();
};

export const handle: Handle = async ({ event, resolve }) => {
	/* The shell is prerendered at build time, where there is no session to
	   resolve and no volume to open. */
	if (!building) {
		const { db, secret } = boot();
		const token = event.cookies.get(SESSION_COOKIE);
		if (token) {
			const auth = resolveSession(db, secret, token, Date.now());
			if (auth.ok) {
				event.locals.session = auth.session;
				event.locals.member = auth.member;
			} else if (auth.code === 'removed') {
				/* Deliberately distinct from a 401 all the way out to the client, which
				   makes a best-effort local wipe on it (spec §6.4). */
				event.locals.removed = true;
			}
		}
	}

	const response = await resolve(event);

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	/* Nothing in this app is worth crawling, and the claim page must never be
	   indexed (spec §6.1). */
	response.headers.set('X-Robots-Tag', 'noindex, nofollow');

	return response;
};
