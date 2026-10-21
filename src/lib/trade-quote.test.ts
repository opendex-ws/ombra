import { describe, expect, it } from 'vitest';
import { buyQuoteQuery, noRouteMessage, routeStops, sellQuoteQuery, tokenLabel } from '$lib/utils/trade-quote';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'DioisRY2M15WKza2te7pCvEAe7B1EVp4N1ZrM6tn52Sp';

describe('buyQuoteQuery', () => {
	it('sends a native amount with its type', () => {
		expect(buyQuoteQuery({ amount: '0.1', usd: false, buyWith: 'NATIVE', slippagePct: null })).toEqual({
			side: 'BUY',
			amount: '0.1',
			amountType: 'NATIVE'
		});
	});

	it('sends USD amounts at cent precision', () => {
		expect(buyQuoteQuery({ amount: '25.129', usd: true, buyWith: 'NATIVE', slippagePct: null })?.amount).toBe('25.13');
	});

	it('passes FIAT funding and slippage only when set', () => {
		const q = buyQuoteQuery({ amount: '1', usd: false, buyWith: 'FIAT', slippagePct: 15 });
		expect(q?.currency).toBe('FIAT');
		expect(q?.slippagePct).toBe('15');
	});

	it('omits slippage for AUTO', () => {
		expect(buyQuoteQuery({ amount: '1', usd: false, buyWith: 'NATIVE', slippagePct: null })?.slippagePct).toBeUndefined();
	});

	it('is null for an empty, zero or invalid amount', () => {
		for (const amount of ['', '0', '-1', 'abc']) {
			expect(buyQuoteQuery({ amount, usd: false, buyWith: 'NATIVE', slippagePct: null })).toBeNull();
		}
	});

	it('never emits exponent notation', () => {
		expect(buyQuoteQuery({ amount: '0.000000001', usd: false, buyWith: 'NATIVE', slippagePct: null })?.amount).toBe('0.000000001');
	});
});

describe('sellQuoteQuery', () => {
	it('converts a percentage of the position into token units', () => {
		expect(sellQuoteQuery({ pct: 25, tokensRemaining: 1000, buyWith: 'NATIVE', slippagePct: null })).toEqual({
			side: 'SELL',
			amount: '250'
		});
	});

	it('is null when there is nothing to sell', () => {
		expect(sellQuoteQuery({ pct: 50, tokensRemaining: 0, buyWith: 'NATIVE', slippagePct: null })).toBeNull();
	});
});

describe('routeStops', () => {
	it('flattens legs into a token path with the venue of each hop', () => {
		const legs = [
			{ venue: 'RAYDIUM_V4', pool: 'p1', inputToken: SOL, outputToken: USDC, inputSymbol: 'SOL', outputSymbol: 'USDC' },
			{ venue: 'METEORA_DLMM', pool: 'p2', inputToken: USDC, outputToken: TOKEN, inputSymbol: 'USDC', outputSymbol: null }
		] as never;
		expect(routeStops({ legs, inputToken: SOL, outputToken: TOKEN })).toEqual([
			{ address: SOL, symbol: 'SOL', via: null },
			{ address: USDC, symbol: 'USDC', via: 'RAYDIUM_V4' },
			{ address: TOKEN, symbol: null, via: 'METEORA_DLMM' }
		]);
	});

	it('falls back to input and output with no legs', () => {
		expect(routeStops({ legs: [], inputToken: SOL, outputToken: TOKEN }).map((s) => s.address)).toEqual([SOL, TOKEN]);
	});
});

describe('labels', () => {
	it('names common mints, prefers known symbols, and shortens the rest', () => {
		expect(tokenLabel(SOL)).toBe('SOL');
		expect(tokenLabel(TOKEN, { [TOKEN]: 'HAMSTER' })).toBe('HAMSTER');
		expect(tokenLabel(TOKEN)).toBe('Dioi…52Sp');
		expect(tokenLabel({ address: TOKEN, symbol: 'HAM', via: null }, { [TOKEN]: 'HAMSTER' })).toBe('HAM');
	});

	it('explains 422 reasons', () => {
		expect(noRouteMessage('INSUFFICIENT_LIQUIDITY')).toBe('Not enough liquidity for this size');
		expect(noRouteMessage('SOMETHING_NEW')).toBe('No route available');
	});
});
