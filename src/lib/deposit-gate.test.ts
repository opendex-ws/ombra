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
				chain: 'BASE',
				buyWith: 'NATIVE',
				native: { ...eth, valueUsd: 1 },
				fiat: { ...usdg, valueUsd: 50, isFiat: true }
			})
		).toBe('NATIVE');
	});
});

const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const sol = asset({ symbol: 'SOL', address: 'So11111111111111111111111111111111111111112', isNative: true });
const usdc = asset({ symbol: 'USDC', address: SOL_USDC });

describe('Solana deposit gate', () => {
	it('asks for USDC or SOL when both balances are empty', () => {
		expect(depositAssetLabel('SOL', 'SOL')).toBe('USDC or SOL');
		expect(needsTradeDeposit({ chain: 'SOL', hasSelectedBalance: false, native: sol, fiat: usdc })).toBe(true);
	});

	it('opens the form with 0 SOL when USDC is held and Buy With is SOL', () => {
		const held = { ...usdc, isFiat: true, valueUsd: 20, tokensBalanceStr: '20', tokensBalance: 20 };
		expect(needsTradeDeposit({ chain: 'SOL', hasSelectedBalance: false, native: sol, fiat: held })).toBe(false);
		expect(fundingChoice({ chain: 'SOL', buyWith: 'NATIVE', native: sol, fiat: held })).toBe('FIAT');
	});

	it('finds USDC by mint when isFiat is unset, and only that mint', () => {
		const held = { ...usdc, valueUsd: 20, tokensBalanceStr: '20', tokensBalance: 20 };
		expect(findFiatAsset('SOL', [sol, held])?.token.address).toBe(SOL_USDC);
		expect(findFiatAsset('SOL', [sol, { ...held, token: { symbol: 'USDC', address: SOL_USDC.toLowerCase() } }])).toBeNull();
		expect(findFiatAsset('SOL', [usdg])).toBeNull();
	});

	it('prefers the isFiat flag over the mint fallback', () => {
		const flagged = { ...usdc, isFiat: true };
		expect(findFiatAsset('SOL', [sol, flagged])).toBe(flagged);
	});

	it('spends SOL when it is worth more than USDC', () => {
		expect(
			fundingChoice({
				chain: 'SOL',
				buyWith: 'FIAT',
				native: { ...sol, valueUsd: 30, tokensBalanceStr: '0.2', tokensBalance: 0.2 },
				fiat: { ...usdc, isFiat: true, valueUsd: 5, tokensBalanceStr: '5', tokensBalance: 5 }
			})
		).toBe('NATIVE');
	});

	it('keeps Buy With when SOL and USDC are worth the same', () => {
		const native = { ...sol, valueUsd: 10, tokensBalanceStr: '0.07', tokensBalance: 0.07 };
		const fiat = { ...usdc, isFiat: true, valueUsd: 10, tokensBalanceStr: '10', tokensBalance: 10 };
		expect(fundingChoice({ chain: 'SOL', buyWith: 'NATIVE', native, fiat })).toBe('NATIVE');
		expect(fundingChoice({ chain: 'SOL', buyWith: 'FIAT', native, fiat })).toBe('FIAT');
	});
});

describe('other chains', () => {
	it('keeps the selected Buy With pot and its symbol', () => {
		expect(depositAssetLabel('BASE', 'ETH')).toBe('ETH');
		expect(findFiatAsset('BASE', [usdg])).toBeNull();
		expect(
			fundingChoice({
				chain: 'BASE',
				buyWith: 'NATIVE',
				native: eth,
				fiat: { ...usdg, isFiat: true, valueUsd: 10, tokensBalanceStr: '10', tokensBalance: 10 }
			})
		).toBe('NATIVE');
		expect(
			needsTradeDeposit({
				chain: 'BASE',
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
