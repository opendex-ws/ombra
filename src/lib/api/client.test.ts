// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
	token: 'old-token' as string | null,
	refreshToken: vi.fn(async () => 'new-token'),
	disconnect: vi.fn()
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	getAuthToken: () => auth.token,
	refreshToken: auth.refreshToken,
	disconnect: auth.disconnect
}));

vi.mock('./config', () => ({ apiOrigin: () => 'https://api.test' }));

interface Seen {
	url: string;
	method: string;
	authorization: string | null;
	retry: string | null;
	body: string;
}

describe('api auth middleware', () => {
	let seen: Seen[];

	beforeEach(() => {
		vi.resetModules();
		auth.token = 'old-token';
		auth.refreshToken.mockClear();
		auth.disconnect.mockClear();
		seen = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: Request) => {
				const body = await input.text();
				seen.push({
					url: input.url,
					method: input.method,
					authorization: input.headers.get('Authorization'),
					retry: input.headers.get('x-auth-retry'),
					body
				});
				if (seen.length === 1) {
					return new Response(JSON.stringify({ message: 'expired' }), {
						status: 401,
						headers: { 'Content-Type': 'application/json' }
					});
				}
				auth.token = 'new-token';
				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('retries a POST with a JSON body once, with the same body, after a 401 and a refresh', async () => {
		const { api } = await import('./client');
		const body = { address: 'Managed111', chain: 'SOL' };
		const { data, error, response } = await api.POST('/v2/referral/withdraw' as never, { body } as never);

		expect(error).toBeUndefined();
		expect(response.status).toBe(200);
		expect(data).toEqual({ ok: true });
		expect(auth.refreshToken).toHaveBeenCalledTimes(1);
		expect(auth.disconnect).not.toHaveBeenCalled();
		expect(seen).toHaveLength(2);
		expect(seen[0]).toMatchObject({ method: 'POST', authorization: 'Bearer old-token', retry: null });
		expect(seen[1]).toMatchObject({ method: 'POST', authorization: 'Bearer new-token', retry: '1' });
		expect(seen[1].url).toBe(seen[0].url);
		expect(JSON.parse(seen[0].body)).toEqual(body);
		expect(seen[1].body).toBe(seen[0].body);
	});

	it('retries a GET without a body after a 401 and a refresh', async () => {
		const { api } = await import('./client');
		const { response } = await api.GET('/v2/referral/code');
		expect(response.status).toBe(200);
		expect(seen).toHaveLength(2);
		expect(seen[1]).toMatchObject({ method: 'GET', authorization: 'Bearer new-token', retry: '1', body: '' });
	});

	it('does not retry when the refresh fails', async () => {
		auth.refreshToken.mockResolvedValueOnce(null as never);
		const { api } = await import('./client');
		const { response } = await api.POST('/v2/referral/cashback' as never, { body: { address: 'a', chain: 'SOL' } } as never);
		expect(response.status).toBe(401);
		expect(seen).toHaveLength(1);
	});
});
