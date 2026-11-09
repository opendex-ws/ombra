import { beforeEach, describe, expect, test, vi } from 'vitest';
import { codeChallengeFor, googleStartUrl, orgIdFromHost, resolveGoogleCallback } from './google';

vi.mock('$lib/api/config', () => ({ API_BASE: 'https://api.test' }));

const ORG = '70fa6edc-272a-54d2-813e-8a576ab5de81';

describe('orgIdFromHost', () => {
	test('reads the org id from a plain white-label host', () => {
		expect(orgIdFromHost(`${ORG}.wl.example.test`)).toBe(ORG);
	});

	test('reads the org id after a prefix such as new-', () => {
		expect(orgIdFromHost(`new-${ORG}.wl.example.test`)).toBe(ORG);
	});

	test('returns null for hosts without an org id', () => {
		expect(orgIdFromHost('api.opendex.ws')).toBeNull();
		expect(orgIdFromHost(`${ORG}x.wl.example.test`)).toBeNull();
		expect(orgIdFromHost(`x${ORG}.wl.example.test`)).toBeNull();
	});
});

const B64URL = /^[A-Za-z0-9_-]+$/;

describe('PKCE challenge', () => {
	test('matches the RFC 7636 appendix B vector', async () => {
		expect(await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});
});

describe('googleStartUrl', () => {
	beforeEach(() => sessionStorage.clear());

	test('sends a 43 char challenge and keeps only the verifier in sessionStorage', async () => {
		const url = new URL(await googleStartUrl(ORG));
		const challenge = url.searchParams.get('codeChallenge')!;
		expect(url.origin + url.pathname).toBe('https://api.test/sso/google/start');
		expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const redirect = new URL(url.searchParams.get('redirectUri')!);
		expect(redirect.pathname).toBe('/auth/google/callback');
		const attempt = redirect.searchParams.get('attempt')!;
		expect(attempt).toMatch(B64URL);
		const stored = JSON.parse(sessionStorage.getItem('google_pkce:' + attempt)!);
		expect(stored.orgId).toBe(ORG);
		expect(stored.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await codeChallengeFor(stored.verifier)).toBe(challenge);
		expect(url.toString()).not.toContain(stored.verifier);
	});

	test('every attempt gets a fresh verifier', async () => {
		await googleStartUrl(ORG);
		await googleStartUrl(ORG);
		expect(sessionStorage.length).toBe(2);
	});
});

describe('resolveGoogleCallback', () => {
	beforeEach(() => sessionStorage.clear());

	async function started() {
		const url = new URL(await googleStartUrl(ORG));
		const attempt = new URL(url.searchParams.get('redirectUri')!).searchParams.get('attempt')!;
		const { verifier } = JSON.parse(sessionStorage.getItem('google_pkce:' + attempt)!);
		return { attempt, verifier };
	}
	const okFetch = () =>
		vi.fn(async () => new Response(JSON.stringify({ token: 'jwt', wallet: 'W1' }), { status: 200 }));

	test('exchanges the code with the stored verifier, strips the URL first, removes the verifier', async () => {
		const { attempt, verifier } = await started();
		const order: string[] = [];
		const fetchFn = vi.fn(async () => {
			order.push('fetch');
			return new Response(JSON.stringify({ token: 'jwt', wallet: 'W1' }), { status: 200 });
		});
		const result = await resolveGoogleCallback(
			new URLSearchParams({ code: 'the-code', attempt }),
			() => order.push('strip'),
			fetchFn as unknown as typeof fetch
		);
		expect(result).toEqual({ ok: true, token: 'jwt', wallet: 'W1' });
		expect(order).toEqual(['strip', 'fetch']);
		const [path, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(path).toBe('https://api.test/sso/google/exchange');
		expect(JSON.parse(init.body as string)).toEqual({ code: 'the-code', codeVerifier: verifier, orgId: ORG });
		expect(sessionStorage.getItem('google_pkce:' + attempt)).toBeNull();
	});

	test('fails without calling the backend when the verifier is missing', async () => {
		const fetchFn = okFetch();
		const result = await resolveGoogleCallback(
			new URLSearchParams({ code: 'c', attempt: 'unknown' }),
			() => {},
			fetchFn as unknown as typeof fetch
		);
		expect(result).toEqual({ ok: false, message: 'Google sign-in failed.' });
		expect(fetchFn).not.toHaveBeenCalled();
	});

	test.each([
		['a rejected exchange', async () => new Response('{}', { status: 400 })],
		['a network error', async () => Promise.reject(new Error('down'))],
		['a body without token', async () => new Response('{}', { status: 200 })]
	])('shows the error for %s and burns the verifier', async (_n, impl) => {
		const { attempt } = await started();
		const result = await resolveGoogleCallback(
			new URLSearchParams({ code: 'c', attempt }),
			() => {},
			vi.fn(impl) as unknown as typeof fetch
		);
		expect(result).toEqual({ ok: false, message: 'Google sign-in failed.' });
		expect(sessionStorage.getItem('google_pkce:' + attempt)).toBeNull();
	});

	test('legacy token in the query keeps working without a fetch', async () => {
		const fetchFn = okFetch();
		const strip = vi.fn();
		const result = await resolveGoogleCallback(
			new URLSearchParams({ token: 'legacy', wallet: 'W2' }),
			strip,
			fetchFn as unknown as typeof fetch
		);
		expect(result).toEqual({ ok: true, token: 'legacy', wallet: 'W2' });
		expect(fetchFn).not.toHaveBeenCalled();
	});

	test('error params keep the existing messages', async () => {
		const failed = await resolveGoogleCallback(new URLSearchParams({ error: 'google_login_failed' }));
		expect(failed).toEqual({ ok: false, message: 'Google sign-in failed.' });
		const preparing = await resolveGoogleCallback(new URLSearchParams({ error: 'venue_wallets_preparing' }));
		expect(preparing.ok).toBe(false);
		expect(!preparing.ok && preparing.message).toContain('being prepared');
		expect(await resolveGoogleCallback(new URLSearchParams())).toEqual(failed);
	});
});
