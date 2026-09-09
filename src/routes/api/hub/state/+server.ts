import { json, type RequestHandler } from '@sveltejs/kit';
import { isResponse, requireMember, versionBlock } from '$server/api';
import { readHubState } from '$server/hub';

export const prerender = false;

/** The one derived read a Hub makes (ADR-0034). No parameters and no ids: the
    session names the Household and the payload carries every Baby, so there is
    one schema whether the Household has one Baby or three.

    The path is release-coupled — the integration hardcodes it — so it is final
    at the first integration release.

    **Conditional from the first commit**, not as an optimisation later: a phone
    disconnects and a Hub never does, and a deployment plans hundreds of
    Households holding idle connections. The check order below is contract:

        session → removed → lapsed → ETag → fetch → fold

    so a quiet night costs a cursor lookup and two key computations, and never a
    fold. */
export const GET: RequestHandler = async (event) => {
	/* session → removed. A 401 sends the Hub to its re-auth flow; a 403 is the
	   config entry's death, and the integration never re-auths on it. */
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	const now = Date.now();
	const read = readHubState(authed.db, authed.householdId, {
		ifNoneMatch: event.request.headers.get('if-none-match'),
		now
	});

	if (read.status === 401 || read.status === 402) {
		return json({ code: read.code, ...versionBlock(now) }, { status: read.status });
	}

	const headers = { etag: read.etag, 'cache-control': 'no-store' };
	if (read.status === 304) return new Response(null, { status: 304, headers });
	return json({ ...versionBlock(now), ...read.state }, { headers });
};
