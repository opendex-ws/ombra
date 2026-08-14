import { afterEach, describe, expect, test, vi } from 'vitest';

const { subscribeMock, unsubscribeMock } = vi.hoisted(() => ({
	subscribeMock: vi.fn(),
	unsubscribeMock: vi.fn()
}));

vi.mock('$lib/ws/client', () => ({
	subscribe: subscribeMock,
	unsubscribe: unsubscribeMock
}));

import {
	getPegAgeMs,
	getPegLastUpdatedAt,
	startPegPrices,
	stopPegPrices
} from './stores/peg.svelte';

afterEach(() => {
	stopPegPrices();
	subscribeMock.mockReset();
	unsubscribeMock.mockReset();
	vi.useRealTimers();
});

describe('peg price store lifecycle', () => {
	test('refreshes only the chain whose source generation advances', () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		let handler: ((event: string, data: unknown) => void) | undefined;
		subscribeMock.mockImplementation((_topic: string, next: typeof handler) => {
			handler = next;
			return 'peg-subscription';
		});

		startPegPrices();
		startPegPrices();
		expect(subscribeMock).toHaveBeenCalledTimes(1);
		handler?.('PEG_PRICES', {
			prices: {
				SOL: { priceUsd: 180, priceUsdStr: '180', sourceGeneration: 1, sourceTimestampMs: 1_000_000 },
				ETH: { priceUsd: 2500, priceUsdStr: '2500', sourceGeneration: 1, sourceTimestampMs: 1_000_000 }
			}
		});
		const firstAcceptedAt = getPegLastUpdatedAt('SOL');
		expect(firstAcceptedAt).toBe(1_000_000);

		vi.setSystemTime(1_005_000);
		handler?.('PEG_PRICES', {
			prices: {
				SOL: { priceUsd: 180, priceUsdStr: '180', sourceGeneration: 1, sourceTimestampMs: 1_000_000 },
				ETH: { priceUsd: 2500, priceUsdStr: '2500', sourceGeneration: 2, sourceTimestampMs: 1_005_000 }
			}
		});
		expect(getPegLastUpdatedAt('SOL')).toBe(firstAcceptedAt);
		expect(getPegAgeMs('SOL')).toBe(5_000);
		expect(getPegLastUpdatedAt('ETH')).toBe(1_005_000);

		vi.setSystemTime(1_010_000);
		handler?.('PEG_PRICES', {
			prices: {
				SOL: { priceUsd: 180, priceUsdStr: '180', sourceGeneration: 2, sourceTimestampMs: 1_010_000 },
				ETH: { priceUsd: 2500, priceUsdStr: '2500', sourceGeneration: 2, sourceTimestampMs: 1_005_000 }
			}
		});
		expect(getPegLastUpdatedAt('SOL')).toBe(1_010_000);
		expect(getPegLastUpdatedAt('SOL')).not.toBe(firstAcceptedAt);
		expect(getPegAgeMs('SOL')).toBe(0);

		vi.setSystemTime(1_071_000);
		expect(getPegAgeMs('SOL')).toBe(61_000);

		vi.setSystemTime(1_072_000);
		handler?.('PEG_PRICES', {
			prices: {
				SOL: { priceUsd: 181, priceUsdStr: '181', sourceGeneration: 3, sourceTimestampMs: 1_072_000 },
				ETH: { priceUsd: 2500, priceUsdStr: '2500', sourceGeneration: 2, sourceTimestampMs: 1_005_000 }
			}
		});
		expect(getPegLastUpdatedAt('SOL')).toBe(1_072_000);

		stopPegPrices();
		expect(unsubscribeMock).toHaveBeenCalledWith('peg-subscription');
	});
});
