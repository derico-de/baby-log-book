/* The worker's install step, apart from the worker globals so it can be tested.
   Short of room for a second copy, a new version installs without one and
   fills it after taking over (ADR-0047). */

export const CACHE_PREFIX = 'blb-';

/** `addAll` is all-or-nothing, so a copy without the shell never finished. */
const SHELL = '/';

export type Precached = 'complete' | 'deferred';

export async function precache(storage: CacheStorage, name: string, urls: string[]): Promise<Precached> {
	await dropUnfinished(storage);
	try {
		await fill(storage, name, urls);
		return 'complete';
	} catch (error) {
		await storage.delete(name);
		/* The copy in use is still serving and is never touched here. */
		if (isOutOfRoom(error)) return 'deferred';
		throw error;
	}
}

/** True once the copy is complete. Never throws: until then the network serves. */
export async function refill(storage: CacheStorage, name: string, urls: string[]): Promise<boolean> {
	try {
		const cache = await storage.open(name);
		if (await cache.match(SHELL)) return true;
		await cache.addAll(urls);
		return true;
	} catch {
		return false;
	}
}

async function fill(storage: CacheStorage, name: string, urls: string[]): Promise<void> {
	const cache = await storage.open(name);
	await cache.addAll(urls);
}

async function dropUnfinished(storage: CacheStorage): Promise<void> {
	for (const key of await storage.keys()) {
		if (!key.startsWith(CACHE_PREFIX)) continue;
		const cache = await storage.open(key);
		if (!(await cache.match(SHELL))) await storage.delete(key);
	}
}

function isOutOfRoom(error: unknown): boolean {
	return (error as { name?: string } | null)?.name === 'QuotaExceededError';
}
