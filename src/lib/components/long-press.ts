/* A press held still on an element: the timeline row's shortcut to Duplicate
   (ADR-0045). A shortcut only — what it opens is always one tap away on a
   sheet too, because a hold nobody finds at 3am is why a long-press was
   rejected for the poop (spec §8.5).

   The context-menu gesture counts as a hold: a right click, the menu key, and
   Android's own long-press, which would otherwise start selecting the row's
   text. The click that ends a held press lands nowhere — by then the sheet
   the hold opened is under the finger. */
import type { Attachment } from 'svelte/attachments';

export const HOLD_MS = 500;
/** Further than this and the finger is scrolling, not holding. */
const SLOP_PX = 10;
/** Android fires its context menu around the same instant the timer does;
    one press is one hold. */
const ONE_HOLD_MS = 1000;

export function longPress(onhold: () => void): Attachment<HTMLElement> {
	return (el) => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let origin: { x: number; y: number } | null = null;
		let heldAt = -Infinity;

		const cancel = () => {
			if (timer != null) clearTimeout(timer);
			timer = null;
			origin = null;
		};
		const hold = () => {
			cancel();
			if (Date.now() - heldAt < ONE_HOLD_MS) return;
			heldAt = Date.now();
			swallowNextClick();
			onhold();
		};
		const down = (event: PointerEvent) => {
			cancel();
			if (event.button !== 0) return;
			origin = { x: event.clientX, y: event.clientY };
			timer = setTimeout(hold, HOLD_MS);
		};
		const move = (event: PointerEvent) => {
			if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > SLOP_PX) cancel();
		};
		const menu = (event: Event) => {
			event.preventDefault();
			hold();
		};

		el.addEventListener('pointerdown', down);
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', cancel);
		el.addEventListener('pointercancel', cancel);
		el.addEventListener('pointerleave', cancel);
		el.addEventListener('contextmenu', menu);
		return () => {
			cancel();
			el.removeEventListener('pointerdown', down);
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', cancel);
			el.removeEventListener('pointercancel', cancel);
			el.removeEventListener('pointerleave', cancel);
			el.removeEventListener('contextmenu', menu);
		};
	};
}

/* Caught on the way down from the window, so it never reaches whatever now
   sits where the press ended. A hold that ends in no click — Android's, a
   right click — must not eat the next real one, so the next press or key
   disarms it. */
function swallowNextClick(): void {
	const swallow = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		disarm();
	};
	const disarm = () => {
		window.removeEventListener('click', swallow, true);
		window.removeEventListener('pointerdown', disarm, true);
		window.removeEventListener('keydown', disarm, true);
	};
	window.addEventListener('click', swallow, true);
	window.addEventListener('pointerdown', disarm, true);
	window.addEventListener('keydown', disarm, true);
}
