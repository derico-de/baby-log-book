/* The shared shape of every API response, and the one guard every sync route
   runs.

   Two failures that look alike and are not (spec §5.7, §6.4):

     - `unauthenticated` — the proof is stale. A 401 never blocks local writes
       and never wipes local data; the UI shows a passive "signed out — 14
       entries waiting" line and re-authenticating flushes the outbox.
     - `removed` — access has ended. The app makes a best-effort local wipe and
       says so plainly.

   Every sync response also carries the protocol version, the app version and the
   git SHA, which is what update detection piggybacks on: nothing else polls
   (spec §9.3). */

import { json, type RequestEvent } from '@sveltejs/kit';
import { PROTOCOL_VERSION } from '$domain/types';
import type { Member, Session } from './auth';
import { VERSION } from './env';
import { boot } from './boot';
import type { Db } from './db';

export interface VersionBlock {
	protocol_version: number;
	app_version: string;
	git_sha: string;
	source: string;
	server_time: number;
}

export function versionBlock(now = Date.now()): VersionBlock {
	return {
		protocol_version: PROTOCOL_VERSION,
		app_version: VERSION.app,
		git_sha: VERSION.sha,
		source: VERSION.source,
		server_time: now
	};
}

export interface Authed {
	db: Db;
	secret: Buffer;
	member: Member;
	session: Session;
	householdId: string;
}

/** Returns the caller, or the Response to send instead. */
export function requireMember(event: RequestEvent): Authed | Response {
	const { db, secret } = boot();

	if (event.locals.removed) {
		return json({ code: 'removed', ...versionBlock() }, { status: 403 });
	}
	const member = event.locals.member;
	const session = event.locals.session;
	if (!member || !session) {
		return json({ code: 'unauthenticated', ...versionBlock() }, { status: 401 });
	}
	return { db, secret, member, session, householdId: member.household_id };
}

export function isResponse(value: unknown): value is Response {
	return value instanceof Response;
}

export function requireOwner(authed: Authed): Response | null {
	if (authed.member.role === 'owner') return null;
	return json({ code: 'forbidden', message: 'only an Owner may do that' }, { status: 403 });
}

export async function readJson(event: RequestEvent): Promise<Record<string, unknown> | null> {
	try {
		const body = await event.request.json();
		if (body == null || typeof body !== 'object' || Array.isArray(body)) return null;
		return body as Record<string, unknown>;
	} catch {
		return null;
	}
}
