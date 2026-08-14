import { describe, expect, test } from 'vitest';
import { calculateTradeFees } from './utils/trade-fees';

describe('live trade fees', () => {
	test('uses exact WebSocket fee strings when rounded numeric companions are zero', () => {
		const result = calculateTradeFees({
			fees: {
				gasFeeUsd: 0,
				gasFeeUsdStr: '0.0000125',
				mevFeeUsd: 0,
				mevFeeUsdStr: '0.00025',
				platformFeeUsd: 0,
				platformFeeUsdStr: '0.3797553895',
				creatorFeeUsd: 0,
				creatorFeeUsdStr: '0',
				cashbackUsd: 0,
				cashbackUsdStr: '0',
				totalFeeUsd: 0,
				totalFeeUsdStr: '0.3800178895',
				netFeeUsd: 0,
				netFeeUsdStr: '0'
			}
		});

		expect(result.gas).toBe(0.0000125);
		expect(result.mev).toBe(0.00025);
		expect(result.platform).toBe(0.3797553895);
		expect(result.total).toBe(0.3800178895);
		expect(result.net).toBe(0.3800178895);
	});

	test('keeps gross fees visible when cashback makes the net fee negative', () => {
		const result = calculateTradeFees({
			fees: {
				gasFeeUsdStr: '0.01',
				platformFeeUsdStr: '0.02',
				cashbackUsdStr: '0.05',
				totalFeeUsdStr: '0.03',
				netFeeUsdStr: '-0.02'
			}
		});

		expect(result.total).toBe(0.03);
		expect(result.net).toBe(-0.02);
	});

	test('falls back safely when an old publisher omits fee metadata', () => {
		expect(calculateTradeFees({ fees: undefined })).toEqual({
			gas: 0,
			mev: 0,
			platform: 0,
			creator: 0,
			cashback: 0,
			total: 0,
			net: 0
		});
	});
});
