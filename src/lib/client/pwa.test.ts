/* The update path the page drives (ADR-0012, ADR-0047), against stand-ins for
   the service worker objects a browser hands it. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker extends EventTarget {
	postMessage = vi.fn();
	constructor(public state: ServiceWorkerState) {
		super();
	}
	become(state: ServiceWorkerState) {
		this.state = state;
		this.dispatchEvent(new Event('statechange'));
	}
}

class FakeRegistration extends EventTarget {
	installing: FakeWorker | null = null;
	waiting: FakeWorker | null = null;
	active = new FakeWorker('activated');
	update = vi.fn(async () => this);
	unregister = vi.fn(async () => true);
}

let registration: FakeRegistration;
let reload: ReturnType<typeof vi.fn>;
let cacheNames: string[];
let health: () => Promise<Response>;

/** A new worker that starts installing when `update()` is called. */
function incoming(): FakeWorker {
	const worker = new FakeWorker('installing');
	registration.update = vi.fn(async () => {
		registration.installing = worker;
		return registration;
	});
	return worker;
}

function finishInstall(worker: FakeWorker) {
	registration.installing = null;
	registration.waiting = worker;
	worker.become('installed');
}

function failInstall(worker: FakeWorker) {
	registration.installing = null;
	worker.become('redundant');
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function load() {
	vi.resetModules();
	return import('./pwa');
}

beforeEach(() => {
	registration = new FakeRegistration();
	reload = vi.fn();
	cacheNames = ['blb-old', 'blb-new', 'other-app'];
	health = async () => new Response('ok');
	vi.stubGlobal('navigator', {
		serviceWorker: Object.assign(new EventTarget(), {
			controller: registration.active,
			getRegistration: async () => registration,
			register: async () => registration
		})
	});
	vi.stubGlobal('location', { reload });
	vi.stubGlobal('caches', {
		keys: async () => [...cacheNames],
		delete: vi.fn(async (name: string) => {
			cacheNames = cacheNames.filter((key) => key !== name);
			return true;
		})
	});
	vi.stubGlobal('fetch', vi.fn(() => health()));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('Update now', () => {
	it('waits for a download in progress instead of reloading into the old copy', async () => {
		const { requestUpdate } = await load();
		const worker = incoming();
		const outcome = requestUpdate({ force: true });
		await tick();
		expect(reload).not.toHaveBeenCalled();

		finishInstall(worker);
		expect(await outcome).toBe('reloading');
		/* The takeover reloads on controllerchange, onto the new copy. */
		expect(worker.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
		expect(reload).not.toHaveBeenCalled();
	});

	it('loads the new version straight from the server when it will not install', async () => {
		const { requestUpdate } = await load();
		const worker = incoming();
		const outcome = requestUpdate({ force: true });
		await tick();
		failInstall(worker);

		expect(await outcome).toBe('reloading');
		expect(registration.unregister).toHaveBeenCalled();
		/* Only the app's own copies: the replica and the outbox live elsewhere. */
		expect(cacheNames).toEqual(['other-app']);
		expect(reload).toHaveBeenCalled();
	});

	it('changes nothing and says so when the server cannot be reached for that', async () => {
		health = async () => {
			throw new TypeError('Failed to fetch');
		};
		const { requestUpdate } = await load();
		const worker = incoming();
		const outcome = requestUpdate({ force: true });
		await tick();
		failInstall(worker);

		expect(await outcome).toBe('unreachable');
		expect(registration.unregister).not.toHaveBeenCalled();
		expect(cacheNames).toEqual(['blb-old', 'blb-new', 'other-app']);
		expect(reload).not.toHaveBeenCalled();
	});

	it('says the update is still downloading rather than reloading into the old copy', async () => {
		vi.useFakeTimers();
		const { requestUpdate } = await load();
		incoming();
		const outcome = requestUpdate({ force: true });
		await vi.advanceTimersByTimeAsync(60_000);

		expect(await outcome).toBe('downloading');
		expect(reload).not.toHaveBeenCalled();
	});

	it('still simply reloads when nothing newer exists', async () => {
		const { requestUpdate } = await load();
		expect(await requestUpdate({ force: true })).toBe('reloading');
		expect(reload).toHaveBeenCalled();
		expect(registration.unregister).not.toHaveBeenCalled();
	});
});

describe('a cold launch', () => {
	it('takes over from a worker that was still installing when the page loaded', async () => {
		/* Update now reloads before a slow install finishes, so the page that
		   loads never sees the updatefound event for it. */
		const worker = new FakeWorker('installing');
		registration.installing = worker;
		const { registerWorker } = await load();
		await registerWorker();

		finishInstall(worker);
		await tick();
		expect(worker.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
	});
});
