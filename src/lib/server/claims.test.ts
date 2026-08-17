import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import {
	claim,
	INVITE_TTL_MS,
	listPendingInvites,
	MAX_TOKEN_ATTEMPTS,
	mintBootstrap,
	mintInvite,
	mintRescue,
	previewLink,
	RESCUE_TTL_MS,
	revokeInvite
} from './claims';
import { createSession, listDevices, resolveSession, revokeMember, revokeSession, tokenHash } from './auth';
import { listMembers, revisionsOf, theHousehold } from './store';
import { RateLimiter } from './rate-limit';

const BERLIN = 'Europe/Berlin';
const NOW = Date.parse('2026-08-17T20:00:00Z');
const ORIGIN = 'https://log.example.com';
const SECRET = Buffer.alloc(32, 7);

let db: Db;

function empty(): Db {
	const fresh = openDb(':memory:');
	runMigrations(fresh);
	return fresh;
}

function withHousehold(): Db {
	const fresh = empty();
	fresh
		.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)')
		.run('h1', 'Zuhause', '05:00', BERLIN, NOW);
	fresh
		.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)')
		.run('mum', 'h1', 'Mama', 'parent');
	return fresh;
}

beforeEach(() => {
	db = withHousehold();
});

describe('a Claim Link', () => {
	it('is an absolute URL built from ORIGIN, because it is sent over WhatsApp', () => {
		const link = mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: 'Oma',
			role: 'caregiver',
			createdBy: 'mum',
			origin: ORIGIN,
			now: NOW
		});
		expect(link.url.startsWith(`${ORIGIN}/claim?t=`)).toBe(true);
		expect(link.token).toHaveLength(22); /* 128 bits, base64url */
	});

	it('survives being fetched by a preview bot — looking is not claiming', () => {
		// WhatsApp, Signal and Telegram all fetch the URL server-side to build
		// the card. A link that claimed on GET would be burnt before the
		// recipient ever saw it (spec §6.1).
		const link = mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: 'Oma',
			role: 'caregiver',
			createdBy: 'mum',
			origin: ORIGIN,
			now: NOW
		});
		expect(previewLink(db, SECRET, link.token, NOW)).toMatchObject({ ok: true, display_name: 'Oma' });
		expect(previewLink(db, SECRET, link.token, NOW)).toMatchObject({ ok: true });
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW }).ok).toBe(true);
	});

	it('expires in seven days as an Invite and fifteen minutes as a Rescue', () => {
		const invite = mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: 'Oma',
			role: 'caregiver',
			createdBy: 'mum',
			origin: ORIGIN,
			now: NOW
		});
		expect(invite.expires_at).toBe(NOW + INVITE_TTL_MS);
		const rescue = mintRescue(db, SECRET, { householdId: 'h1', memberId: 'mum', origin: ORIGIN, now: NOW });
		expect(rescue.expires_at).toBe(NOW + RESCUE_TTL_MS);
	});

	it('is single-use', () => {
		const link = mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: 'Oma',
			role: 'caregiver',
			createdBy: 'mum',
			origin: ORIGIN,
			now: NOW
		});
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW }).ok).toBe(true);
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd2', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'used'
		});
	});

	it('burns after five attempts, which is the limit an attacker cannot rotate around', () => {
		const link = mintRescue(db, SECRET, { householdId: 'h1', memberId: 'mum', origin: ORIGIN, now: NOW });
		for (let i = 0; i < MAX_TOKEN_ATTEMPTS; i++) {
			/* An empty device id fails after the attempt has been counted. */
			expect(claim(db, SECRET, { token: link.token, deviceId: '', zone: BERLIN, now: NOW }).ok).toBe(false);
		}
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'burnt'
		});
	});

	it('is refused once expired', () => {
		const link = mintRescue(db, SECRET, { householdId: 'h1', memberId: 'mum', origin: ORIGIN, now: NOW });
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW + RESCUE_TTL_MS + 1 })).toEqual({
			ok: false,
			reason: 'expired'
		});
	});

	it('reveals nothing about a token nobody minted', () => {
		expect(previewLink(db, SECRET, 'not-a-token', NOW)).toEqual({ ok: false, reason: 'unknown' });
	});
});

