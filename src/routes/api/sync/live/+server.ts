import type { RequestHandler } from '@sveltejs/kit';
import { isResponse, requireMember } from '$server/api';
import { subscribe } from '$server/live';

export const prerender = false;

const KEEPALIVE_MS = 25_000;

/** An SSE channel carrying a bare wake-up signal and never data, so there stays
    exactly one path by which rows arrive — the pull. A running timer needs no
    traffic at all; it ticks client-side from its start instant (spec §5.4). */
export const GET: RequestHandler = async (event) => {
	const authed = requireMember(event);
	if (isResponse(authed)) return authed;

	let unsubscribe: (() => void) | null = null;
	let keepalive: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (line: string) => {
				try {
					controller.enqueue(encoder.encode(line));
				} catch {
					/* The client is gone; cleanup happens in cancel(). */
				}
			};

			/* Tell the client not to reconnect faster than the poll fallback. */
			send('retry: 5000\n\n');
			send('event: hello\ndata: 1\n\n');

			unsubscribe = subscribe(() => send('event: wake\ndata: 1\n\n'));
			/* A comment line, so a proxy in the middle does not time the idle
			   connection out. */
			keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
			keepalive.unref?.();
		},
		cancel() {
			unsubscribe?.();
			if (keepalive) clearInterval(keepalive);
		}
	});

	event.request.signal.addEventListener('abort', () => {
		unsubscribe?.();
		if (keepalive) clearInterval(keepalive);
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			/* Nginx buffers event streams by default; this is the one proxy hint the
			   app ships, and it is a response header rather than a config file the
			   operator has to write. */
			'x-accel-buffering': 'no'
		}
	});
};
