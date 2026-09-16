import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ScannerItem } from '$lib/api/types';
import MemescopeCard from './components/MemescopeCard.svelte';
import TokenRow from './components/TokenRow.svelte';

vi.mock('$lib/stores/auth.svelte', () => ({ getIsLoggedIn: () => false }));
vi.mock('$lib/stores/settings.svelte', () => ({
	getFavourites: () => [],
	addFavourite: vi.fn(),
	removeFavourite: vi.fn()
}));

afterEach(cleanup);

function tf() {
	return { priceChangePct: 0, volume: 0, volumeStr: '0', buys: 0, sells: 0 };
}

function item(isHolderReward: boolean): ScannerItem {
	return {
		chain: 'SOL',
		tokenAddress: 'Token1111111111111111111111111111111111111',
		tokenSymbol: 'HR',
		tokenName: 'Holder',
		pairAddress: 'Pair11111111111111111111111111111111111111',
		platformType: 'PUMPFUN',
		createdAtTimestampStr: '2026-01-01T00:00:00Z',
		calls: 0,
		theses: 0,
		sparkline: [],
		quote: {
			priceUsd: 1,
			marketCapUsd: 1,
			liquidityUsd: 1,
			priceUsdStr: '1',
			marketCapUsdStr: '1',
			liquidityUsdStr: '1',
			priceNativeStr: '1',
			liquidityNativeStr: '1',
			fullyDilutedValueStr: '1',
			marketCapInitialUsdStr: '1'
		},
		stats: {
			total: { volume: 0, volumeStr: '0' },
			timeframes: { '5m': tf(), '1h': tf(), '6h': tf(), '24h': tf() }
		},
		audit: { mintable: false, freezable: false, honeypot: false },
		holders: { holderCount: 0, snipers: 0, bundlers: 0, insiders: 0 },
		launchPad: {
			pumpfun: {
				cashbackPct: 0,
				isAgent: false,
				isBoost: false,
				isMayhem: false,
				isHolderReward
			}
		}
	} as unknown as ScannerItem;
}

describe('holder rewards badge', () => {
	test('MemescopeCard shows Holder rewards when isHolderReward is true', () => {
		render(MemescopeCard, { props: { token: item(true) } });
		expect(screen.getByTitle('Holder rewards')).toBeInTheDocument();
	});

	test('MemescopeCard hides Holder rewards when isHolderReward is false', () => {
		render(MemescopeCard, { props: { token: item(false) } });
		expect(screen.queryByTitle('Holder rewards')).toBeNull();
	});

	test('TokenRow shows Holder rewards when isHolderReward is true', () => {
		render(TokenRow, { props: { token: item(true), compact: true } });
		expect(screen.getByTitle('Holder rewards')).toBeInTheDocument();
	});

	test('TokenRow hides Holder rewards when isHolderReward is false', () => {
		render(TokenRow, { props: { token: item(false), compact: true } });
		expect(screen.queryByTitle('Holder rewards')).toBeNull();
	});
});