describe('an Invite', () => {
	const mint = () =>
		mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: 'Oma',
			role: 'caregiver',
			createdBy: 'mum',
			origin: ORIGIN,
			now: NOW
		});

	it('creates the Member on claim, carrying the name and role the Parent chose', () => {
		// So the timeline reads "Oma" from her first Entry rather than "Unnamed".
		const result = claim(db, SECRET, { token: mint().token, deviceId: 'd1', zone: BERLIN, now: NOW });
		expect(result.ok).toBe(true);
		const oma = listMembers(db, 'h1').find((m) => m.display_name === 'Oma');
		expect(oma).toMatchObject({ role: 'caregiver', removed_at: null });
	});

	it('is not a half-real person until then', () => {
		mint();
		expect(listMembers(db, 'h1').map((m) => m.display_name)).toEqual(['Mama']);
		expect(listPendingInvites(db, 'h1', NOW)).toHaveLength(1);
	});

	it('syncs the new Member as a revision attributed to the inviting Parent', () => {
		const result = claim(db, SECRET, { token: mint().token, deviceId: 'd1', zone: BERLIN, now: NOW });
		if (!result.ok) throw new Error('claim failed');
		const [revision] = revisionsOf(db, 'h1', 'member', result.memberId);
		expect(revision.author_id).toBe('mum');
		expect(revision.fields).toMatchObject({ display_name: 'Oma', role: 'caregiver' });
	});

	it('can be revoked while it is still pending', () => {
		const link = mint();
		const [pending] = listPendingInvites(db, 'h1', NOW);
		expect(revokeInvite(db, 'h1', pending.token_hash, NOW)).toBe(true);
		expect(listPendingInvites(db, 'h1', NOW)).toHaveLength(0);
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'burnt'
		});
	});
});

describe('a Rescue Link', () => {
	it('re-binds an existing Member rather than creating a second Mama', () => {
		// A new row would split three years of attribution, since every Revision
		// points at the old one (spec §6.1).
		const link = mintRescue(db, SECRET, { householdId: 'h1', memberId: 'mum', origin: ORIGIN, now: NOW });
		const result = claim(db, SECRET, { token: link.token, deviceId: 'new-phone', zone: BERLIN, now: NOW });
		expect(result).toMatchObject({ ok: true, memberId: 'mum' });
		expect(listMembers(db, 'h1')).toHaveLength(1);
	});
});

