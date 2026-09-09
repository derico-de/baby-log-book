/* The Lapsed gate. ADR-0022, spec §5.7.

   Nothing sets it yet, so every test here injects it — which is exactly the
   shape the hosted-service effort will install for real. What is being pinned
   is *where* the gate sits and in what order, because a derived read added
   without ADR-0022 in mind quietly becomes the read-only tier it refused. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import { claim, mintBootstrap, mintInvite, mintRescue, previewLink } from './claims';
import { readHubState } from './hub';
import { isLapsed, setLapsedCheck } from './lapsed';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T12:00:00Z');
const SECRET = Buffer.alloc(32, 7);

let db: Db;

function setup(): Db {
	const fresh = openDb(':memory:');
	runMigrations(fresh);
	const household = fresh.prepare(
		'INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)'
	);
	household.run('h1', 'Zuhause', '05:00', BERLIN, NOW);
	household.run('h2', 'Nebenan', '05:00', BERLIN, NOW);
	fresh
		.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)')
		.run('mum', 'h1', 'Mama', 'parent');
	fresh
		.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)')
		.run('nachbarin', 'h2', 'Nachbarin', 'parent');
	fresh
		.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)')
		.run('b1', 'h1', 'Emma', '2026-02-17');
	return fresh;
}

/** Lapses exactly the Households named, and nothing else. */
const lapse = (...ids: string[]) => setLapsedCheck((_db, id) => ids.includes(id));

beforeEach(() => {
	db = setup();
});

afterEach(() => {
	setLapsedCheck(null);
});

describe('the seam', () => {
	it('says no until somebody fills it in', () => {
		expect(isLapsed(db, 'h1')).toBe(false);
	});

	it('answers per Household, never for the deployment', () => {
		lapse('h1');
		expect(isLapsed(db, 'h1')).toBe(true);
		expect(isLapsed(db, 'h2')).toBe(false);
	});

	it('puts itself back', () => {
		lapse('h1');
		setLapsedCheck(null);
		expect(isLapsed(db, 'h1')).toBe(false);
	});
});

describe('the derived read', () => {
	it('answers 402 lapsed, in the error body every other endpoint uses', () => {
		lapse('h1');
		expect(readHubState(db, 'h1', { now: NOW })).toEqual({ status: 402, code: 'lapsed' });
	});

	it('is checked before the ETag — a Lapsed Household cannot learn nothing changed', () => {
		const first = readHubState(db, 'h1', { now: NOW });
		if (first.status !== 200) throw new Error('expected a payload');
		lapse('h1');
		/* The very ETag the server just handed out, and still not a 304. */
		expect(readHubState(db, 'h1', { now: NOW, ifNoneMatch: first.etag })).toEqual({
			status: 402,
			code: 'lapsed'
		});
	});

	it('leaves the Household next door reading normally', () => {
		lapse('h2');
		expect(readHubState(db, 'h1', { now: NOW }).status).toBe(200);
	});

	it('reads normally again the moment it is resumed — reactivation is anticlimactic', () => {
		lapse('h1');
		setLapsedCheck(null);
		const result = readHubState(db, 'h1', { now: NOW });
		expect(result.status).toBe(200);
	});
});

describe('the claim paths', () => {
	const invite = () =>
		mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: 'Oma',
			role: 'caregiver',
			createdBy: 'mum',
			origin: 'https://example.test',
			now: NOW
		});

	const claimIt = (token: string) =>
		claim(db, SECRET, { token, deviceId: 'phone-b', zone: BERLIN, displayName: 'Oma', now: NOW });

	it('refuses the preview, so looking says hosting is paused rather than nothing', () => {
		const link = invite();
		lapse('h1');
		expect(previewLink(db, SECRET, link.token, NOW)).toEqual({ ok: false, reason: 'lapsed' });
	});

	it('refuses the claim', () => {
		const link = invite();
		lapse('h1');
		expect(claimIt(link.token)).toEqual({ ok: false, reason: 'lapsed' });
	});

	it('refuses it before the link is spent — the same link works once resumed', () => {
		const link = invite();
		lapse('h1');
		claimIt(link.token);
		claimIt(link.token);
		setLapsedCheck(null);
		const result = claimIt(link.token);
		expect(result.ok).toBe(true);
	});

	it('spends no attempt while it refuses', () => {
		const link = invite();
		lapse('h1');
		for (let i = 0; i < 6; i += 1) claimIt(link.token);
		setLapsedCheck(null);
		/* Six refusals would have burnt the token if any of them had counted. */
		expect(claimIt(link.token).ok).toBe(true);
	});

	it('gates every claim, not just a Hub s — a phone falls into the same trap', () => {
		const rescue = mintRescue(db, SECRET, {
			householdId: 'h1',
			memberId: 'mum',
			origin: 'https://example.test',
			now: NOW
		});
		lapse('h1');
		expect(claimIt(rescue.token)).toEqual({ ok: false, reason: 'lapsed' });
	});

	it('leaves a Founding Link alone — it has no Household to Lapse yet', () => {
		const founding = mintBootstrap(db, SECRET, { origin: 'https://example.test', now: NOW });
		lapse('h1', 'h2');
		expect(previewLink(db, SECRET, founding.token, NOW)).toMatchObject({ ok: true });
		expect(claimIt(founding.token).ok).toBe(true);
	});

	it('says expired before it says lapsed — an expired link is still expired', () => {
		const link = invite();
		lapse('h1');
		expect(previewLink(db, SECRET, link.token, NOW + 8 * 24 * 3600_000)).toEqual({
			ok: false,
			reason: 'expired'
		});
	});
});
