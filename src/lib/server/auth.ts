/* Sessions. ADR-0005, spec §6.1 and §6.2.

   There are no passwords, so there is nothing to verify: a session is a
   128-bit opaque token in an HttpOnly cookie, and the server holds only its
   HMAC. Two consequences worth stating, because both are deliberate:

     - Offline the token is simply never checked. Only the server validates it,
       which is exactly what lets a Device work for days with no server contact.
     - No fixed expiry. Revocation is the control, not a timer: a 90-day timer
       signs Oma out precisely when she has not opened the app in a while — the
       moment re-authentication is hardest and you are least likely to be in the
       room to help.

   The key the HMAC uses lives in the volume, not in an env var (spec §4.4). A
   lost `.env` would otherwise sign out every Device at once, and recovery is one
   Rescue Link per person. */

import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemberRecord, Role } from '$domain/types';
import type { Db } from './db';
import { getMember } from './store';

export const SESSION_COOKIE = 'blb_session';
/** 128 bits, so rate limiting is a backstop rather than the defence. */
const TOKEN_BYTES = 16;

export function newToken(): string {
	return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Reads the signing key, generating it on first boot. */
export function loadSecret(path: string, override: string | null = null): Buffer {
	/* ADR-0009 says the signing key lives in the volume, not the environment,
	   because "a redeploy without it signs out every Device at once". Spec §4.4
	   still allows `SESSION_SECRET` for deliberate rotation, and the two
	   reconcile because the *default* is the volume: absence of the variable is
	   never the failure, only opting in and later dropping it — which is why the
	   README says plainly that setting it signs everyone out. */
	if (override) return Buffer.from(override, 'utf8');
	try {
		const existing = readFileSync(path);
		if (existing.length >= 32) return existing;
	} catch {
		/* first boot */
	}
	const secret = randomBytes(32);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, secret, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		/* a volume that cannot chmod is still a volume */
	}
	return secret;
}

/** The stored form of a token. An HMAC rather than a bare hash, so a stolen
    database file yields nothing without the key beside it. */
export function tokenHash(token: string, secret: Buffer): string {
	return createHmac('sha256', secret).update(token).digest('base64url');
}

export interface Session {
	member_id: string;
	/** Outlives the session and is stored beside the local replica, not with the
	    credential. It is the merge key's tie-breaker and never a proof of
	    identity — nothing may treat possession of one as authorisation. */
	device_id: string;
	created_at: number;
}

export type Member = MemberRecord;

export type AuthResult =
	| { ok: true; session: Session; member: Member }
	/** Deliberately distinct from `removed`: conflating the two would turn every
	    flaky session into data loss, because a 401 must never wipe local data. */
	| { ok: false; code: 'unauthenticated' }
	| { ok: false; code: 'removed' };

const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

export function createSession(
	db: Db,
	secret: Buffer,
	input: { memberId: string; deviceId: string; now: number }
): string {
	const token = newToken();
	db.prepare(
		`INSERT INTO sessions (token_hash, member_id, device_id, created_at, last_seen_at)
		 VALUES (?, ?, ?, ?, ?)`
	).run(tokenHash(token, secret), input.memberId, input.deviceId, input.now, input.now);
	return token;
}

export function resolveSession(db: Db, secret: Buffer, token: string | undefined, now: number): AuthResult {
	if (!token) return { ok: false, code: 'unauthenticated' };

	const row = db
		.prepare(
			`SELECT member_id, device_id, created_at, last_seen_at, revoked_at
			 FROM sessions WHERE token_hash = ?`
		)
		.get(tokenHash(token, secret)) as
		| { member_id: string; device_id: string; created_at: number; last_seen_at: number; revoked_at: number | null }
		| undefined;

	if (!row || row.revoked_at != null) return { ok: false, code: 'unauthenticated' };

	const member = getMember(db, row.member_id);
	if (!member) return { ok: false, code: 'unauthenticated' };
	/* Their tokens die immediately on removal, but a Device that has been
	   offline arrives with one that was live when it left. */
	if (member.removed_at != null) return { ok: false, code: 'removed' };

	if (now - row.last_seen_at > LAST_SEEN_THROTTLE_MS) {
		db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(
			now,
			tokenHash(token, secret)
		);
	}

	return {
		ok: true,
		session: { member_id: row.member_id, device_id: row.device_id, created_at: row.created_at },
		member
	};
}

/** Explicit sign-out. The caller warns first when the outbox is non-empty —
    that warning is the client's job, because only the client knows. */
export function revokeSession(db: Db, secret: Buffer, token: string, now: number): void {
	db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(
		now,
		tokenHash(token, secret)
	);
}

/** Removal kills every Device that Member had, immediately. */
export function revokeMember(db: Db, memberId: string, now: number): number {
	const info = db
		.prepare('UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL')
		.run(now, memberId);
	return info.changes;
}

export interface DeviceRow {
	device_id: string;
	created_at: number;
	last_seen_at: number;
	revoked_at: number | null;
}

export function listDevices(db: Db, memberId: string): DeviceRow[] {
	return db
		.prepare(
			`SELECT device_id, created_at, last_seen_at, revoked_at FROM sessions
			 WHERE member_id = ? ORDER BY last_seen_at DESC`
		)
		.all(memberId) as DeviceRow[];
}

export function cookieOptions(secure: boolean) {
	return {
		path: '/',
		httpOnly: true,
		/* Secure iff ORIGIN is https, so http://localhost:3000 still works with no
		   dev-only flag (spec §4.4). */
		secure,
		sameSite: 'lax' as const,
		/* One year, refreshed on every response that touches it. The *session*
		   has no expiry; this is only how long a browser is asked to keep the
		   cookie, and a Device that has not opened the app in a year re-claims. */
		maxAge: 60 * 60 * 24 * 365
	};
}

export function isOwner(member: Member): boolean {
	return member.role === 'owner';
}

export type { Role };
