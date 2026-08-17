/* Generates the PWA icons with no image dependency at all.

   The mark is the crescent from the Sleep glyph — one circle minus an offset
   circle — on the deep-night ground the manifest paints permanently. A build
   step that needs a rasteriser to draw two circles is a build step nobody can
   run offline, so this does the arithmetic itself and deflates the result.

   Run: node scripts/make-icons.mjs   (output committed under static/icons/) */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const GROUND = [0x03, 0x02, 0x02]; /* deep-night ground, oklch(0.09 0.005 60) */
const ACCENT = [0xd8, 0x8a, 0x4e]; /* the accent, lifted for a dark ground */

function crc32(buf) {
	let c = ~0;
	for (const b of buf) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

/** `inset` leaves the safe zone a maskable icon needs. */
function png(size, { maskable = false } = {}) {
	const cx = size / 2;
	const cy = size / 2;
	const scale = maskable ? 0.3 : 0.38; /* the crescent's outer radius */
	const rOuter = size * scale;
	const rInner = rOuter * 0.86;
	const offset = rOuter * 0.42;

	const raw = Buffer.alloc(size * (size * 3 + 1));
	let p = 0;
	for (let y = 0; y < size; y++) {
		raw[p++] = 0; /* filter: none */
		for (let x = 0; x < size; x++) {
			const dOuter = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
			const dInner = Math.hypot(x + 0.5 - (cx + offset), y + 0.5 - (cy - offset * 0.6));
			/* Antialias the two edges over one pixel, so a 192px icon does not
			   look hand-cut. */
			const inOuter = clamp(rOuter - dOuter);
			const outInner = clamp(dInner - rInner);
			const a = Math.min(inOuter, outInner);
			const c = mix(GROUND, ACCENT, a);
			raw[p++] = c[0];
			raw[p++] = c[1];
			raw[p++] = c[2];
		}
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; /* bit depth */
	ihdr[9] = 2; /* colour type: truecolour */

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

mkdirSync('static/icons', { recursive: true });
writeFileSync('static/icons/icon-192.png', png(192));
writeFileSync('static/icons/icon-512.png', png(512));
writeFileSync('static/icons/icon-maskable-512.png', png(512, { maskable: true }));
console.log('wrote static/icons/{icon-192,icon-512,icon-maskable-512}.png');
