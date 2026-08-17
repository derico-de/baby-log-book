import { json, type RequestHandler } from '@sveltejs/kit';
import { isResponse, requireMember, versionBlock } from '$server/api';
import { cookieOptions, listDevices, revokeSession, SESSION_COOKIE } from '$server/auth';
import { boot } from '$server/boot';
import { currentCursor, theHousehold } from '$server/store';

export const prerender = false;

/** Who this Device is, and what it should pull towards. Everything else about
    the Household arrives through the log. */
export const GET: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	const household = theHousehold(authed.db);
	return json({
		member: {
			id: authed.member.id,
			display_name: authed.member.display_name,
			role: authed.member.role,
			locale: authed.member.locale
		},
		household: household
			? { id: household.id, name: household.name, day_start: household.day_start, zone: household.zone }
			: null,
		device_id: authed.session.device_id,
		devices: listDevices(authed.db, authed.member.id).length,
		cursor: currentCursor(authed.db, authed.householdId),
		...versionBlock()
	});
};

/** Explicit sign-out. The client warns before calling this while the outbox is
    non-empty — only the client knows what is waiting (spec §5.7). */
export const DELETE: RequestHandler = async (event) => {
	const { db, secret, config } = boot();
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) revokeSession(db, secret, token, Date.now());
	event.cookies.delete(SESSION_COOKIE, cookieOptions(config.secure));
	return json({ ok: true });
};
