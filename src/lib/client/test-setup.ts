/* The client tests run against a real IndexedDB implementation rather than a
   mock: the outbox is the only copy of an unsynced Entry, and a mock would not
   tell us whether a transaction actually held. */

import 'fake-indexeddb/auto';

/* Dexie needs structuredClone, and a Device needs somewhere to keep its id. */
class MemoryStorage implements Storage {
	private map = new Map<string, string>();
	get length() {
		return this.map.size;
	}
	clear() {
		this.map.clear();
	}
	getItem(key: string) {
		return this.map.get(key) ?? null;
	}
	key(index: number) {
		return [...this.map.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.map.delete(key);
	}
	setItem(key: string, value: string) {
		this.map.set(key, value);
	}
}

if (!('localStorage' in globalThis)) {
	Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage() });
}
