// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/stores/auth.svelte', () => ({ getAuthToken: () => null, refreshToken: vi.fn(async () => null) }));

import {
	clearSignerProviderCache,
	fetchWaasAccount,
	loadWaasAccount,
	loadSignerProvider,
	sessionIdentity,
	type SignerProviderDeps
} from './signer-provider';

function jwt(userId: string): string {
	const payload = Buffer.from(JSON.stringify({ user: { id: userId }, iss: 'org-1' })).toString('base64url');
	return `e30.${payload}.sig`;
}

function deps(responses: Response[], token = jwt('user-1'), refreshed: string | null = jwt('user-1') + 'x') {
	let current: string | null = token;
	const seen: { url: string; init?: RequestInit }[] = [];
	const d: SignerProviderDeps = {
		token: () => current,
		refresh: vi.fn(async () => {
			current = refreshed;
			return refreshed;
		}),
		base: () => 'https://auth.test',
		fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			seen.push({ url: String(url), init });
			const next = responses.shift();
			if (!next) throw new Error('offline');
			return next;
		}) as unknown as typeof fetch
	};
	return { d, seen, setToken: (t: string | null) => (current = t) };
}

const ok = (provider: string) =>
	new Response(JSON.stringify({ provider, user_id: 'u', org_id: 'o' }), { status: 200 });

describe('signer provider', () => {
	beforeEach(() => clearSignerProviderCache());

	it('bypasses the HTTP cache: the answer depends on the bearer token, not the URL', async () => {
		const { d, seen } = deps([ok('waas')]);
		expect((await fetchWaasAccount(d))?.provider).toBe('waas');
		expect(seen[0].url).toBe('https://auth.test/auth/wallet/signer-provider');
		expect(seen[0].init?.cache).toBe('no-store');
	});

	it('refreshes an expired token once and asks again', async () => {
		const { d, seen } = deps([new Response('', { status: 401 }), ok('waas')]);
		expect((await fetchWaasAccount(d))?.provider).toBe('waas');
		expect(d.refresh).toHaveBeenCalledTimes(1);
		expect((seen[1].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${jwt('user-1')}x`);
	});

	it('never guesses: a failed lookup is unknown (null), not turnkey', async () => {
		const { d } = deps([new Response('', { status: 500 }), new Response('', { status: 502 })]);
		expect(await loadSignerProvider(sessionIdentity(jwt('user-1'))!, { attempts: 2, delayMs: 0, deps: d })).toBeNull();
	});

	it('retries a failed lookup and caches the answer per user', async () => {
		const { d } = deps([new Response('', { status: 503 }), ok('waas')]);
		const id = sessionIdentity(jwt('user-1'))!;
		expect(await loadSignerProvider(id, { attempts: 3, delayMs: 0, deps: d })).toBe('waas');
		expect(await loadSignerProvider(id, { attempts: 3, delayMs: 0, deps: d })).toBe('waas');
		expect(d.fetch).toHaveBeenCalledTimes(2);
	});

	it('drops the answer when the session switched to another user meanwhile', async () => {
		const { d, setToken } = deps([]);
		(d.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
			setToken(jwt('user-2'));
			return ok('turnkey');
		});
		expect(await loadSignerProvider(sessionIdentity(jwt('user-1'))!, { attempts: 1, deps: d })).toBeNull();
	});

	it('keys the cache on the user, so a token refresh keeps it and an account switch does not', () => {
		expect(sessionIdentity(jwt('user-1'))).toBe(sessionIdentity(jwt('user-1') + 'x'));
		expect(sessionIdentity(jwt('user-1'))).not.toBe(sessionIdentity(jwt('user-2')));
		expect(sessionIdentity(null)).toBeNull();
	});

	it('parses google_email and stays null-safe when it is missing, null, blank or not a string', async () => {
		const body = (extra: Record<string, unknown>) =>
			new Response(JSON.stringify({ provider: 'waas', user_id: 'u', org_id: 'o', ...extra }), { status: 200 });
		const cases: [Record<string, unknown>, string | null][] = [
			[{ google_email: 'owner@gmail.com' }, 'owner@gmail.com'],
			[{ google_email: '  owner@gmail.com ' }, 'owner@gmail.com'],
			[{ google_email: null }, null],
			[{}, null],
			[{ google_email: '' }, null],
			[{ google_email: 42 }, null]
		];
		for (const [extra, expected] of cases) {
			const { d } = deps([body(extra)]);
			const account = await fetchWaasAccount(d);
			expect(account).toEqual({ provider: 'waas', identity: { userId: 'u', orgId: 'o' }, googleEmail: expected });
		}
	});

	it('caches the whole account, email included', async () => {
		const { d } = deps([
			new Response(JSON.stringify({ provider: 'waas', user_id: 'u', org_id: 'o', google_email: 'a@b.co' }), { status: 200 })
		]);
		const id = sessionIdentity(jwt('user-1'))!;
		expect((await loadWaasAccount(id, { attempts: 1, deps: d }))?.googleEmail).toBe('a@b.co');
		expect((await loadWaasAccount(id, { attempts: 1, deps: d }))?.googleEmail).toBe('a@b.co');
		expect(d.fetch).toHaveBeenCalledTimes(1);
	});
});