describe('bootstrap', () => {
	it('creates the Household and the first Parent, with nothing to bind to', () => {
		const fresh = empty();
		const link = mintBootstrap(fresh, SECRET, { origin: ORIGIN, now: NOW });
		const result = claim(fresh, SECRET, {
			token: link.token,
			deviceId: 'd1',
			zone: BERLIN,
			displayName: 'Mama',
			now: NOW
		});
		expect(result.ok).toBe(true);
		expect(theHousehold(fresh)).toMatchObject({ zone: BERLIN, day_start: '05:00' });
		expect(listMembers(fresh, (result as { householdId: string }).householdId)).toMatchObject([
			{ display_name: 'Mama', role: 'parent' }
		]);
	});

	it('takes the Household Zone from the claiming Device', () => {
		const fresh = empty();
		const link = mintBootstrap(fresh, SECRET, { origin: ORIGIN, now: NOW });
		claim(fresh, SECRET, {
			token: link.token,
			deviceId: 'd1',
			zone: 'Europe/Bucharest',
			displayName: 'Bunica',
			now: NOW
		});
		expect(theHousehold(fresh)?.zone).toBe('Europe/Bucharest');
	});

	it('needs a name, because a Parent with no name has no timeline attribution', () => {
		const fresh = empty();
		const link = mintBootstrap(fresh, SECRET, { origin: ORIGIN, now: NOW });
		expect(claim(fresh, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it('supersedes the previous boot line, so exactly one link is live', () => {
		const fresh = empty();
		const first = mintBootstrap(fresh, SECRET, { origin: ORIGIN, now: NOW });
		const second = mintBootstrap(fresh, SECRET, { origin: ORIGIN, now: NOW + 1000 });
		expect(previewLink(fresh, SECRET, first.token, NOW + 1000)).toEqual({ ok: false, reason: 'unknown' });
		expect(previewLink(fresh, SECRET, second.token, NOW + 1000).ok).toBe(true);
	});
});

describe('a session', () => {
	it('has no expiry, because revocation is the control and not a timer', () => {
		const token = createSession(db, SECRET, { memberId: 'mum', deviceId: 'd1', now: NOW });
		const inAYear = NOW + 400 * 24 * 3600_000;
		expect(resolveSession(db, SECRET, token, inAYear)).toMatchObject({ ok: true });
	});

	it('is stored as an HMAC, so a stolen database file hands over nothing', () => {
		const token = createSession(db, SECRET, { memberId: 'mum', deviceId: 'd1', now: NOW });
		const rows = db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
		expect(rows[0].token_hash).not.toBe(token);
		expect(rows[0].token_hash).toBe(tokenHash(token, SECRET));
		/* And a different key resolves nothing. */
		expect(resolveSession(db, Buffer.alloc(32, 9), token, NOW)).toEqual({ ok: false, code: 'unauthenticated' });
	});

	it('keeps the device_id, which is a tie-breaker and never a proof of identity', () => {
		const token = createSession(db, SECRET, { memberId: 'mum', deviceId: 'phone-a', now: NOW });
		const result = resolveSession(db, SECRET, token, NOW);
		expect(result).toMatchObject({ ok: true, session: { device_id: 'phone-a' } });
		expect(listDevices(db, 'mum').map((d) => d.device_id)).toEqual(['phone-a']);
	});

	it('answers "unauthenticated" once signed out', () => {
		const token = createSession(db, SECRET, { memberId: 'mum', deviceId: 'd1', now: NOW });
		revokeSession(db, SECRET, token, NOW);
		expect(resolveSession(db, SECRET, token, NOW)).toEqual({ ok: false, code: 'unauthenticated' });
	});

	it('answers "removed" — deliberately not a 401 — once the Member is removed', () => {
		// Conflating the two would turn every flaky session into data loss.
		const token = createSession(db, SECRET, { memberId: 'mum', deviceId: 'd1', now: NOW });
		db.prepare('UPDATE members SET removed_at = ? WHERE id = ?').run(NOW, 'mum');
		expect(resolveSession(db, SECRET, token, NOW)).toEqual({ ok: false, code: 'removed' });
	});

	it('dies immediately on every Device when the Member is removed', () => {
		createSession(db, SECRET, { memberId: 'mum', deviceId: 'd1', now: NOW });
		createSession(db, SECRET, { memberId: 'mum', deviceId: 'd2', now: NOW });
		expect(revokeMember(db, 'mum', NOW)).toBe(2);
	});

	it('rejects a token nobody was issued', () => {
		expect(resolveSession(db, SECRET, 'made-up', NOW)).toEqual({ ok: false, code: 'unauthenticated' });
		expect(resolveSession(db, SECRET, undefined, NOW)).toEqual({ ok: false, code: 'unauthenticated' });
	});
});

describe('the per-IP limiter', () => {
	it('allows ten attempts an hour and then stops', () => {
		const limiter = new RateLimiter(10, 3600_000);
		for (let i = 0; i < 10; i++) expect(limiter.take('1.2.3.4', NOW + i)).toBe(true);
		expect(limiter.take('1.2.3.4', NOW + 10)).toBe(false);
		expect(limiter.remaining('1.2.3.4', NOW + 10)).toBe(0);
	});

	it('forgets an hour later', () => {
		const limiter = new RateLimiter(2, 3600_000);
		limiter.take('1.2.3.4', NOW);
		limiter.take('1.2.3.4', NOW);
		expect(limiter.take('1.2.3.4', NOW)).toBe(false);
		expect(limiter.take('1.2.3.4', NOW + 3600_001)).toBe(true);
	});

	it('keeps one bucket per address', () => {
		const limiter = new RateLimiter(1, 3600_000);
		expect(limiter.take('a', NOW)).toBe(true);
		expect(limiter.take('b', NOW)).toBe(true);
		expect(limiter.take('a', NOW)).toBe(false);
	});
});
