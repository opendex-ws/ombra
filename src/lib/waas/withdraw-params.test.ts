// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { WalletAsset } from '$lib/api/types';
import {
	effectiveWithdrawAmount,
	fromBaseUnits,
	maxWithdrawAmount,
	solTransferLamports,
	toBaseUnits
} from './withdraw-params';

function asset(balance: string, native = true, decimals = 9): WalletAsset {
	return {
		isFiat: !native,
		isNative: native,
		priceUsd: 1,
		priceUsdStr: '1',
		token: {
			address: native ? 'So11111111111111111111111111111111111111112' : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
			chain: 'SOL',
			decimals,
			name: native ? 'Solana' : 'USD Coin',
			symbol: native ? 'SOL' : 'USDC'
		},
		tokensBalance: Number(balance),
		tokensBalanceStr: balance,
		valueUsd: 0,
		valueUsdStr: '0'
	} as WalletAsset;
}

describe('native SOL withdrawal amount (mirrors backend owner_paid_native_amount)', () => {
	it('matches the backend unit tests', () => {
		expect(solTransferLamports(1_000_000n, 110_000n)).toBe(995_000n);
		expect(solTransferLamports(2_000_000n, 1_000_000n)).toBe(1_000_000n);
		expect(solTransferLamports(1_000_000n, 1_000_000n)).toBe(995_000n);
		expect(solTransferLamports(1_000_000n, 1_000_001n)).toBeNull();
		expect(solTransferLamports(1_000_000n, 0n)).toBeNull();
	});

	it('falls back to the sponsored rule when the balance cannot pay the fee', () => {
		expect(solTransferLamports(5_000n, 1_000n)).toBe(5_000n);
		expect(solTransferLamports(4_000n, 4_000n)).toBe(4_000n);
	});

	it('Max keeps the 5000-lamport fee back', () => {
		expect(maxWithdrawAmount('SOL', asset('1.5'))).toBe('1.499995');
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '1.499995')).toEqual({ amount: '1.499995', adjusted: false });
	});

	it('Max is an amount the backend sends unchanged', () => {
		expect(maxWithdrawAmount('SOL', asset('1.5'))).toBe('1.499995');
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '1.499995')).toEqual({ amount: '1.499995', adjusted: false });
		expect(toBaseUnits('1.499995', 9)).toBe('1499995000');
	});

	it('snaps the full balance or a near-max amount that leaves rent dust to Max', () => {
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '1.5')).toEqual({ amount: '1.499995', adjusted: true });
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '1.4995')).toEqual({ amount: '1.499995', adjusted: true });
		// remaining after fee = 890_879 lamports, just below the rent minimum
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '1.499104121')).toEqual({ amount: '1.499995', adjusted: true });
	});

	it('leaves a normal amount alone', () => {
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '0.5')).toEqual({ amount: '0.5', adjusted: false });
		// remaining after fee = exactly the rent minimum: kept
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '1.49910412')).toEqual({ amount: '1.49910412', adjusted: false });
	});

	it('leaves amounts the backend rejects anyway for the existing errors', () => {
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), '2')).toEqual({ amount: '2', adjusted: false });
		expect(effectiveWithdrawAmount('SOL', asset('1.5'), 'abc')).toEqual({ amount: 'abc', adjusted: false });
	});

	it('never touches tokens or EVM native', () => {
		expect(maxWithdrawAmount('SOL', asset('12.5', false, 6))).toBe('12.5');
		expect(effectiveWithdrawAmount('SOL', asset('12.5', false, 6), '12.5')).toEqual({ amount: '12.5', adjusted: false });
		expect(maxWithdrawAmount('ETH', asset('1', true, 18))).toBe('1');
		expect(effectiveWithdrawAmount('ETH', asset('1', true, 18), '1')).toEqual({ amount: '1', adjusted: false });
	});

	it('formats base units without trailing zeros', () => {
		expect(fromBaseUnits(1_499_995_000n, 9)).toBe('1.499995');
		expect(fromBaseUnits(5_000n, 9)).toBe('0.000005');
		expect(fromBaseUnits(2_000_000_000n, 9)).toBe('2');
		expect(fromBaseUnits(0n, 9)).toBe('0');
	});
});
