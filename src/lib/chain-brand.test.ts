import { describe, expect, it } from 'vitest';
import { chainBrandArt } from '$lib/utils/chain-brand';

describe('chainBrandArt', () => {
	it('returns brand art for the supported chains', () => {
		expect(chainBrandArt('SOL')).toBe('/icons/sol.png');
		expect(chainBrandArt('RH')).toBe('/icons/rh.webp');
	});

	it('is case-insensitive, since chain casing varies by payload', () => {
		expect(chainBrandArt('sol')).toBe('/icons/sol.png');
	});

	it('returns null for an unknown chain so callers fall back to the mono mark', () => {
		expect(chainBrandArt('ETH')).toBeNull();
		expect(chainBrandArt('')).toBeNull();
		expect(chainBrandArt(null)).toBeNull();
		expect(chainBrandArt(undefined)).toBeNull();
	});
});
