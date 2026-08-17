import { text, type RequestHandler } from '@sveltejs/kit';
import { boot } from '$server/boot';

export const prerender = false;

/** Opens the DB and runs one trivial query, nothing more.

    Deliberately NOT "did the last sync succeed": a health check that goes
    unhealthy because a *client* misbehaves would restart-loop the container and
    make things worse. The Docker HEALTHCHECK gives boot migrations a generous
    start-period so they do not count as failure (spec §4.4). */
export const GET: RequestHandler = async () => {
	try {
		const { db } = boot();
		db.prepare('SELECT 1').get();
		return text('ok\n', { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		return text(`unhealthy: ${(error as Error).message}\n`, {
			status: 503,
			headers: { 'cache-control': 'no-store' }
		});
	}
};
