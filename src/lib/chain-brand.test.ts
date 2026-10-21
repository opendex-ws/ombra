import { describe, expect, it } from 'vitest';
import { chainBrandArt, chainDisplayName } from '$lib/utils/chain-brand';

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

describe('chainDisplayName', () => {
	it('uses the full name for Solana and Robinhood', () => {
		expect(chainDisplayName('SOL')).toBe('Solana');
		expect(chainDisplayName('sol')).toBe('Solana');
		expect(chainDisplayName('RH')).toBe('Robinhood');
		expect(chainDisplayName('rh')).toBe('Robinhood');
	});

	it('keeps an unknown code so the caption is not blank', () => {
		expect(chainDisplayName('ETH')).toBe('ETH');
		expect(chainDisplayName('')).toBe('');
		expect(chainDisplayName(null)).toBe('');
	});
});
