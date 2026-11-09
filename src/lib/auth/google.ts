import { API_BASE } from '$lib/api/config';

export interface GoogleLoginConfig {
	enabled: boolean;
	mode: string;
	buttonLabel: string;
}

export function orgIdFromHost(host: string): string | null {
	const label = host.split('.')[0];
	const match = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(label);
	return match ? match[1] : null;
}

export function orgIdFromApiBase(): string | null {
	if (!API_BASE) return null;
	try {
		return orgIdFromHost(new URL(API_BASE).hostname);
	} catch {
		return null;
	}
}

export function authBackendUrl(): string {
	// The API backend serves /sso/google and the WaaS auth routes.
	return API_BASE;
}

export async function fetchGoogleLoginConfig(orgId: string): Promise<GoogleLoginConfig> {
	const empty = { enabled: false, mode: 'off', buttonLabel: '' };
	if (!orgId || !authBackendUrl()) return empty;
	try {
		const res = await fetch(`/auth/google/config?orgId=${encodeURIComponent(orgId)}`);
		if (!res.ok) return empty;
		const body = (await res.json()) as Partial<GoogleLoginConfig>;
		return {
			enabled: Boolean(body.enabled),
			mode: body.mode || 'off',
			buttonLabel: body.buttonLabel || ''
		};
	} catch {
		return empty;
	}
}

function base64url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64url(length = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(length)));
}

/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export async function codeChallengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

const PKCE_PREFIX = 'google_pkce:';
const PKCE_MAX_AGE_MS = 10 * 60 * 1000;

interface PkceAttempt {
	verifier: string;
	orgId: string;
	/** Auth host the login started on; the code is exchanged on the same host. */
	base: string;
	at: number;
}

function dropStaleAttempts(): void {
	for (let i = sessionStorage.length - 1; i >= 0; i--) {
		const key = sessionStorage.key(i);
		if (!key?.startsWith(PKCE_PREFIX)) continue;
		try {
			const at = (JSON.parse(sessionStorage.getItem(key) ?? '{}') as Partial<PkceAttempt>).at;
			if (typeof at !== 'number' || Date.now() - at > PKCE_MAX_AGE_MS) sessionStorage.removeItem(key);
		} catch {
			sessionStorage.removeItem(key);
		}
	}
}

/**
 * Start URL for a PKCE-style login. The verifier stays in this tab's sessionStorage (keyed
 * by a per-attempt id that rides on the redirectUri); only its SHA-256 challenge is sent.
 */
export async function googleStartUrl(orgId: string): Promise<string> {
	const base = authBackendUrl() || API_BASE;
	const verifier = randomBase64url(32);
	const attempt = randomBase64url(16);
	dropStaleAttempts();
	sessionStorage.setItem(
		PKCE_PREFIX + attempt,
		JSON.stringify({ verifier, orgId, base, at: Date.now() } satisfies PkceAttempt)
	);
	const redirectUri = `${window.location.origin}/auth/google/callback?attempt=${attempt}`;
	const url = new URL(`${base}/sso/google/start`);
	url.searchParams.set('orgId', orgId);
	url.searchParams.set('redirectUri', redirectUri);
	url.searchParams.set('codeChallenge', await codeChallengeFor(verifier));
	return url.toString();
}

function takeAttempt(attempt: string | null): PkceAttempt | null {
	if (!attempt) return null;
	const key = PKCE_PREFIX + attempt;
	const raw = sessionStorage.getItem(key);
	sessionStorage.removeItem(key);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<PkceAttempt>;
		return typeof parsed.verifier === 'string' && typeof parsed.orgId === 'string' && typeof parsed.base === 'string'
			? (parsed as PkceAttempt)
			: null;
	} catch {
		return null;
	}
}

export type GoogleCallbackResult =
	| { ok: true; token: string; wallet: string | null }
	| { ok: false; message: string };

function failure(error: string | null): GoogleCallbackResult {
	return {
		ok: false,
		message:
			error === 'venue_wallets_preparing' || error === 'setup_error'
				? 'Your wallets are being prepared. Wait a moment, then try signing in again.'
				: 'Google sign-in failed.'
	};
}

/**
 * Reads the Google login return. `code` (PKCE) is exchanged for the session with the
 * stored verifier; `token` (legacy, backend without codeChallenge) is taken from the URL.
 * `stripUrl` runs before the exchange so the code never stays in history.
 */
export async function resolveGoogleCallback(
	params: URLSearchParams,
	stripUrl: () => void = () => window.history.replaceState(window.history.state, '', window.location.pathname),
	fetchFn: typeof fetch = fetch
): Promise<GoogleCallbackResult> {
	const error = params.get('error');
	const code = params.get('code');
	if (code && !error) {
		const attempt = takeAttempt(params.get('attempt'));
		stripUrl();
		if (!attempt) return failure(null);
		try {
			// Straight from the browser to the host that served /sso/google/start (CORS: the org's
			// allowed origins, applied by the white-label proxy). No server relay: the Worker
			// cannot always reach that host.
			const res = await fetchFn(`${attempt.base}/sso/google/exchange`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'omit',
				cache: 'no-store',
				body: JSON.stringify({ code, codeVerifier: attempt.verifier, orgId: attempt.orgId })
			});
			if (!res.ok) return failure(null);
			const body = (await res.json()) as { token?: string; wallet?: string };
			if (!body.token) return failure(null);
			return { ok: true, token: body.token, wallet: body.wallet || null };
		} catch {
			return failure(null);
		}
	}
	const token = params.get('token');
	if (!token || error) return failure(error);
	return { ok: true, token, wallet: params.get('wallet') };
}
