import { json, type RequestHandler } from '@sveltejs/kit';
import { readJson, versionBlock } from '$server/api';
import { boot } from '$server/boot';
import { claim, previewLink } from '$server/claims';
import { cookieOptions, SESSION_COOKIE } from '$server/auth';
import { claimLimiter, clientIp } from '$server/rate-limit';
import { theHousehold } from '$server/store';

export const prerender = false;

/** Looking. A GET may say what the link is for and must never spend it: every
    messenger fetches a URL server-side to build the preview card, so a link that
    claimed on GET would be burnt by the bot before the recipient ever saw it
    (spec §6.1). */
export const GET: RequestHandler = async (event) => {
	const { db, secret, config } = boot();
	const now = Date.now();

	/* Metered like the POST. Looking never spends the link — a preview bot must be
	   able to fetch it — but an unmetered look is a free valid/invalid oracle, and
	   guessing a token is the whole attack. */
	const ip = clientIp(event.request, event.getClientAddress, config.trustProxy);
	if (!claimLimiter.take(ip, now)) {
		return json({ ok: false, reason: 'rate_limited' }, { status: 429 });
	}

	const token = event.url.searchParams.get('t') ?? '';
	const preview = previewLink(db, secret, token, now);
	return json({ ...preview, household_exists: theHousehold(db) != null });
};

/** Claiming. A POST behind a button, which is the whole difference between
    working and not. */
export const POST: RequestHandler = async (event) => {
	const { db, secret, config } = boot();
	const now = Date.now();

	/* Rate limiting lives in the app, on this endpoint only: with a
	   proxy-agnostic image half the operators would never configure it, and
	   guessing a Claim Link token *is* the attack (spec §4.4). */
	const ip = clientIp(event.request, event.getClientAddress, config.trustProxy);
	if (!claimLimiter.take(ip, now)) {
		return json({ ok: false, reason: 'rate_limited' }, { status: 429 });
	}

	const body = await readJson(event);
	if (!body) return json({ ok: false, reason: 'invalid' }, { status: 400 });

	const token = typeof body.token === 'string' ? body.token : '';
	const deviceId = typeof body.device_id === 'string' ? body.device_id : '';
	const zone = typeof body.zone === 'string' ? body.zone : 'UTC';
	const displayName = typeof body.display_name === 'string' ? body.display_name : undefined;

	const result = claim(db, secret, { token, deviceId, zone, displayName, now });
	if (!result.ok) {
		return json(result, { status: result.reason === 'rate_limited' ? 429 : 400 });
	}

	/* HttpOnly, so page JavaScript cannot read it and an XSS cannot exfiltrate
	   it; Secure iff ORIGIN is https; SameSite=Lax. Sync is same-origin, so it
	   rides along with no client-side handling at all (spec §6.2). */
	event.cookies.set(SESSION_COOKIE, result.token, cookieOptions(config.secure));

	const household = theHousehold(db);
	return json({
		ok: true,
		kind: result.kind,
		member_id: result.memberId,
		household: household
			? { id: household.id, name: household.name, day_start: household.day_start, zone: household.zone }
			: null,
		...versionBlock(now)
	});
};
