import type { Member, Session } from '$server/auth';

declare global {
	namespace App {
		interface Error {
			/** `removed` is deliberately distinct from an ordinary 401 (spec §6.4). */
			code?: 'unauthenticated' | 'removed' | 'forbidden' | 'protocol';
			message: string;
		}
		interface Locals {
			/** Set by the auth hook when the cookie names a Member who is still in. */
			session?: Session;
			member?: Member;
			/** The cookie names a Member who has been removed. Never conflated with
			    an ordinary 401: a 401 must never wipe local data, and this must. */
			removed?: boolean;
		}
		interface PageData {}
		interface Platform {}
	}

	/** Baked in at build time (spec §4.4) — the version line AGPL §13 needs. */
	const __APP_VERSION__: string;
	const __GIT_SHA__: string;

	interface Window {
		__blbAppearance?: {
			resolve: (now: Date, dayStart: string, override: string) => 'day' | 'night' | 'deep';
			apply: () => 'day' | 'night' | 'deep';
		};
	}
}

export {};
