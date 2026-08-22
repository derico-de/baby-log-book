/* Liveness. Spec §5.4.

   A running timer needs no traffic at all — it ticks client-side from its start
   instant — so only start and stop events have to propagate. This channel
   therefore carries a **bare wake-up signal and never data**, which keeps
   exactly one path by which rows arrive: the pull.

   In-process, because there is one process — and keyed by Household, because one
   process may now serve several: a push wakes only its own Household's Devices,
   which is what lets ADR-0020 say every runtime structure is household-keyed
   without a reasoned-about exception. */

type Listener = () => void;

const byHousehold = new Map<string, Set<Listener>>();

export function subscribe(householdId: string, listener: Listener): () => void {
	let listeners = byHousehold.get(householdId);
	if (!listeners) {
		listeners = new Set();
		byHousehold.set(householdId, listeners);
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		/* The last Device of a Household leaves nothing behind. */
		if (listeners.size === 0) byHousehold.delete(householdId);
	};
}

/** Called after a push commits. Never carries the revisions. */
export function wake(householdId: string): void {
	const listeners = byHousehold.get(householdId);
	if (!listeners) return;
	for (const listener of [...listeners]) {
		try {
			listener();
		} catch {
			/* A dead connection is not the pusher's problem. */
		}
	}
}

export function listenerCount(householdId: string): number {
	return byHousehold.get(householdId)?.size ?? 0;
}
