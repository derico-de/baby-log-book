/* The encryption is checked the way a Device checks it: by decrypting.

   The test derives the keys from the *receiver's* side — its own private key
   and the ephemeral public key it finds in the header — which is the direction
   RFC 8291 is written in, and a derivation that agreed with itself but not with
   the RFC would come apart here. The header layout (RFC 8188 §2.1) is asserted
   byte by byte, because a browser that cannot parse it never runs the
   decryption at all. */

import { describe, expect, it } from 'vitest';
import {
	createDecipheriv,
	createECDH,
	createHmac,
	createPublicKey,
	randomBytes,
	verify
} from 'node:crypto';
import { encryptPayload, generateVapidKeys, MAX_PAYLOAD_BYTES, vapidHeader } from './webpush';

const b64 = (b: Buffer) => Buffer.from(b).toString('base64url');
const hmac = (key: Buffer, input: Buffer) => createHmac('sha256', key).update(input).digest();
const expand = (prk: Buffer, info: string, length: number) =>
	hmac(prk, Buffer.concat([Buffer.from(info, 'ascii'), Buffer.from([1])])).subarray(0, length);

/** A Device: its keypair and the auth secret the browser mints with it. */
function device() {
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	return {
		private: ecdh,
		subscription: {
			endpoint: 'https://push.example.com/subscription/abc',
			p256dh: b64(ecdh.getPublicKey()),
			auth: b64(randomBytes(16))
		}
	};
}

/** What a browser does with the bytes: parse the header, derive, decrypt. */
function decrypt(body: Buffer, ua: ReturnType<typeof device>): string {
	const salt = body.subarray(0, 16);
	const recordSize = body.readUInt32BE(16);
	const idLength = body.readUInt8(20);
	const asPublic = body.subarray(21, 21 + idLength);
	const sealed = body.subarray(21 + idLength);

	expect(recordSize).toBe(4096);
	expect(idLength).toBe(65);
	expect(asPublic[0]).toBe(0x04); /* an uncompressed point */

	const shared = ua.private.computeSecret(asPublic);
	const ikm = hmac(
		hmac(Buffer.from(ua.subscription.auth, 'base64url'), shared),
		Buffer.concat([
			Buffer.from('WebPush: info\0'),
			ua.private.getPublicKey(),
			asPublic,
			Buffer.from([1])
		])
	).subarray(0, 32);
	const prk = hmac(salt, ikm);
	const cek = expand(prk, 'Content-Encoding: aes128gcm\0', 16);
	const nonce = expand(prk, 'Content-Encoding: nonce\0', 12);

	const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
	decipher.setAuthTag(sealed.subarray(sealed.length - 16));
	const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);

	/* The last record ends with the 0x02 delimiter, never with padding. */
	expect(plain[plain.length - 1]).toBe(2);
	return plain.subarray(0, plain.length - 1).toString('utf8');
}

describe('the push payload', () => {
	it('arrives as what was sent', () => {
		const ua = device();
		const text = JSON.stringify({ title: 'Fläschchen', body: 'Lina — noch 10 Minuten' });
		expect(decrypt(encryptPayload(text, ua.subscription), ua)).toBe(text);
	});

	it('is different bytes every time, because the salt and the keypair are', () => {
		const ua = device();
		const once = encryptPayload('same', ua.subscription);
		const twice = encryptPayload('same', ua.subscription);
		expect(once.equals(twice)).toBe(false);
		expect(decrypt(once, ua)).toBe('same');
		expect(decrypt(twice, ua)).toBe('same');
	});

	it('cannot be read with another Device\'s keys', () => {
		const ua = device();
		const other = device();
		expect(() => decrypt(encryptPayload('secret', ua.subscription), other)).toThrow();
	});

	it('refuses a payload too large for one record', () => {
		const ua = device();
		expect(() => encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES + 1), ua.subscription)).toThrow();
		expect(() => encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES), ua.subscription)).not.toThrow();
	});
});

describe('the VAPID header', () => {
	const keys = generateVapidKeys();
	const endpoint = 'https://push.example.com/subscription/abc?x=1';
	const now = Date.parse('2026-08-17T12:00:00Z');

	function parse(header: string) {
		const t = /(?:^|\s)t=([^,\s]+)/.exec(header)?.[1] ?? '';
		const k = /(?:^|\s)k=([^,\s]+)/.exec(header)?.[1] ?? '';
		const [head, claims, signature] = t.split('.');
		return {
			t,
			k,
			head: JSON.parse(Buffer.from(head, 'base64url').toString()),
			claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
			signature: Buffer.from(signature, 'base64url'),
			signed: `${head}.${claims}`
		};
	}

	it('is an ES256 JWT for the push service, signed by the key it names', () => {
		const parsed = parse(vapidHeader(endpoint, keys, 'https://log.example.com', now));
		expect(parsed.head).toEqual({ typ: 'JWT', alg: 'ES256' });
		/* The audience is the push service's origin, never the whole endpoint —
		   the path is the Device's address and no third party needs it. */
		expect(parsed.claims.aud).toBe('https://push.example.com');
		expect(parsed.claims.sub).toBe('https://log.example.com');
		expect(parsed.claims.exp).toBe(Math.floor(now / 1000) + 12 * 3600);
		expect(parsed.k).toBe(keys.publicKey);

		const point = Buffer.from(keys.publicKey, 'base64url');
		const publicKey = createPublicKey({
			format: 'jwk',
			key: { kty: 'EC', crv: 'P-256', x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) }
		});
		expect(
			verify('sha256', Buffer.from(parsed.signed), { key: publicKey, dsaEncoding: 'ieee-p1363' }, parsed.signature)
		).toBe(true);
	});

	it('signs raw r‖s, which is what JOSE means by ES256', () => {
		const parsed = parse(vapidHeader(endpoint, keys, 'https://log.example.com', now));
		expect(parsed.signature.length).toBe(64);
	});

	it('mints a keypair that is a P-256 point and its scalar', () => {
		expect(Buffer.from(keys.publicKey, 'base64url').length).toBe(65);
		expect(Buffer.from(keys.privateKey, 'base64url').length).toBe(32);
	});
});
