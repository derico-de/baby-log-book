/* Web Push: the keys, the encryption and the one HTTP request. RFC 8030
   (delivery), RFC 8188 (aes128gcm), RFC 8291 (the key derivation), RFC 8292
   (VAPID).

   Written against the RFCs rather than pulled from a library, for the reason
   this repo keeps only one runtime dependency: what it needs is a hundred lines
   of `node:crypto` — an ECDH, two HKDFs, one AES-GCM record and an ES256 JWT —
   and every one of them is a primitive Node already ships.

   The payload is **encrypted to the Device**, which is not decoration: a push
   goes through Google's or Apple's servers, and the Baby's name is in it. They
   forward ciphertext they cannot read; the keys come from the browser and never
   leave this deployment.

   The VAPID keypair lives in the volume beside the session key (spec §4.4).
   Losing it costs every Device its subscription — the browser refuses a push
   signed by a stranger — which is recoverable by re-subscribing and is exactly
   why it is not an environment variable. */

import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type ECDH } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CURVE = 'prime256v1';
/** One record, which is all a notification ever needs. */
const RECORD_SIZE = 4096;
const TAG_BYTES = 16;
/** The record's own delimiter byte rides with the plaintext. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - TAG_BYTES - 1;

export interface VapidKeys {
	/** The uncompressed P-256 point, base64url — what the browser is handed as
	    `applicationServerKey` and what `k=` carries. */
	publicKey: string;
	/** The 32-byte scalar, base64url. */
	privateKey: string;
}

export interface PushSubscription {
	endpoint: string;
	/** The Device's own public key, base64url. */
	p256dh: string;
	/** The Device's shared secret, base64url. */
	auth: string;
}

export interface PushResult {
	ok: boolean;
	status: number;
	/** The subscription is dead and the row should go: the browser has thrown it
	    away, or the Device has been wiped. Distinct from a failure worth
	    retrying — a push service having a bad minute must not cost a Device its
	    subscription. */
	gone: boolean;
}

const b64 = (buffer: Buffer | Uint8Array) => Buffer.from(buffer).toString('base64url');
const unb64 = (value: string) => Buffer.from(value, 'base64url');

function hmac(key: Buffer, input: Buffer): Buffer {
	return createHmac('sha256', key).update(input).digest();
}

/** HKDF-Expand (RFC 5869) for outputs of at most one hash block, which is every
    use here: 32-byte IKM, a 16-byte key, a 12-byte nonce. */
function expand(prk: Buffer, info: Buffer, length: number): Buffer {
	if (length > 32) throw new Error('expand: one block only');
	return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

function freshKeyPair(): ECDH {
	const ecdh = createECDH(CURVE);
	ecdh.generateKeys();
	return ecdh;
}

/** A P-256 scalar is 32 bytes, always — but `getPrivateKey()` returns the
    integer with its leading zeros stripped, so roughly one key in 256 comes back
    31 bytes or shorter. A JWK `d` of the wrong length is not a P-256 key: the
    header signer would throw, and `loadVapidKeys` below would discard the file
    and mint a fresh pair on every boot, changing the application server key that
    every existing subscription was minted against. Left-padded here, at the one
    place a scalar becomes a stored string. */
function scalar32(value: Buffer): Buffer {
	return value.length >= 32 ? value : Buffer.concat([Buffer.alloc(32 - value.length), value]);
}

export function generateVapidKeys(): VapidKeys {
	const ecdh = freshKeyPair();
	return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(scalar32(ecdh.getPrivateKey())) };
}

/** Reads the keypair, generating it on first boot — the same shape as the
    session key, and for the same reason: the deployment does what it needs
    doing, and the operator configures nothing. */
export function loadVapidKeys(path: string): VapidKeys {
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<VapidKeys>;
		if (typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string') {
			if (unb64(parsed.publicKey).length === 65 && unb64(parsed.privateKey).length === 32) {
				return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
			}
		}
	} catch {
		/* first boot, or a file we will not try to repair in place */
	}
	const keys = generateVapidKeys();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(keys, null, '\t'), { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		/* a volume that cannot chmod is still a volume */
	}
	return keys;
}

/** The raw scalar and point, as the KeyObject the signer wants. */
function privateKeyObject(keys: VapidKeys) {
	const point = unb64(keys.publicKey);
	return createPrivateKey({
		format: 'jwk',
		key: {
			kty: 'EC',
			crv: 'P-256',
			x: b64(point.subarray(1, 33)),
			y: b64(point.subarray(33, 65)),
			d: keys.privateKey
		}
	});
}

