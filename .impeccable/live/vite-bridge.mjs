/* Impeccable live-mode bridge — dev only, not part of the app.
 *
 * The sandbox this repo develops in forwards port 5173 and nothing else, so
 * the browser can never reach the live helper on localhost:8400 directly.
 * This plugin serves the helper through the dev server's own origin instead:
 * it proxies the helper's browser-facing routes and rewrites the hard-coded
 * `'http://localhost:' + PORT` URLs in live.js to same-origin paths. That
 * also keeps the strict CSP intact — everything is 'self'.
 *
 * The helper's port is read per-request from .impeccable/live/server.json,
 * which the helper writes on boot, so helper restarts need no config change.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BRIDGED = new Set([
	'/live.js',
	'/detect.js',
	'/modern-screenshot.js',
	'/annotation',
	'/status',
	'/source',
	'/events',
	'/design-system/raw'
]);

export function impeccableLiveBridge() {
	return {
		name: 'impeccable-live-bridge',
		apply: 'serve',
		configureServer(server) {
			const infoPath = path.resolve('.impeccable/live/server.json');
			const helperPort = () => {
				try {
					return JSON.parse(readFileSync(infoPath, 'utf8')).port;
				} catch {
					return null;
				}
			};
			server.middlewares.use((req, res, next) => {
				const pathname = (req.url || '').split('?')[0];
				if (!BRIDGED.has(pathname) && !pathname.startsWith('/manual-edit')) return next();
				const port = helperPort();
				if (!port) {
					res.statusCode = 503;
					res.end('impeccable live helper is not running');
					return;
				}
				const upstream = http.request(
					{
						host: '127.0.0.1',
						port,
						path: req.url,
						method: req.method,
						headers: { ...req.headers, host: 'localhost:' + port }
					},
					(up) => {
						if (pathname === '/live.js') {
							let body = '';
							up.setEncoding('utf8');
							up.on('data', (chunk) => {
								body += chunk;
							});
							up.on('end', () => {
								/* `'' + '/events?...'` is a same-origin URL; EventSource and
								   fetch both resolve it against the page origin. */
								const rewritten = body.replace(
									/'http:\/\/localhost:'\s*\+\s*PORT/g,
									"''"
								);
								res.writeHead(up.statusCode || 200, {
									'content-type': 'application/javascript',
									'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
								});
								res.end(rewritten);
							});
						} else {
							res.writeHead(up.statusCode || 200, up.headers);
							up.pipe(res);
						}
					}
				);
				upstream.on('error', () => {
					if (!res.headersSent) res.writeHead(502);
					res.end('impeccable live helper unreachable');
				});
				req.pipe(upstream);
			});
		}
	};
}
