/* The sheet a running bottle's Stop opens (ADR-0018): it asks what came back,
   previews the Intake the Stop is about to write, and hands the number to the
   caller. It stores nothing and ends nothing itself. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LeftoverSheet from './LeftoverSheet.svelte';

let host: HTMLElement;
let mounted: Record<string, unknown> | null = null;
let saved: Array<number | null>;
let closed: number;

function open(intake: number): void {
	mounted = mount(LeftoverSheet, {
		target: host,
		props: {
			intake,
			onsave: (ml: number | null) => saved.push(ml),
			onclose: () => (closed += 1)
		}
	}) as Record<string, unknown>;
	flushSync();
}

function amountField(): HTMLInputElement {
	const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes('Amount'));
	const input = label?.querySelector('input');
	if (!input) throw new Error('no amount field');
	return input;
}

function typeAmount(value: string): void {
	const input = amountField();
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

const intakeLine = () => host.querySelector('.intake')?.textContent?.trim();
const end = () => host.querySelector<HTMLButtonElement>('[data-primary="1"]');

beforeEach(() => {
	host = document.createElement('div');
	document.body.append(host);
	saved = [];
	closed = 0;
});

afterEach(() => {
	if (mounted) unmount(mounted as never, { outro: false });
	mounted = null;
	host.remove();
});

describe('what the sheet asks', () => {
	it('leads with what went into the bottle', () => {
		open(170);
		expect(host.textContent).toContain('Poured 170 ml');
	});

	it('asks with one field that starts at nothing left', () => {
		open(170);
		expect(host.querySelectorAll('.amounts')).toHaveLength(0);
		expect(amountField().value).toBe('0');
		expect(intakeLine()).toBe('Intake 170 ml');
	});

	it('marks the 0 on focus so the first digit typed replaces it', () => {
		open(170);
		const select = vi.spyOn(HTMLInputElement.prototype, 'select');
		try {
			amountField().dispatchEvent(new FocusEvent('focus'));
			expect(select).toHaveBeenCalledOnce();
			const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
			amountField().dispatchEvent(mouseUp);
			expect(mouseUp.defaultPrevented).toBe(true);
			const later = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
			amountField().dispatchEvent(later);
			expect(later.defaultPrevented).toBe(false);
		} finally {
			select.mockRestore();
		}
	});

	it('previews the Intake the Stop is about to write', () => {
		open(170);
		typeAmount('35');
		expect(intakeLine()).toBe('Intake 135 ml');
		end()?.click();
		expect(saved).toEqual([35]);
	});

	it('clamps the preview at zero rather than validating', () => {
		open(100);
		typeAmount('150');
		expect(intakeLine()).toBe('Intake 0 ml');
	});
});

describe('what the sheet hands back', () => {
	it('hands back zero for a bottle she finished, with the field left alone', () => {
		open(170);
		end()?.click();
		expect(saved).toEqual([0]);
	});

	it('hands back nothing said when the field is cleared', () => {
		open(170);
		typeAmount('');
		expect(intakeLine()).toBe('Intake 170 ml');
		end()?.click();
		expect(saved).toEqual([null]);
	});

	it('ends nothing on cancel — a mis-tapped Stop leaves the bottle running', () => {
		open(170);
		const cancel = [...host.querySelectorAll<HTMLButtonElement>('.sheet-acts button')][0];
		cancel.click();
		flushSync();
		expect(saved).toEqual([]);
		expect(closed).toBe(1);
	});
});
