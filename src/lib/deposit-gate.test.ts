import { describe, expect, it } from 'vitest';
import { assetPresent, depositAssetLabel, findFiatAsset, fundingChoice, needsTradeDeposit, type DepositAsset } from '$lib/utils/deposit-gate';

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

function asset(partial: Partial<DepositAsset> & { symbol: string; address: string }): DepositAsset {
	return {
		isFiat: false,
		isNative: false,
		valueUsd: 0,
		tokensBalance: 0,
		tokensBalanceStr: '0',
		token: { symbol: partial.symbol, address: partial.address },
		...partial
	};
}

const eth = asset({
	symbol: 'ETH',
	address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
	isNative: true
});
const usdg = asset({ symbol: 'USDG', address: USDG });

describe('Robinhood deposit gate', () => {
	it('asks for USDG or ETH when both balances are empty', () => {
		expect(depositAssetLabel('RH', 'ETH')).toBe('USDG or ETH');
		expect(
			needsTradeDeposit({
				chain: 'RH',
				hasSelectedBalance: false,
				native: eth,
				fiat: usdg
			})
		).toBe(true);
	});

	it('opens the form when only USDG is held and isFiat is unset', () => {
		const held = { ...usdg, tokensBalanceStr: '25', tokensBalance: 25, valueUsd: 25 };
		expect(findFiatAsset('RH', [eth, held])?.token.symbol).toBe('USDG');
		expect(
			needsTradeDeposit({
				chain: 'RH',
				hasSelectedBalance: false,
				native: eth,
				fiat: findFiatAsset('RH', [eth, held])
			})
		).toBe(false);
	});

	it('opens the form when only ETH is held', () => {
		const held = { ...eth, valueUsd: 4, tokensBalanceStr: '0.002', tokensBalance: 0.002 };
		expect(assetPresent(held)).toBe(true);
		expect(
			needsTradeDeposit({
				chain: 'RH',
				hasSelectedBalance: true,
				native: held,
				fiat: usdg
			})
		).toBe(false);
	});

	it('treats a zero-priced token amount as present', () => {
		const held = { ...usdg, tokensBalanceStr: '1.5', tokensBalance: 1.5, valueUsd: 0 };
		expect(assetPresent(held)).toBe(true);
	});
});

describe('Robinhood funding choice', () => {
	it('shows USDG when it is worth more than ETH', () => {
		expect(
			fundingChoice({
				chain: 'RH',
				buyWith: 'NATIVE',
				native: { ...eth, valueUsd: 2 },
				fiat: { ...usdg, valueUsd: 12, tokensBalanceStr: '12', tokensBalance: 12 }
			})
		).toBe('FIAT');
	});

	it('shows ETH when it is worth more than USDG', () => {
		expect(
			fundingChoice({
				chain: 'RH',
				buyWith: 'FIAT',
				native: { ...eth, valueUsd: 8, tokensBalanceStr: '0.003', tokensBalance: 0.003 },
				fiat: { ...usdg, valueUsd: 3, tokensBalanceStr: '3', tokensBalance: 3 }
			})
		).toBe('NATIVE');
	});

	it('shows USDG when ETH is empty and USDG has tokens but no price', () => {
		expect(
			fundingChoice({
				chain: 'RH',
				buyWith: 'NATIVE',
				native: eth,
				fiat: { ...usdg, tokensBalanceStr: '25', tokensBalance: 25 }
			})
		).toBe('FIAT');
	});

	it('keeps Buy With when ETH and USDG are worth the same', () => {
		expect(
			fundingChoice({
				chain: 'RH',
				buyWith: 'NATIVE',
				native: { ...eth, valueUsd: 10, tokensBalanceStr: '0.004', tokensBalance: 0.004 },
				fiat: { ...usdg, valueUsd: 10, tokensBalanceStr: '10', tokensBalance: 10 }
			})
		).toBe('NATIVE');
		expect(
			fundingChoice({
				chain: 'SOL',
				buyWith: 'NATIVE',
				native: { ...eth, valueUsd: 1 },
				fiat: { ...usdg, valueUsd: 50, isFiat: true }
			})
		).toBe('NATIVE');
	});
});

describe('other chains', () => {
	it('keeps the selected Buy With pot and its symbol', () => {
		expect(depositAssetLabel('SOL', 'SOL')).toBe('SOL');
		expect(findFiatAsset('SOL', [usdg])).toBeNull();
		expect(
			needsTradeDeposit({
				chain: 'SOL',
				hasSelectedBalance: false,
				native: null,
				fiat: { ...usdg, isFiat: true, valueUsd: 10, tokensBalanceStr: '10', tokensBalance: 10 }
			})
		).toBe(true);
		expect(
			needsTradeDeposit({
				chain: 'ETH',
				hasSelectedBalance: true,
				native: eth,
				fiat: null
			})
		).toBe(false);
	});
});
