/* Claim Links — the only privileged path in. ADR-0005, spec §6.1.

   Everything that grants access is a single-use link with 128 bits of entropy,
   and it is **claimed by a POST behind a button, never by the GET that fetches
   it**. That detail is not a refinement, it is the difference between working
   and not: WhatsApp, Signal and Telegram all fetch a URL server-side to build
   the preview card, so a link that claims on GET is burnt by the preview bot
   before the recipient ever sees it.

   Three flavours, differing only in what they bind to:

     - Invite    — creates a Member. 7-day expiry: you send it on Wednesday, she
                   taps it on Sunday. The Member row is created on claim, so a
                   pending Invite is never a half-real person in the Household.
     - Rescue    — re-binds a Device to a Member who already exists. 15 minutes,
                   because you are standing at the terminal.
     - Bootstrap — the same mechanism with nothing to bind to: on an empty
                   Household it creates the Household and the first Owner. */

import { randomUUID } from 'node:crypto';
import { DEFAULT_DAY_START, type Role } from '$domain/types';
import { seedTargets } from '$domain/targets';
import type { Db } from './db';
import { createSession, newToken, tokenHash } from './auth';
import { insertRevision, materialise, theHousehold } from './store';

export type ClaimKind = 'invite' | 'rescue' | 'bootstrap';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
export const RESCUE_TTL_MS = 15 * 60_000;
/** A boot line is read by an operator who may be halfway through reading a
    README. Long enough to be useful, and superseded on every restart. */
export const BOOTSTRAP_TTL_MS = 7 * 24 * 60 * 60_000;

/** Five per token, then the token is burnt permanently. This is the limit that
    matters, being the part an attacker cannot rotate around. */
export const MAX_TOKEN_ATTEMPTS = 5;

export interface MintedLink {
	token: string;
	url: string;
	expires_at: number;
}

function claimUrl(origin: string, token: string): string {
	/* One prerendered shell serves every route, so the token rides in the query
	   string rather than in a path segment. */
	return `${origin}/claim?t=${token}`;
}

export function mintInvite(
	db: Db,
	secret: Buffer,
	input: { householdId: string; displayName: string; role: Role; createdBy: string; origin: string; now: number }
): MintedLink {
	const token = newToken();
	const expires = input.now + INVITE_TTL_MS;
	db.prepare(
		`INSERT INTO claim_links
		   (token_hash, kind, household_id, display_name, role, created_by, created_at, expires_at)
		 VALUES (?, 'invite', ?, ?, ?, ?, ?, ?)`
	).run(
		tokenHash(token, secret),
		input.householdId,
		input.displayName,
		input.role,
		input.createdBy,
		input.now,
		expires
	);
	return { token, url: claimUrl(input.origin, token), expires_at: expires };
}

export function mintRescue(
	db: Db,
	secret: Buffer,
	input: { householdId: string; memberId: string; origin: string; now: number }
): MintedLink {
	const token = newToken();
	const expires = input.now + RESCUE_TTL_MS;
	db.prepare(
		`INSERT INTO claim_links (token_hash, kind, household_id, member_id, created_at, expires_at)
		 VALUES (?, 'rescue', ?, ?, ?, ?)`
	).run(tokenHash(token, secret), input.householdId, input.memberId, input.now, expires);
	return { token, url: claimUrl(input.origin, token), expires_at: expires };
}

/** Superseded on every boot, so exactly one bootstrap link is ever live. */
export function mintBootstrap(db: Db, secret: Buffer, input: { origin: string; now: number }): MintedLink {
	db.prepare("DELETE FROM claim_links WHERE kind = 'bootstrap' AND claimed_at IS NULL").run();
	const token = newToken();
	const expires = input.now + BOOTSTRAP_TTL_MS;
	db.prepare(
		`INSERT INTO claim_links (token_hash, kind, created_at, expires_at)
		 VALUES (?, 'bootstrap', ?, ?)`
	).run(tokenHash(token, secret), input.now, expires);
	return { token, url: claimUrl(input.origin, token), expires_at: expires };
}

export interface PendingInvite {
	display_name: string;
	role: Role;
	created_at: number;
	expires_at: number;
	token_hash: string;
}

