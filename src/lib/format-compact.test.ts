import { describe, expect, it } from 'vitest';
import { formatCompactNumber, formatCompactCount } from '$lib/utils/format';

describe('formatCompactNumber', () => {
	it('does not pad whole numbers with decimals', () => {
		// 1 call rendered as "1.00" was the reported bug
		expect(formatCompactNumber(1)).toBe('1');
		expect(formatCompactNumber(3)).toBe('3');
		expect(formatCompactNumber(12)).toBe('12');
		expect(formatCompactNumber(1000)).toBe('1K');
		expect(formatCompactNumber(2_000_000)).toBe('2M');
	});

	it('keeps meaningful decimals', () => {
		expect(formatCompactNumber(1.25)).toBe('1.25');
		expect(formatCompactNumber(4200)).toBe('4.2K');
		expect(formatCompactNumber(1_500_000)).toBe('1.5M');
		expect(formatCompactNumber(1_230_000_000)).toBe('1.23B');
	});

	it('keeps sub-1 precision without trailing padding', () => {
		expect(formatCompactNumber(0.5)).toBe('0.5');
		expect(formatCompactNumber(0.1234)).toBe('0.1234');
	});

	it('handles sign, strings and junk', () => {
		expect(formatCompactNumber(-4200)).toBe('-4.2K');
		expect(formatCompactNumber('2500')).toBe('2.5K');
		expect(formatCompactNumber(null)).toBe('0');
		expect(formatCompactNumber('abc')).toBe('0');
		expect(formatCompactNumber(0)).toBe('0');
	});
});

describe('formatCompactCount', () => {
	it('stays whole, as counts always were', () => {
		expect(formatCompactCount(1)).toBe('1');
		expect(formatCompactCount(4200)).toBe('4K');
	});
});
