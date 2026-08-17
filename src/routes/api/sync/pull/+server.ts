import { json, type RequestHandler } from '@sveltejs/kit';
import { isResponse, requireMember, versionBlock } from '$server/api';
import { pull, PULL_PAGE } from '$server/sync';

export const prerender = false;

/** The ordinary paged pull. Initial sync is this from cursor 0: no bootstrap
    path, no snapshot subsystem, and logging is never blocked while it runs
    (spec §5.4). */
export const GET: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	const since = Number(event.url.searchParams.get('since') ?? 0);
	const limit = Number(event.url.searchParams.get('limit') ?? PULL_PAGE);
	if (!Number.isFinite(since) || since < 0) {
		return json({ code: 'malformed', message: 'since must be a cursor' }, { status: 400 });
	}

	const now = Date.now();
	const result = pull(
		authed.db,
		authed.householdId,
		Math.floor(since),
		now,
		Math.min(Math.max(1, Math.floor(limit) || PULL_PAGE), PULL_PAGE)
	);

	return json({
		revisions: result.revisions,
		cursor: result.cursor,
		more: result.more,
		...versionBlock(now)
	});
};