/** Until it is claimed an Invite sits in a list the Owner can revoke. */
export function listPendingInvites(db: Db, householdId: string, now: number): PendingInvite[] {
	return db
		.prepare(
			`SELECT display_name, role, created_at, expires_at, token_hash FROM claim_links
			 WHERE kind = 'invite' AND household_id = ? AND claimed_at IS NULL AND burnt_at IS NULL
			   AND expires_at > ?
			 ORDER BY created_at DESC`
		)
		.all(householdId, now) as PendingInvite[];
}

export function revokeInvite(db: Db, householdId: string, tokenHashValue: string, now: number): boolean {
	const info = db
		.prepare(
			`UPDATE claim_links SET burnt_at = ?
			 WHERE token_hash = ? AND household_id = ? AND claimed_at IS NULL`
		)
		.run(now, tokenHashValue, householdId);
	return info.changes > 0;
}

/** What the claim page may show before anyone presses the button. Deliberately
    thin: enough to say what the link does, and nothing an unclaimed token should
    not reveal. */
export type LinkPreview =
	| { ok: true; kind: ClaimKind; display_name: string | null; expires_at: number }
	| { ok: false; reason: 'unknown' | 'expired' | 'used' | 'burnt' };

interface LinkRow {
	token_hash: string;
	kind: ClaimKind;
	household_id: string | null;
	display_name: string | null;
	role: string | null;
	member_id: string | null;
	created_by: string | null;
	expires_at: number;
	claimed_at: number | null;
	attempts: number;
	burnt_at: number | null;
}

function findLink(db: Db, secret: Buffer, token: string): LinkRow | undefined {
	return db
		.prepare(
			`SELECT token_hash, kind, household_id, display_name, role, member_id, created_by,
			        expires_at, claimed_at, attempts, burnt_at
			 FROM claim_links WHERE token_hash = ?`
		)
		.get(tokenHash(token, secret)) as LinkRow | undefined;
}

/** A GET may look, and looking never spends the link. */
export function previewLink(db: Db, secret: Buffer, token: string, now: number): LinkPreview {
	const row = findLink(db, secret, token);
	if (!row) return { ok: false, reason: 'unknown' };
	if (row.burnt_at != null) return { ok: false, reason: 'burnt' };
	if (row.claimed_at != null) return { ok: false, reason: 'used' };
	if (row.expires_at <= now) return { ok: false, reason: 'expired' };
	return { ok: true, kind: row.kind, display_name: row.display_name, expires_at: row.expires_at };
}

export type ClaimResult =
	| { ok: true; token: string; memberId: string; householdId: string; kind: ClaimKind }
	| { ok: false; reason: 'unknown' | 'expired' | 'used' | 'burnt' | 'rate_limited' | 'invalid' };

export interface ClaimInput {
	token: string;
	deviceId: string;
	/** The claiming Device's IANA zone. On first boot it becomes the Household
	    Zone (spec §7.3). */
	zone: string;
	/** Only a bootstrap claim asks for one; an Invite already carries the name an
	    Owner typed, so the timeline reads "Oma" from her first Entry. */
	displayName?: string;
	now: number;
}

/** Spends the link and binds the Device. Runs in one transaction: a claim either
    produces a session or leaves nothing behind. */
