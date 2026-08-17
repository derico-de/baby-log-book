/* Rate limiting lives in the app, on the claim endpoint only. Spec §4.4.

   This corrects the Accounts ticket, which had assigned it to the reverse proxy:
   with a proxy-agnostic image half the operators would never configure it, and
   guessing a Claim Link token *is* the attack.

   In memory is fine — one process, and a restart clearing the counters is not a
   meaningful bypass. The per-token limit (five, then the token is burnt) is the
   one that matters, being the part an attacker cannot rotate around; this
   per-IP limit is the coarse net around it. */

export const IP_ATTEMPTS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60_000;
/** A cap on the table itself, so a spray of forged source addresses cannot grow
    it without bound. */
const MAX_TRACKED_KEYS = 10_000;

export class RateLimiter {
	private hits = new Map<string, number[]>();

	constructor(
		private readonly max = IP_ATTEMPTS_PER_HOUR,
		private readonly windowMs = WINDOW_MS
	) {}

	/** Records an attempt and says whether it is allowed. */
	take(key: string, now: number): boolean {
		const cutoff = now - this.windowMs;
		const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

		if (recent.length >= this.max) {
			this.hits.set(key, recent);
			return false;
		}

		recent.push(now);
		this.hits.set(key, recent);

		if (this.hits.size > MAX_TRACKED_KEYS) this.sweep(cutoff);
		return true;
	}

	remaining(key: string, now: number): number {
		const cutoff = now - this.windowMs;
		const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
		return Math.max(0, this.max - recent.length);
	}

	private sweep(cutoff: number): void {
		for (const [key, times] of this.hits) {
			const recent = times.filter((t) => t > cutoff);
			if (recent.length === 0) this.hits.delete(key);
			else this.hits.set(key, recent);
		}
	}
}

/** The claim endpoint's limiter, shared by the whole process. */
export const claimLimiter = new RateLimiter();

/** TRUST_PROXY defaults off: behind an unknown proxy topology an untrusted
    `X-Forwarded-For` is a forged client IP walking through the limit. */
export function clientIp(
	request: Request,
	getClientAddress: () => string,
	trustProxy: boolean
): string {
	if (trustProxy) {
		const forwarded = request.headers.get('x-forwarded-for');
		if (forwarded) {
			const first = forwarded.split(',')[0]?.trim();
			if (first) return first;
		}
	}
	try {
		return getClientAddress();
	} catch {
		/* Some adapters cannot tell. One shared bucket is still a limit. */
		return 'unknown';
	}
}