/** The `Authorization: vapid` header (RFC 8292): an ES256 JWT saying who is
    sending and to which push service, plus the public key it is signed with.
    Twelve hours, well inside the 24 the spec allows, so a clock a little out on
    either side is never the reason a notification does not arrive. */
export function vapidHeader(endpoint: string, keys: VapidKeys, subject: string, now: number): string {
	const header = b64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const claims = b64(
		Buffer.from(
			JSON.stringify({
				aud: new URL(endpoint).origin,
				exp: Math.floor(now / 1000) + 12 * 3600,
				sub: subject
			})
		)
	);
	const signed = `${header}.${claims}`;
	/* JOSE wants the raw r‖s pair, not the DER sequence OpenSSL hands back. */
	const signature = sign('sha256', Buffer.from(signed), {
		key: privateKeyObject(keys),
		dsaEncoding: 'ieee-p1363'
	});
	return `vapid t=${signed}.${b64(signature)}, k=${keys.publicKey}`;
}

/** RFC 8291 §3.4 and RFC 8188 §2: one aes128gcm record, addressed to one
    Device's keys.

      IKM   = HKDF(auth_secret, ecdh_secret, "WebPush: info" ‖ 0 ‖ ua ‖ as, 32)
      PRK   = HKDF-Extract(salt, IKM)
      CEK   = HKDF-Expand(PRK, "Content-Encoding: aes128gcm" ‖ 0, 16)
      nonce = HKDF-Expand(PRK, "Content-Encoding: nonce" ‖ 0, 12)

    The body is `salt ‖ rs ‖ idlen ‖ as_public ‖ AES-GCM(plaintext ‖ 0x02)`. The
    `0x02` is the last-record delimiter, and every notification this app sends is
    the last record. */
export function encryptPayload(
	payload: string,
	subscription: Pick<PushSubscription, 'p256dh' | 'auth'>,
	salt: Buffer = randomBytes(16),
	/** The one-per-message keypair. Injectable so a test can pin it; nothing in
	    the app ever passes it. */
	ephemeral: ECDH = freshKeyPair()
): Buffer {
	const plaintext = Buffer.from(payload, 'utf8');
	if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('push payload too large for one record');

	const uaPublic = unb64(subscription.p256dh);
	const authSecret = unb64(subscription.auth);
	const asPublic = ephemeral.getPublicKey();

	const shared = ephemeral.computeSecret(uaPublic);
	const ikm = expand(
		hmac(authSecret, shared),
		Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
		32
	);
	const prk = hmac(salt, ikm);
	const cek = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
	const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

	const recordSize = Buffer.alloc(4);
	recordSize.writeUInt32BE(RECORD_SIZE);
	const head = Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic]);

	const cipher = createCipheriv('aes-128-gcm', cek, nonce);
	const body = Buffer.concat([
		cipher.update(plaintext),
		cipher.update(Buffer.from([2])),
		cipher.final(),
		cipher.getAuthTag()
	]);
	return Buffer.concat([head, body]);
}

export interface SendOptions {
	keys: VapidKeys;
	/** Who to complain to about this deployment. RFC 8292 wants a contact; the
	    deployment's own origin is the honest one, since a self-hosted Book has no
	    support address to give. */
	subject: string;
	now: number;
	/** How long the push service should hold it if the Device is offline. Fifteen
	    minutes: a bottle nobody is going to offer again is not worth waking a
	    phone for tomorrow morning. */
	ttlSeconds?: number;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
}

export async function sendPush(
	subscription: PushSubscription,
	payload: string,
	options: SendOptions
): Promise<PushResult> {
	const body = encryptPayload(payload, subscription);
	const doFetch = options.fetchImpl ?? fetch;
	try {
		const response = await doFetch(subscription.endpoint, {
			method: 'POST',
			headers: {
				TTL: String(options.ttlSeconds ?? 900),
				/* The phone is asleep and the point is to wake it. */
				Urgency: 'high',
				'Content-Encoding': 'aes128gcm',
				'Content-Type': 'application/octet-stream',
				Authorization: vapidHeader(subscription.endpoint, options.keys, options.subject, options.now)
			},
			body: new Uint8Array(body),
			signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)
		});
		return {
			ok: response.ok,
			status: response.status,
			gone: response.status === 404 || response.status === 410
		};
	} catch {
		/* Unreachable push service, DNS, timeout: not the subscription's fault, so
		   it stays and the next bottle tries again. */
		return { ok: false, status: 0, gone: false };
	}
}
