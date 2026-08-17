/* Liveness. Spec §5.4.

   A running timer needs no traffic at all — it ticks client-side from its start
   instant — so only start and stop events have to propagate. This channel
   therefore carries a **bare wake-up signal and never data**, which keeps
   exactly one path by which rows arrive: the pull.

   In-process, because there is one process. */

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Called after a push commits. Never carries the revisions. */
export function wake(): void {
	for (const listener of [...listeners]) {
		try {
			listener();
		} catch {
			/* A dead connection is not the pusher's problem. */
		}
	}
}

export function listenerCount(): number {
	return listeners.size;
}
