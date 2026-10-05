/* The worker's install step, against a cache store that runs out of room the
   way a phone short of storage does (ADR-0047). */

import { describe, expect, it } from 'vitest';
import { precache, refill } from './precache';

const SHELL = '/';

/** One unit of room per file; `addAll` is all-or-nothing, as the spec has it. */
class FakeCache {
	entries = new Set<string>();
	constructor(
		private store: FakeStore,
		private failWith?: () => Error
	) {}
	async match(url: string) {
		return this.entries.has(url) ? new Response('') : undefined;
	}
	async addAll(urls: string[]) {
		if (this.failWith) throw this.failWith();
		if (this.store.used() + urls.length > this.store.room) {
			throw new DOMException('Quota exceeded.', 'QuotaExceededError');
		}
		for (const url of urls) this.entries.add(url);
	}
}

class FakeStore {
	caches = new Map<string, FakeCache>();
	failWith?: () => Error;
	constructor(public room: number) {}
	used() {
		return [...this.caches.values()].reduce((sum, cache) => sum + cache.entries.size, 0);
	}
	holding(name: string, urls: string[]) {
		const cache = new FakeCache(this);
		urls.forEach((url) => cache.entries.add(url));
		this.caches.set(name, cache);
		return this;
	}
	async open(name: string) {
		if (!this.caches.has(name)) this.caches.set(name, new FakeCache(this, this.failWith));
		return this.caches.get(name)!;
	}
	async keys() {
		return [...this.caches.keys()];
	}
	async delete(name: string) {
		return this.caches.delete(name);
	}
	asCacheStorage() {
		return this as unknown as CacheStorage;
	}
}

const OLD = [SHELL, '/a.js', '/b.js', '/c.css', '/d.png', '/e.svg'];
const NEW = [SHELL, '/a2.js', '/b2.js', '/c2.css', '/d.png', '/e.svg'];

describe('installing a new version', () => {
	it('keeps the copy in use when there is room for both', async () => {
		const store = new FakeStore(20).holding('blb-old', OLD);
		expect(await precache(store.asCacheStorage(), 'blb-new', NEW)).toBe('complete');
		expect(await store.keys()).toEqual(['blb-old', 'blb-new']);
	});

	it('defers its own copy rather than fail when there is no room for a second one', async () => {
		/* Failing would keep the Device on the old version for good. The copy in
		   use is still serving, so it is never touched here. */
		const store = new FakeStore(10).holding('blb-old', OLD).holding('other-app', []);
		expect(await precache(store.asCacheStorage(), 'blb-new', NEW)).toBe('deferred');
		expect(await store.keys()).toEqual(['blb-old', 'other-app']);
	});

	it('first clears what an earlier failed install left, which can be room enough', async () => {
		/* A copy without the shell never finished, so nothing serves from it. */
		const store = new FakeStore(13).holding('blb-old', OLD).holding('blb-failed', ['/x.js', '/y.js']);
		expect(await precache(store.asCacheStorage(), 'blb-new', NEW)).toBe('complete');
		expect(await store.keys()).toEqual(['blb-old', 'blb-new']);
	});

	it('still fails when the failure is not about room, keeping the copy in use', async () => {
		const store = new FakeStore(20).holding('blb-old', OLD);
		store.failWith = () => new TypeError('Failed to fetch');
		await expect(precache(store.asCacheStorage(), 'blb-new', NEW)).rejects.toThrow('Failed to fetch');
		expect(await store.keys()).toEqual(['blb-old']);
	});
});

describe('refilling a deferred copy', () => {
	it('fills it once the old copy is gone and there is room', async () => {
		const store = new FakeStore(10).holding('blb-new', []);
		expect(await refill(store.asCacheStorage(), 'blb-new', NEW)).toBe(true);
		expect(await store.caches.get('blb-new')?.match(SHELL)).toBeDefined();
	});

	it('leaves a complete copy alone', async () => {
		const store = new FakeStore(10).holding('blb-new', NEW);
		store.caches.get('blb-new')!.addAll = async () => {
			throw new Error('should not download again');
		};
		expect(await refill(store.asCacheStorage(), 'blb-new', NEW)).toBe(true);
	});

	it('never throws while there is still no room', async () => {
		const store = new FakeStore(2).holding('blb-new', []);
		expect(await refill(store.asCacheStorage(), 'blb-new', NEW)).toBe(false);
	});
});
