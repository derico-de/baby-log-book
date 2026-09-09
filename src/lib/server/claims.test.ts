import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import {
	claim,
	INVITE_TTL_MS,
	listPendingLinks,
	MAX_TOKEN_ATTEMPTS,
	mintBootstrap,
	mintInvite,
	mintRescue,
	previewLink,
	RESCUE_TTL_MS,
	revokePendingLink
} from './claims';
import { createSession, listDevices, resolveSession, revokeMember, revokeSession, tokenHash } from './auth';
import { getHousehold, listMembers, revisionsOf } from './store';
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

	it('expires in seven days as an Invite and an hour as a Rescue', () => {
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
		expect(listPendingLinks(db, 'h1', NOW)).toHaveLength(1);
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
		const [pending] = listPendingLinks(db, 'h1', NOW);
		expect(revokePendingLink(db, 'h1', pending.token_hash, NOW)).toBe(true);
		expect(listPendingLinks(db, 'h1', NOW)).toHaveLength(0);
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'burnt'
		});
	});
});

describe("a Member's mark", () => {
	const mintFor = (kindFor: 'person' | 'hub', role: 'parent' | 'caregiver' = 'caregiver') =>
		mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: kindFor === 'hub' ? 'Home Assistant' : 'Oma',
			role,
			kindFor,
			createdBy: 'mum',
			origin: ORIGIN,
			now: NOW
		});

	const claimed = (token: string) => {
		const result = claim(db, SECRET, { token, deviceId: 'd1', zone: BERLIN, now: NOW });
		if (!result.ok) throw new Error(`claim failed: ${result.reason}`);
		return result;
	};

	it('is a person s by default, and every Member who predates the mark is one', () => {
		claimed(mintFor('person').token);
		expect(listMembers(db, 'h1').find((m) => m.display_name === 'Oma')?.kind).toBe('person');
		expect(listMembers(db, 'h1').find((m) => m.display_name === 'Mama')?.kind).toBe('person');
	});

	it('is stamped onto the Member from what the Parent stated on the Invite', () => {
		claimed(mintFor('hub').token);
		const hub = listMembers(db, 'h1').find((m) => m.display_name === 'Home Assistant');
		expect(hub).toMatchObject({ kind: 'hub', role: 'caregiver' });
	});

	it('locks the role to Caregiver at mint time, so no link can carry a Hub Parent', () => {
		const result = claimed(mintFor('hub', 'parent').token);
		expect(listMembers(db, 'h1').find((m) => m.id === result.memberId)?.role).toBe('caregiver');
	});

	it('travels with the member data exactly as role does', () => {
		const result = claimed(mintFor('hub').token);
		const [revision] = revisionsOf(db, 'h1', 'member', result.memberId);
		expect(revision.fields).toMatchObject({ role: 'caregiver', kind: 'hub' });
	});

	it('is on the pending Invite before anybody claims it', () => {
		mintFor('hub');
		expect(listPendingLinks(db, 'h1', NOW)[0]).toMatchObject({
			display_name: 'Home Assistant',
			role: 'caregiver',
			kind_for: 'hub'
		});
	});

	it('a Rescue Link changes nothing about it — it re-binds, it does not create', () => {
		const result = claimed(mintFor('hub').token);
		const rescue = mintRescue(db, SECRET, {
			householdId: 'h1',
			memberId: result.memberId,
			origin: ORIGIN,
			now: NOW
		});
		claim(db, SECRET, { token: rescue.token, deviceId: 'd2', zone: BERLIN, now: NOW });
		expect(listMembers(db, 'h1').find((m) => m.id === result.memberId)?.kind).toBe('hub');
	});

	it('a Founding Link founds a person — nothing founds a Household from a wall', () => {
		const founding = mintBootstrap(db, SECRET, { origin: ORIGIN, now: NOW });
		const result = claim(db, SECRET, {
			token: founding.token,
			deviceId: 'd9',
			zone: BERLIN,
			displayName: 'Papa',
			now: NOW
		});
		if (!result.ok) throw new Error('claim failed');
		expect(listMembers(db, result.householdId)[0]).toMatchObject({ kind: 'person', role: 'parent' });
	});
});

