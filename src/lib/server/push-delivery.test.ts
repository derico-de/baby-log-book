/* End to end, minus the browser: the notifier against a real HTTP server
   standing in for a push service (ADR-0030).

   `notify.test.ts` fakes the sender to test the rules; this one lets the real
   one run, so what is asserted is what a push service actually receives — the
   headers RFC 8030 requires, the VAPID authorization, and a body that decrypts
   with the Device's own key to the text the Member should read. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { openDb, type Db } from './db';
import { runMigrations } from './migrations';
import { pushSender, runNotifierTick, saveSubscription } from './notify';
import { generateVapidKeys } from './webpush';

const BERLIN = 'Europe/Berlin';
const STARTED = Date.parse('2026-08-17T13:00:00Z');
const INSIDE = Date.parse('2026-08-17T13:55:00Z');

interface Received {
	headers: Record<string, string | string[] | undefined>;
	body: Buffer;
}

let db: Db;
let service: Server;
let received: Received[];
let status = 201;

const b64 = (b: Buffer) => Buffer.from(b).toString('base64url');
const hmac = (key: Buffer, input: Buffer) => createHmac('sha256', key).update(input).digest();
const expand = (prk: Buffer, info: string, length: number) =>
	hmac(prk, Buffer.concat([Buffer.from(info, 'ascii'), Buffer.from([1])])).subarray(0, length);

/** A Device's keys, as the browser would have minted them. */
const ua = (() => {
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	return { ecdh, auth: randomBytes(16) };
})();

function readsBack(body: Buffer): string {
	const salt = body.subarray(0, 16);
	const asPublic = body.subarray(21, 21 + body.readUInt8(20));
	const sealed = body.subarray(21 + body.readUInt8(20));
	const ikm = hmac(
		hmac(ua.auth, ua.ecdh.computeSecret(asPublic)),
		Buffer.concat([
			Buffer.from('WebPush: info\0'),
			ua.ecdh.getPublicKey(),
			asPublic,
			Buffer.from([1])
		])
	).subarray(0, 32);
	const prk = hmac(salt, ikm);
	const decipher = createDecipheriv(
		'aes-128-gcm',
		expand(prk, 'Content-Encoding: aes128gcm\0', 16),
		expand(prk, 'Content-Encoding: nonce\0', 12)
	);
	decipher.setAuthTag(sealed.subarray(sealed.length - 16));
	const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
	return plain.subarray(0, plain.length - 1).toString('utf8');
}

async function listening(): Promise<string> {
	received = [];
	status = 201;
	service = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			received.push({ headers: request.headers, body: Buffer.concat(chunks) });
			response.writeHead(status);
			response.end();
		});
	});
	await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
	const address = service.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	return `http://127.0.0.1:${port}/subscription/one`;
}

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	db.prepare('INSERT INTO households (id, name, day_start, zone, created_at) VALUES (?,?,?,?,?)').run(
		'h1',
		'Zuhause',
		'05:00',
		BERLIN,
		STARTED
	);
	db.prepare('INSERT INTO members (id, household_id, display_name, role, locale) VALUES (?,?,?,?,?)').run(
		'mum',
		'h1',
		'Mama',
		'parent',
		'de'
	);
	db.prepare('INSERT INTO babies (id, household_id, name, birth_date) VALUES (?,?,?,?)').run(
		'b1',
		'h1',
		'Lina',
		'2026-02-17'
	);
	db.prepare(
		`INSERT INTO entries (id, household_id, baby_id, type, occurred_at, payload, logged_by, logged_at)
		 VALUES ('f1','h1','b1','bottle_feed',?,'{}','mum',?)`
	).run(STARTED, STARTED);
});

afterEach(async () => {
	await new Promise<void>((resolve) => service.close(() => resolve()));
});

describe('what a push service receives', () => {
	it('is an encrypted notification the Device can read, and nobody else', async () => {
		const endpoint = await listening();
		const keys = generateVapidKeys();
		saveSubscription(db, {
			endpoint,
			p256dh: b64(ua.ecdh.getPublicKey()),
			auth: b64(ua.auth),
			householdId: 'h1',
			memberId: 'mum',
			deviceId: 'phone',
			now: STARTED
		});

		const result = await runNotifierTick(
			db,
			INSIDE,
			pushSender(keys, 'https://log.example.com', () => INSIDE)
		);
		expect(result).toEqual({ sent: 1, failed: 0, dropped: 0 });
		expect(received.length).toBe(1);

		const { headers, body } = received[0];
		expect(headers['content-encoding']).toBe('aes128gcm');
		expect(headers['content-type']).toBe('application/octet-stream');
		expect(headers.ttl).toBe('900');
		expect(headers.urgency).toBe('high');
		expect(String(headers.authorization)).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
		expect(String(headers.authorization)).toContain(`k=${keys.publicKey}`);

		/* And the part that matters: the push service carried bytes it could not
		   read, and the Device's own key opens them. */
		const notice = JSON.parse(readsBack(body)) as { title: string; body: string; tag: string };
		expect(notice.title).toBe('Fläschchenzeit fast um');
		expect(notice.body).toContain('Lina');
		expect(notice.tag).toBe('bottle:f1');
		expect(body.toString('utf8')).not.toContain('Lina');
	});

	it('drops a subscription the service says is gone, and keeps one it merely refused', async () => {
		const endpoint = await listening();
		const keys = generateVapidKeys();
		saveSubscription(db, {
			endpoint,
			p256dh: b64(ua.ecdh.getPublicKey()),
			auth: b64(ua.auth),
			householdId: 'h1',
			memberId: 'mum',
			deviceId: 'phone',
			now: STARTED
		});
		const send = pushSender(keys, 'https://log.example.com', () => INSIDE);

		status = 429;
		expect(await runNotifierTick(db, INSIDE, send)).toEqual({ sent: 0, failed: 1, dropped: 0 });
		expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 1 });

		status = 410;
		expect(await runNotifierTick(db, INSIDE + 60_000, send)).toEqual({ sent: 0, failed: 0, dropped: 1 });
		expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
	});
});