export function claim(db: Db, secret: Buffer, input: ClaimInput): ClaimResult {
	const hash = tokenHash(input.token, secret);

	return db.transaction((): ClaimResult => {
		const row = findLink(db, secret, input.token);
		if (!row) return { ok: false, reason: 'unknown' };
		if (row.burnt_at != null) return { ok: false, reason: 'burnt' };
		if (row.claimed_at != null) return { ok: false, reason: 'used' };
		if (row.expires_at <= input.now) return { ok: false, reason: 'expired' };

		/* Count the attempt before deciding, so a failure to complete still spends
		   one — and burn the token on the fifth. */
		const attempts = row.attempts + 1;
		if (attempts > MAX_TOKEN_ATTEMPTS) {
			db.prepare('UPDATE claim_links SET burnt_at = ? WHERE token_hash = ?').run(input.now, hash);
			return { ok: false, reason: 'burnt' };
		}
		db.prepare('UPDATE claim_links SET attempts = ? WHERE token_hash = ?').run(attempts, hash);

		if (input.deviceId.length === 0 || input.deviceId.length > 64) return { ok: false, reason: 'invalid' };

		let memberId: string;
		let householdId: string;

		if (row.kind === 'bootstrap') {
			const existing = theHousehold(db);
			const name = (input.displayName ?? '').trim();
			if (name.length === 0 || name.length > 200) return { ok: false, reason: 'invalid' };

			householdId = existing?.id ?? randomUUID();
			memberId = randomUUID();
			if (!existing) {
				db.prepare(
					'INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?, ?, ?, ?, ?)'
				).run(householdId, '', DEFAULT_DAY_START, input.zone, input.now);
				/* Household settings travel as revisions like everything else — the
				   Day Start above all — so a Device that pulls from cursor 0 learns
				   the lens from the log rather than from a side channel. */
				insertRevision(
					db,
					{
						id: randomUUID(),
						household_id: householdId,
						kind: 'household',
						entity_id: householdId,
						fields: { day_start: DEFAULT_DAY_START, zone: input.zone },
						merge_at: input.now,
						device_id: input.deviceId,
						author_id: memberId,
						skewed: false
					},
					input.now
				);
			}
			appendMemberRevision(db, {
				householdId,
				memberId,
				displayName: name,
				role: 'owner',
				/* Self-created: the first Owner has nobody to be invited by, and this
				   is still not an app-authored revision. */
				authorId: memberId,
				deviceId: input.deviceId,
				now: input.now
			});
		} else if (row.kind === 'invite') {
			householdId = row.household_id ?? theHousehold(db)?.id ?? '';
			if (householdId === '') return { ok: false, reason: 'invalid' };
			memberId = randomUUID();
			appendMemberRevision(db, {
				householdId,
				memberId,
				displayName: row.display_name ?? '',
				role: row.role === 'owner' ? 'owner' : 'caregiver',
				/* Attributed to the Owner who typed the name and picked the role. */
				authorId: row.created_by ?? memberId,
				deviceId: input.deviceId,
				now: input.now
			});
		} else {
			/* Rescue re-binds rather than creating a fresh Owner: a new row would
			   leave two "Mamas" and split three years of attribution between them,
			   since every Revision points at the old one. */
			if (!row.member_id) return { ok: false, reason: 'invalid' };
			memberId = row.member_id;
			householdId = row.household_id ?? theHousehold(db)?.id ?? '';
		}

		db.prepare('UPDATE claim_links SET claimed_at = ? WHERE token_hash = ?').run(input.now, hash);
		const token = createSession(db, secret, { memberId, deviceId: input.deviceId, now: input.now });
		return { ok: true, token, memberId, householdId, kind: row.kind };
	})();
}

function appendMemberRevision(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		displayName: string;
		role: Role;
		authorId: string;
		deviceId: string;
		now: number;
	}
): void {
	insertRevision(
		db,
		{
			id: randomUUID(),
			household_id: input.householdId,
			kind: 'member',
			entity_id: input.memberId,
			fields: { display_name: input.displayName, role: input.role, removed_at: null },
			merge_at: input.now,
			device_id: input.deviceId,
			author_id: input.authorId,
			skewed: false
		},
		input.now
	);
	materialise(db, input.householdId, 'member', input.memberId);
}

/** Seeds a Baby's Targets from the age table, once, at creation (ADR-0006). The
    server does this rather than the client so two Devices adding the same Baby
    cannot seed two different sets. */
export function seedTargetsFor(
	db: Db,
	input: {
		householdId: string;
		babyId: string;
		birthDate: string;
		zone: string;
		authorId: string;
		deviceId: string;
		now: number;
	}
): void {
	for (const seed of seedTargets(input.birthDate, input.now, input.zone)) {
		const id = randomUUID();
		insertRevision(
			db,
			{
				id: randomUUID(),
				household_id: input.householdId,
				kind: 'target',
				entity_id: id,
				fields: { baby_id: input.babyId, ...seed },
				merge_at: input.now,
				device_id: input.deviceId,
				author_id: input.authorId,
				skewed: false
			},
			input.now
		);
		materialise(db, input.householdId, 'target', id);
	}
}
