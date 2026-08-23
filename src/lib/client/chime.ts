/* The Bottle Chime (ADR-0029).

   Two soft notes, synthesised rather than fetched: the shell is precached
   whole (ADR-0012), and an audio file would be a payload every Device carries
   for a Device Setting most of them never switch on.

   Deliberately quiet, with a slow attack. It sounds at 3am beside a sleeping
   household, and its job is to reach the person holding the bottle — not to
   wake the room. */

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	const Ctor: AudioCtor | undefined =
		window.AudioContext ?? (window as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
	if (!Ctor) return null;
	if (!ctx) {
		try {
			ctx = new Ctor();
		} catch {
			return null;
		}
	}
	return ctx;
}

/** A browser only lets a page make noise once someone has touched it, and the
    context that was built before that touch stays suspended. Called from the
    first interaction on the shell and again when the setting is switched on,
    so the phone that has merely been *left open* on the timeline can still
    chime an hour later. */
export function primeChime(): void {
	const c = context();
	if (c && c.state === 'suspended') void c.resume().catch(() => {});
}

function note(c: AudioContext, hz: number, at: number, seconds: number): void {
	const osc = c.createOscillator();
	const gain = c.createGain();
	osc.type = 'sine';
	osc.frequency.value = hz;
	/* Ramps rather than steps: a square-edged envelope clicks, and a click is
	   the part a tired ear hears as an alarm. */
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(0.12, at + 0.04);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
	osc.connect(gain).connect(c.destination);
	osc.start(at);
	osc.stop(at + seconds + 0.05);
}

/** Two rising notes. Never throws: a Device that cannot make a sound — no Web
    Audio, a context the browser refuses to resume, a phone on silent — simply
    does not, and nothing else about the app changes. */
export function playChime(): void {
	const c = context();
	if (!c) return;
	try {
		if (c.state === 'suspended') void c.resume().catch(() => {});
		const at = c.currentTime + 0.02;
		note(c, 784, at, 0.22);
		note(c, 1046.5, at + 0.26, 0.34);
	} catch {
		/* Nothing here is worth failing a tick over. */
	}
}
