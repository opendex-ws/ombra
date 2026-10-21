import { afterEach, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/api/config', () => ({
	API_BASE: 'https://backend.example',
	API_PROXY: true
}));

import { handle } from './hooks.server';

afterEach(() => vi.unstubAllGlobals());

it('preserves a proxied WebSocket upgrade and its socket', async () => {
	const upgrade = { status: 101, webSocket: {} } as unknown as Response;
	vi.stubGlobal('fetch', vi.fn(async () => upgrade));
	const request = new Request('http://localhost:4173/v2/ws', {
		headers: { Upgrade: 'websocket' }
	});
	const result = await handle({
		event: { url: new URL(request.url), request },
		resolve: vi.fn()
	} as unknown as Parameters<typeof handle>[0]);
	expect(result).toBe(upgrade);
});
