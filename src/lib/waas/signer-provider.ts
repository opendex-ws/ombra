import { authBackendBase } from './auth-base';
import { getAuthToken, refreshToken } from '$lib/stores/auth.svelte';

export interface OwnerIdentity {
	userId: string;
	orgId: string;
}

export type SignerProvider = 'waas' | 'turnkey';

export interface WaasAccount {
	provider: SignerProvider;
	identity: OwnerIdentity | null;
	/** Google account email for Google owner proofs; null when unknown or omitted by older backends. */
	googleEmail: string | null;
}

export interface SignerProviderDeps {
	token: () => string | null;
	refresh: () => Promise<string | null>;
	base: () => string;
	fetch: typeof fetch;
}

const browserDeps = (): SignerProviderDeps => ({
	token: getAuthToken,
	refresh: refreshToken,
	base: authBackendBase,
	fetch: (input, init) => fetch(input, init)
});

function parseAccount(body: unknown): WaasAccount | null {
	const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
	const provider = record?.provider;
	if (provider !== 'waas' && provider !== 'turnkey') return null;
	const userId = record?.user_id;
	const orgId = record?.org_id;
	const identity =
		typeof userId === 'string' && userId !== '' && typeof orgId === 'string' && orgId !== ''
			? { userId, orgId }
			: null;
	const email = record?.google_email;
	const googleEmail = typeof email === 'string' && email.trim() !== '' ? email.trim() : null;
	return { provider, identity, googleEmail };
}

/**
 * GET /auth/wallet/signer-provider for the current session. The answer depends on the
 * bearer token, not the URL, so it is never served from the HTTP cache. An expired token
 * is refreshed once. Returns null when the provider cannot be determined.
 */
export async function fetchWaasAccount(deps: SignerProviderDeps = browserDeps()): Promise<WaasAccount | null> {
	const base = deps.base();
	let token = deps.token();
	if (!token || !base) return null;
	try {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const res = await deps.fetch(`${base}/auth/wallet/signer-provider`, {
				headers: { Authorization: `Bearer ${token}` },
				cache: 'no-store'
			});
			if (res.status === 401 && attempt === 0) {
				const next = await deps.refresh();
				if (!next) return null;
				token = next;
				continue;
			}
			if (!res.ok) return null;
			return parseAccount(await res.json());
		}
		return null;
	} catch {
		return null;
	}
}

export async function fetchSignerProvider(deps?: SignerProviderDeps): Promise<SignerProvider | null> {
	return (await fetchWaasAccount(deps))?.provider ?? null;
}

/** The session's user, so a cached provider never outlives an account switch. Token refreshes keep it. */
export function sessionIdentity(token: string | null): string | null {
	if (!token) return null;
	try {
		const part = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
		const claims = JSON.parse(atob(part)) as {
			user?: { id?: unknown; organization_id?: unknown };
			sub?: unknown;
			iss?: unknown;
		};
		const user = claims.user?.id ?? claims.sub;
		if (typeof user !== 'string' || user === '') return token;
		return JSON.stringify([user, claims.user?.organization_id ?? claims.iss ?? null]);
	} catch {
		return token;
	}
}

const resolved = new Map<string, WaasAccount>();

/**
 * Signer provider for a session identity, cached per identity once known. Retries a
 * failed lookup a few times; null means still unknown (the caller shows a retry), never
 * a guess.
 */
export async function loadSignerProvider(
	identity: string,
	options: { attempts?: number; delayMs?: number; deps?: SignerProviderDeps } = {}
): Promise<SignerProvider | null> {
	return (await loadWaasAccount(identity, options))?.provider ?? null;
}

/** The whole signer-provider answer for a session identity, cached like loadSignerProvider. */
export async function loadWaasAccount(
	identity: string,
	options: { attempts?: number; delayMs?: number; deps?: SignerProviderDeps } = {}
): Promise<WaasAccount | null> {
	const cached = resolved.get(identity);
	if (cached) return cached;
	const attempts = options.attempts ?? 3;
	const delayMs = options.delayMs ?? 1000;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
		const deps = options.deps ?? browserDeps();
		// The session changed while waiting: the caller discards this answer anyway.
		if (sessionIdentity(deps.token()) !== identity) return null;
		const account = await fetchWaasAccount(deps);
		if (sessionIdentity(deps.token()) !== identity) return null;
		if (account) {
			resolved.set(identity, account);
			return account;
		}
	}
	return null;
}

export function clearSignerProviderCache(): void {
	resolved.clear();
}
