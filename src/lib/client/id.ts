/* Client-minted ids, which is what makes push idempotent on retry: a revision
   that arrives twice is the same row, so a lost response costs nothing. */

export function randomId(): string {
	const source: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
	if (typeof source?.randomUUID === 'function') return source.randomUUID();
	/* Old iOS in a non-secure context. Still 128 bits from getRandomValues. */
	if (typeof source?.getRandomValues === 'function') {
		const bytes = source.getRandomValues(new Uint8Array(16));
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	}
	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
