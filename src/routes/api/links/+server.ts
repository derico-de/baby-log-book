import { json, type RequestHandler } from '@sveltejs/kit';
import { isResponse, readJson, requireMember, requireParent } from '$server/api';
import { boot } from '$server/boot';
import { listPendingLinks, mintInvite, mintRescue, revokePendingLink } from '$server/claims';
import { getMember } from '$server/store';
import { MAX_NAME } from '$domain/entries';

export const prerender = false;

/** Claim Links this Household has out. One endpoint for both flavours, because
    they are one question — *what is currently a way in, and do we still want it
    to be* — and because a pending Rescue Link joining the pending Invites is the
    counterweight to a Parent being able to mint credentials that write as
    somebody else (ADR-0037). */

/** The pending list a Parent can revoke from. A pending Invite is never a
    half-real person in the Household — the Member row is created on claim. */
export const GET: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;
	const forbidden = requireParent(authed);
	if (forbidden) return forbidden;

	return json({
		links: listPendingLinks(authed.db, authed.householdId, Date.now()).map((link) => ({
			kind: link.kind,
			display_name: link.display_name,
			role: link.role,
			kind_for: link.kind_for,
			member_id: link.member_id,
			created_by: link.created_by,
			created_at: link.created_at,
			expires_at: link.expires_at,
			/* The handle for revoking it. It is an HMAC of a token nobody can derive
			   the token from, so it is safe to hand to the Parent's own screen. */
			handle: link.token_hash
		}))
	});
};

/** Mints one. An Invite is a Parent's; a Rescue Link is anybody's for
    themselves, and a Parent's for anyone. */
export const POST: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	const body = await readJson(event);
	const { config } = boot();
	const now = Date.now();

	if (body?.kind === 'rescue') {
		const memberId = typeof body.member_id === 'string' ? body.member_id : '';
		/* Self-rescue is no new power — it is *add my tablet*, which a Rescue Link
		   was always also for. Minting one for somebody else is new power, and it
		   is the Parent's alone. */
		if (memberId !== authed.member.id) {
			const forbidden = requireParent(authed);
			if (forbidden) return forbidden;
		}
		/* A member id is a client-supplied id and never a capability (ADR-0020):
		   the subject has to be a live Member of *this* Household. */
		const subject = getMember(authed.db, authed.householdId, memberId);
		if (!subject || subject.removed_at != null) {
			return json({ code: 'not_found', message: 'no such Member' }, { status: 404 });
		}

		const link = mintRescue(authed.db, authed.secret, {
			householdId: authed.householdId,
			memberId: subject.id,
			createdBy: authed.member.id,
			origin: config.origin,
			now
		});
		return json({
			kind: 'rescue',
			url: link.url,
			expires_at: link.expires_at,
			display_name: subject.display_name,
			member_id: subject.id
		});
	}

	const forbidden = requireParent(authed);
	if (forbidden) return forbidden;

	const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
	const role = body?.role === 'parent' ? 'parent' : 'caregiver';
	/* Whether this Invite is for a person or for a Hub — the Parent states it,
	   and a Hub Invite locks the role to Caregiver at mint time (ADR-0038). */
	const kindFor = body?.kind_for === 'hub' ? 'hub' : 'person';
	if (displayName.length === 0 || displayName.length > MAX_NAME) {
		return json({ code: 'malformed', message: 'a name is required' }, { status: 400 });
	}

	const link = mintInvite(authed.db, authed.secret, {
		householdId: authed.householdId,
		displayName,
		role,
		kindFor,
		createdBy: authed.member.id,
		origin: config.origin,
		now
	});

	return json({
		kind: 'invite',
		url: link.url,
		expires_at: link.expires_at,
		display_name: displayName,
		/* What was minted, not what was asked for: a Hub Invite comes back as a
		   Caregiver's however the form was filled in. */
		role: kindFor === 'hub' ? 'caregiver' : role,
		kind_for: kindFor
	});
};

/** Revokes one, whichever kind it is. Any Parent may. */
export const DELETE: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;
	const forbidden = requireParent(authed);
	if (forbidden) return forbidden;

	const handle = event.url.searchParams.get('handle') ?? '';
	const revoked = revokePendingLink(authed.db, authed.householdId, handle, Date.now());
	return json({ ok: revoked }, { status: revoked ? 200 : 404 });
};
