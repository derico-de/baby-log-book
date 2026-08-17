import { json, type RequestHandler } from '@sveltejs/kit';
import { isResponse, readJson, requireMember, requireOwner } from '$server/api';
import { boot } from '$server/boot';
import { listPendingInvites, mintInvite, revokeInvite } from '$server/claims';
import { MAX_NAME } from '$domain/entries';

export const prerender = false;

/** The pending list an Owner can revoke from. A pending Invite is never a
    half-real person in the Household — the Member row is created on claim. */
export const GET: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;
	const forbidden = requireOwner(authed);
	if (forbidden) return forbidden;

	return json({
		invites: listPendingInvites(authed.db, authed.householdId, Date.now()).map((invite) => ({
			display_name: invite.display_name,
			role: invite.role,
			created_at: invite.created_at,
			expires_at: invite.expires_at,
			/* The handle for revoking it. It is an HMAC of a token nobody can derive
			   the token from, so it is safe to hand to the Owner's own screen. */
			handle: invite.token_hash
		}))
	});
};

/** An Owner types the display name and picks the role up front, so the timeline
    reads "Oma" from her first Entry rather than "Unnamed" (spec §6.1). */
export const POST: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;
	const forbidden = requireOwner(authed);
	if (forbidden) return forbidden;

	const body = await readJson(event);
	const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
	const role = body?.role === 'owner' ? 'owner' : 'caregiver';
	if (displayName.length === 0 || displayName.length > MAX_NAME) {
		return json({ code: 'malformed', message: 'a name is required' }, { status: 400 });
	}

	const { config } = boot();
	const link = mintInvite(authed.db, authed.secret, {
		householdId: authed.householdId,
		displayName,
		role,
		createdBy: authed.member.id,
		origin: config.origin,
		now: Date.now()
	});

	return json({ url: link.url, expires_at: link.expires_at, display_name: displayName, role });
};

export const DELETE: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;
	const forbidden = requireOwner(authed);
	if (forbidden) return forbidden;

	const handle = event.url.searchParams.get('handle') ?? '';
	const revoked = revokeInvite(authed.db, authed.householdId, handle, Date.now());
	return json({ ok: revoked }, { status: revoked ? 200 : 404 });
};