describe('a Rescue Link', () => {
	const rescue = (memberId = 'mum', createdBy: string | null = 'mum') =>
		mintRescue(db, SECRET, { householdId: 'h1', memberId, createdBy, origin: ORIGIN, now: NOW });

	/** Somebody for a Parent to mint on behalf of. */
	const oma = () => {
		db.prepare('INSERT INTO members (id, household_id, display_name, role) VALUES (?,?,?,?)').run(
			'oma',
			'h1',
			'Oma',
			'caregiver'
		);
	};

	it('re-binds an existing Member rather than creating a second Mama', () => {
		// A new row would split three years of attribution, since every Revision
		// points at the old one (spec §6.1).
		const link = rescue();
		const result = claim(db, SECRET, { token: link.token, deviceId: 'new-phone', zone: BERLIN, now: NOW });
		expect(result).toMatchObject({ ok: true, memberId: 'mum' });
		expect(listMembers(db, 'h1')).toHaveLength(1);
	});

	it('lasts an hour, the same everywhere — Settings and the terminal alike', () => {
		expect(RESCUE_TTL_MS).toBe(60 * 60_000);
		expect(rescue().expires_at).toBe(NOW + 60 * 60_000);
		/* And an Invite's seven days is unchanged. */
		expect(
			mintInvite(db, SECRET, {
				householdId: 'h1',
				displayName: 'Oma',
				role: 'caregiver',
				createdBy: 'mum',
				origin: ORIGIN,
				now: NOW
			}).expires_at
		).toBe(NOW + INVITE_TTL_MS);
	});

	it('never touches the Devices that Member is already signed in on', () => {
		/* One link, one meaning — bind this Member to another Device — and silent
		   about the old ones: a rescue is *add* as much as *recover*, and an
		   auto-revoke would sign the phone out for adding the tablet. */
		const phone = createSession(db, SECRET, { memberId: 'mum', deviceId: 'phone', now: NOW });
		claim(db, SECRET, { token: rescue().token, deviceId: 'tablet', zone: BERLIN, now: NOW });
		expect(resolveSession(db, SECRET, phone, NOW)).toMatchObject({ ok: true });
		expect(listDevices(db, 'mum').map((d) => d.device_id).sort()).toEqual(['phone', 'tablet']);
	});

	it('joins the pending list, named for the Member it re-binds, with its minter', () => {
		oma();
		rescue('oma', 'mum');
		expect(listPendingLinks(db, 'h1', NOW)).toMatchObject([
			{
				kind: 'rescue',
				display_name: 'Oma',
				role: 'caregiver',
				member_id: 'oma',
				created_by: 'mum',
				kind_for: null
			}
		]);
	});

	it('takes its name from the Member now, not from the mint — a rename keeps up', () => {
		oma();
		rescue('oma');
		db.prepare('UPDATE members SET display_name = ? WHERE id = ?').run('Großmama', 'oma');
		expect(listPendingLinks(db, 'h1', NOW)[0].display_name).toBe('Großmama');
	});

	it('is revocable by any Parent, from the same list as an Invite', () => {
		oma();
		const link = rescue('oma');
		const [pending] = listPendingLinks(db, 'h1', NOW);
		expect(revokePendingLink(db, 'h1', pending.token_hash, NOW)).toBe(true);
		expect(listPendingLinks(db, 'h1', NOW)).toHaveLength(0);
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'burnt'
		});
	});

	it('the operator s terminal mints one with no minter, having no session to name', () => {
		mintRescue(db, SECRET, { householdId: 'h1', memberId: 'mum', origin: ORIGIN, now: NOW });
		expect(listPendingLinks(db, 'h1', NOW)[0].created_by).toBeNull();
	});

	it('is burnt by Removal — a door removal did not close is not closed', () => {
		oma();
		const link = rescue('oma');
		revokeMember(db, 'h1', 'oma', NOW);
		expect(listPendingLinks(db, 'h1', NOW)).toHaveLength(0);
		expect(claim(db, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'burnt'
		});
	});

	it('Removal burns only that Member s rescues', () => {
		oma();
		rescue('mum');
		rescue('oma');
		revokeMember(db, 'h1', 'oma', NOW);
		expect(listPendingLinks(db, 'h1', NOW)).toMatchObject([{ member_id: 'mum' }]);
	});

	it('Removal leaves the pending Invites alone — they are nobody s yet', () => {
		mintInvite(db, SECRET, {
			householdId: 'h1',
			displayName: 'Opa',
			role: 'caregiver',
			createdBy: 'mum',
			origin: ORIGIN,
			now: NOW
		});
		oma();
		revokeMember(db, 'h1', 'oma', NOW);
		expect(listPendingLinks(db, 'h1', NOW)).toMatchObject([{ kind: 'invite', display_name: 'Opa' }]);
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
		if (!result.ok) return;
		expect(getHousehold(fresh, result.householdId)).toMatchObject({
			name: '',
			zone: BERLIN,
			day_start: '05:00'
		});
		expect(listMembers(fresh, result.householdId)).toMatchObject([{ display_name: 'Mama', role: 'parent' }]);
	});

	it('takes the Household Zone from the claiming Device', () => {
		const fresh = empty();
		const link = mintBootstrap(fresh, SECRET, { origin: ORIGIN, now: NOW });
		const result = claim(fresh, SECRET, {
			token: link.token,
			deviceId: 'd1',
			zone: 'Europe/Bucharest',
			displayName: 'Bunica',
			now: NOW
		});
		if (!result.ok) throw new Error('claim failed');
		expect(getHousehold(fresh, result.householdId)?.zone).toBe('Europe/Bucharest');
	});

	it('applies the label the operator typed as the new Household s name', () => {
		const link = mintBootstrap(db, SECRET, { origin: ORIGIN, now: NOW, label: 'Anna & Tom' });
		const result = claim(db, SECRET, {
			token: link.token,
			deviceId: 'd1',
			zone: BERLIN,
			displayName: 'Anna',
			now: NOW
		});
		if (!result.ok) throw new Error('claim failed');
		expect(getHousehold(db, result.householdId)?.name).toBe('Anna & Tom');
	});

	it('needs a name, because a Parent with no name has no timeline attribution', () => {
		const fresh = empty();
		const link = mintBootstrap(fresh, SECRET, { origin: ORIGIN, now: NOW });
		expect(claim(fresh, SECRET, { token: link.token, deviceId: 'd1', zone: BERLIN, now: NOW })).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it('founds a further Household rather than joining the one that exists', () => {
		/* The old fallback — "a bootstrap claim joins the existing Household" — is
		   gone: on a hosted deployment there is no "the" Household (ADR-0020). */
		const link = mintBootstrap(db, SECRET, { origin: ORIGIN, now: NOW, label: 'Anna & Tom' });
		const result = claim(db, SECRET, {
			token: link.token,
			deviceId: 'd1',
			zone: BERLIN,
			displayName: 'Anna',
			now: NOW
		});
		if (!result.ok) throw new Error('claim failed');
		expect(result.householdId).not.toBe('h1');
		expect(listMembers(db, 'h1').map((m) => m.display_name)).toEqual(['Mama']);
		expect(listMembers(db, result.householdId).map((m) => m.display_name)).toEqual(['Anna']);
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
		expect(revokeMember(db, 'h1', 'mum', NOW)).toBe(2);
	});

	it('still says "removed" after the removal has revoked the session', () => {
		/* Removal does both — it marks the Member and it kills their tokens — so
		   the two must be asked in that order. A revoked-first answer sends a Hub
		   into a re-auth dialog asking for a Rescue Link that removal has already
		   burnt, which is the dead end ADR-0038 exists to avoid. */
		const token = createSession(db, SECRET, { memberId: 'mum', deviceId: 'd1', now: NOW });
		db.prepare('UPDATE members SET removed_at = ? WHERE id = ?').run(NOW, 'mum');
		revokeMember(db, 'h1', 'mum', NOW);
		expect(resolveSession(db, SECRET, token, NOW)).toEqual({ ok: false, code: 'removed' });
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
