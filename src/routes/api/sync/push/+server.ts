import { json, type RequestHandler } from '@sveltejs/kit';
import { isResponse, readJson, requireMember, versionBlock } from '$server/api';
import { push, SyncError } from '$server/sync';
import { revokeMember } from '$server/auth';
import { seedTargetsFor } from '$server/claims';
import { currentCursor, listTargets, theHousehold } from '$server/store';
import { wake } from '$server/live';

export const prerender = false;

/** Batches of up to ~200 revisions applied in one all-or-nothing transaction.
    The response returns the new cursor and the server's own time, so the client
    can update its offset (spec §5.4). */
export const POST: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	const body = await readJson(event);
	if (!body) return json({ code: 'malformed', message: 'expected a JSON object' }, { status: 400 });

	const deviceId = typeof body.device_id === 'string' ? body.device_id : authed.session.device_id;
	const now = Date.now();

	let result;
	try {
		result = push(authed.db, {
			householdId: authed.householdId,
			memberId: authed.member.id,
			role: authed.member.role,
			deviceId,
			revisions: body.revisions,
			now,
			protocolVersion: typeof body.protocol_version === 'number' ? body.protocol_version : undefined
		});
	} catch (error) {
		if (error instanceof SyncError) {
			/* A protocol mismatch is not the client's fault and its outbox is never
			   discarded — it keeps everything and retries once the update lands. */
			const status = error.code === 'protocol' ? 409 : 400;
			return json({ code: error.code, message: error.message, ...versionBlock(now) }, { status });
		}
		throw error;
	}

	/* Two things the server owns because a Device cannot: killing the tokens of a
	   Member who has just been removed, and seeding a new Baby's Targets so two
	   Devices adding her cannot seed two different sets. */
	for (const raw of body.revisions as Array<Record<string, unknown>>) {
		if (!result.accepted.includes(String(raw?.id))) continue;
		const fields = (raw.fields ?? {}) as Record<string, unknown>;
		if (raw.kind === 'member' && fields.removed_at != null) {
			revokeMember(authed.db, String(raw.entity_id), now);
		}
		if (raw.kind === 'baby' && typeof fields.birth_date === 'string') {
			const babyId = String(raw.entity_id);
			const seeded = listTargets(authed.db, authed.householdId).some((t) => t.baby_id === babyId);
			if (!seeded) {
				seedTargetsFor(authed.db, {
					householdId: authed.householdId,
					babyId,
					birthDate: fields.birth_date,
					zone: theHousehold(authed.db)?.zone ?? 'UTC',
					authorId: authed.member.id,
					deviceId,
					now
				});
			}
		}
	}

	/* A bare wake-up signal, never data. */
	wake();

	return json({
		/* Recomputed, because seeding a Baby's Targets above appends revisions of
		   its own. The client advances its own cursor from the pull, never from
		   here — this is the head it now knows to pull towards. */
		cursor: currentCursor(authed.db, authed.householdId),
		accepted: result.accepted,
		rejected: result.rejected,
		merged: result.merged,
		...versionBlock(result.serverTime)
	});
};
