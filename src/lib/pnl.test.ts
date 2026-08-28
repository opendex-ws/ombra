import { describe, expect, test } from 'vitest';
import { decimalToNumber, isNetProfit, netPnlMultiplier, netPnlPct, netPnlUsd } from './utils/pnl';

// Real payload from trade 162048: gross pnl 4.3437 with 0.47539 of fees.
const trade = {
	pnl: { usd: 4.3437, native: 0.042948523999, pct: 43.43, multiplier: 1.4343 },
	totalFees: { usd: { source: '0.475390', parsedValue: 0.47539 }, native: { source: '0.004707022000', parsedValue: 0.004707022 } },
	totalBought: { usd: 9.9999 }
};

describe('net pnl', () => {
	test('reads the exact-decimal wrapper the API sometimes sends', () => {
		expect(decimalToNumber({ source: '0.475390', parsedValue: 0.47539 })).toBe(0.47539);
		expect(decimalToNumber('1.25')).toBe(1.25);
		expect(decimalToNumber(3)).toBe(3);
		expect(decimalToNumber(undefined)).toBe(0);
		expect(decimalToNumber(Number.NaN)).toBe(0);
	});

	test('subtracts fees from the gross figures', () => {
		expect(netPnlUsd(trade)).toBeCloseTo(3.86831, 5);
		expect(netPnlPct(trade)).toBeCloseTo(38.68, 2);
		expect(netPnlMultiplier(trade)).toBeCloseTo(1.3868, 4);
		expect(isNetProfit(trade)).toBe(true);
	});

	test('a wrapper-shaped fee cannot poison the arithmetic into NaN', () => {
		expect(Number.isFinite(netPnlUsd(trade))).toBe(true);
		expect(Number.isFinite(netPnlPct(trade))).toBe(true);
	});

	test('fees can flip a gross gain into a net loss', () => {
		const t = { pnl: { usd: 0.2, native: 0, pct: 2, multiplier: 1.02 }, totalFees: { usd: 0.5 }, totalBought: { usd: 10 } };
		expect(netPnlUsd(t)).toBeCloseTo(-0.3, 5);
		expect(isNetProfit(t)).toBe(false);
	});

	test('falls back to gross figures with no cost basis', () => {
		const t = { pnl: { usd: 1, native: 0, pct: 12, multiplier: 1.12 }, totalFees: { usd: 0 }, totalBought: { usd: 0 } };
		expect(netPnlPct(t)).toBe(12);
		expect(netPnlMultiplier(t)).toBe(1.12);
	});
});
