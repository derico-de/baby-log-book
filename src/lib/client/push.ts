/* The Device's half of push (ADR-0030).

   The subscription IS the setting: it exists exactly while this phone's Bottle
   Chime is on and its browser has granted permission, and switching the chime
   off deletes it here and on the server. There is no notification preference to
   keep in step with a Device Setting.

   Everything here fails soft. A browser with no push, a permission the Member
   said no to, a server that cannot be reached: each leaves the in-app chime
   working exactly as it did, and Settings says which of them happened. */

export type PushOutcome =
	/** Subscribed: this phone can be woken with the app closed. */
	| 'on'
	/** The Member said no, or the browser has the site blocked. */
	| 'denied'
	/** No push in this browser at all — on an iPhone, until the app is installed. */
	| 'unsupported'
	/** Everything is in place but the round trip did not finish; the in-app chime
	    still works and the next launch tries again. */
	| 'failed';

function supported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

/** The applicationServerKey wants the raw point, not the base64url the server
    speaks. */
function decodeKey(value: string): ArrayBuffer {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

async function serverKey(): Promise<string | null> {
	try {
		const response = await fetch('/api/push');
		if (!response.ok) return null;
		const body = (await response.json()) as { key?: string };
		return typeof body.key === 'string' && body.key !== '' ? body.key : null;
	} catch {
		return null;
	}
}

/** Asks, subscribes and registers — in that order, because a permission prompt
    is the one thing here that must follow a tap the Member made. */
export async function enablePush(): Promise<PushOutcome> {
	if (!supported()) return 'unsupported';
	try {
		const permission =
			Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
		if (permission !== 'granted') return 'denied';

		const registration = await navigator.serviceWorker.ready;
		let subscription = await registration.pushManager.getSubscription();
		if (!subscription) {
			const key = await serverKey();
			if (!key) return 'failed';
			subscription = await registration.pushManager.subscribe({
				/* Every push this app sends shows a notification, which is the promise
				   the permission was granted on. */
				userVisibleOnly: true,
				applicationServerKey: decodeKey(key)
			});
		}

		const response = await fetch('/api/push', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(subscription.toJSON())
		});
		return response.ok ? 'on' : 'failed';
	} catch {
		return 'failed';
	}
}

/** Switching the chime off. The row goes first: a server that still held it
    would keep waking a phone that has stopped listening. */
export async function disablePush(): Promise<void> {
	if (!supported()) return;
	try {
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) return;
		await fetch('/api/push', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ endpoint: subscription.endpoint })
		});
		await subscription.unsubscribe();
	} catch {
		/* Offline: the local setting is already off, so this phone is silent
		   whatever the server still believes. The next enable re-states it. */
	}
}

/** Re-states an existing subscription at launch, without ever prompting.

    A browser may rotate a subscription, a Device may have been offline when the
    setting was switched on, and a reinstalled app comes back with none. This
    quietly puts the two sides back in step; a Device that has not been granted
    permission, or has no subscription, does nothing at all. */
export async function resumePush(): Promise<void> {
	if (!supported() || Notification.permission !== 'granted') return;
	try {
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		if (subscription) {
			await fetch('/api/push', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(subscription.toJSON())
			});
			return;
		}
		await enablePush();
	} catch {
		/* Offline at launch is the common case this app is built for. */
	}
}
