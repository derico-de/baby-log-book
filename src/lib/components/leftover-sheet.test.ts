/* The sheet a running bottle's Stop opens (ADR-0018): it asks what came back,
   previews the Intake the Stop is about to write, and hands the number to the
   caller. It stores nothing and ends nothing itself. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.amounts button')];

function tapChip(label: string): void {
	const button = chips().find((b) => b.textContent?.trim() === label);
	if (!button) throw new Error(`no chip labelled ${label}`);
	button.click();
	flushSync();
}

function typeAmount(value: string): void {
	const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes('Amount'));
	const input = label?.querySelector('input');
	if (!input) throw new Error('no amount field');
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

	it('offers nothing left first, then the amounts a bottle that size could hold', () => {
		open(50);
		expect(chips().map((b) => b.textContent?.trim())).toEqual([
			'Nothing left',
			'10 ml',
			'20 ml',
			'30 ml',
			'40 ml'
		]);
	});

	it('previews the Intake the Stop is about to write, and starts at the full bottle', () => {
		open(170);
		expect(intakeLine()).toBe('Intake 170 ml');
		tapChip('40 ml');
		expect(intakeLine()).toBe('Intake 130 ml');
	});

	it('takes an amount the chips do not cover from the field', () => {
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
	it('hands back zero for a bottle she finished', () => {
		open(170);
		tapChip('Nothing left');
		end()?.click();
		expect(saved).toEqual([0]);
	});

	it('hands back nothing said when the question is left alone', () => {
		open(170);
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
