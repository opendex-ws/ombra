import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	GET: vi.fn(),
	POST: vi.fn()
}));

vi.mock('$lib/api/client', () => ({ api: { GET: mocks.GET, POST: mocks.POST } }));
vi.mock('$lib/stores/auth.svelte', () => ({ getIsLoggedIn: () => true }));
vi.mock('$lib/ws/client', () => ({ subscribe: vi.fn(() => 'key'), unsubscribe: vi.fn() }));

import {
	dismissTrade,
	fetchActiveTrades,
	getActiveTrades,
	handleTradeUpdate,
	handleTradesSnapshot
} from './trade.svelte';

// Trade 367928 (RH, 2026-11-07): the cancel succeeded but the row stayed
// until a reload because no WS removal frame reached the page.
const TRADE = {
	id: 367928,
	status: 'ACTIVE',
	chain: 'RH',
	tokenAddress: '0x142611866CEe9F82AC39427E8C9f3E874bb66B08'
};
const OTHER = { ...TRADE, id: 325932, tokenAddress: '0x0000000000000000000000000000000000000001' };

describe('dismissTrade', () => {
	beforeEach(() => {
		mocks.GET.mockReset();
		mocks.POST.mockReset();
		mocks.GET.mockResolvedValue({ data: { trades: [TRADE, OTHER], totalActiveCount: 2 } });
	});

	it('drops the row once the cancel succeeds, without a WS removal frame', async () => {
		await fetchActiveTrades();
		expect(getActiveTrades().map((t) => t.id)).toEqual([367928, 325932]);
		mocks.POST.mockResolvedValue({ data: {}, error: undefined });

		await dismissTrade(367928);

		expect(mocks.POST).toHaveBeenCalledWith('/v2/trade/{chain}/{token}/cancel', {
			params: { path: { chain: 'RH', token: TRADE.tokenAddress } },
			body: { tradeId: 367928 }
		});
		expect(getActiveTrades().map((t) => t.id)).toEqual([325932]);

		// A late ACTIVE frame or an active-list snapshot must not restore it.
		handleTradeUpdate('USER_TRADE_UPDATE', { trade: { ...TRADE } });
		handleTradesSnapshot('trades:active', { trades: [TRADE, OTHER] });
		expect(getActiveTrades().map((t) => t.id)).toEqual([325932]);
	});

	it('keeps the row when the cancel fails', async () => {
		mocks.GET.mockResolvedValue({ data: { trades: [OTHER], totalActiveCount: 1 } });
		await fetchActiveTrades();
		mocks.POST.mockResolvedValue({ data: undefined, error: { message: 'nope' } });

		await dismissTrade(325932);

		expect(getActiveTrades().map((t) => t.id)).toEqual([325932]);
	});
});
