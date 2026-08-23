import { json, type RequestHandler } from '@sveltejs/kit';
import { isResponse, requireMember, versionBlock } from '$server/api';
import { boot } from '$server/boot';
import { deleteOwnSubscription, saveSubscription } from '$server/notify';

export const prerender = false;

/** The key the browser needs to subscribe, and nothing else: it is the *public*
    half, it is the same for every Member, and a Device cannot subscribe without
    it. Behind the session guard all the same — an unclaimed Device has no
    business asking this deployment anything. */
export const GET: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;
	const { vapid } = boot();
	return json({ key: vapid.publicKey, ...versionBlock() });
};

/** A Device says *tell me too*. The row is the setting (ADR-0030): it exists
    only while that phone's Bottle Chime is on and its browser has granted
    permission, and it is bound to the session's own Member and Device rather
    than to anything the body claims. */
export const POST: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	let body: Record<string, unknown> | null = null;
	try {
		body = (await event.request.json()) as Record<string, unknown>;
	} catch {
		body = null;
	}
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	const keys = (body?.keys ?? {}) as Record<string, unknown>;
	const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
	const auth = typeof keys.auth === 'string' ? keys.auth : '';

	if (!endpoint || !p256dh || !auth) {
		return json({ code: 'malformed', message: 'expected endpoint and keys' }, { status: 400 });
	}
	/* An endpoint is a URL this server will later POST to. Anything else is not
	   a subscription, and https keeps it from being a request in the clear. */
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		return json({ code: 'malformed', message: 'endpoint is not a URL' }, { status: 400 });
	}
	if (parsed.protocol !== 'https:') {
		return json({ code: 'malformed', message: 'endpoint must be https' }, { status: 400 });
	}

	saveSubscription(authed.db, {
		endpoint,
		p256dh,
		auth,
		householdId: authed.householdId,
		memberId: authed.member.id,
		deviceId: authed.session.device_id,
		now: Date.now()
	});
	return json({ ok: true });
};

/** Switching the chime off, or a browser that has just revoked permission. Only
    ever this Member's own row: an endpoint is a client-supplied id, and one of
    those is never a capability (ADR-0020). */
export const DELETE: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	let body: Record<string, unknown> | null = null;
	try {
		body = (await event.request.json()) as Record<string, unknown>;
	} catch {
		body = null;
	}
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	if (!endpoint) return json({ code: 'malformed', message: 'expected endpoint' }, { status: 400 });

	/* Not found is not an error: a Device that has already lost its row is a
	   Device that is already silent, which is what the caller asked for. */
	const removed = deleteOwnSubscription(authed.db, endpoint, authed.member.id);
	return json({ ok: true, removed });
};
