import { describe, expect, it } from 'vitest';
import type { TokenMarketPumpfun } from '$lib/api/types';
import {
	feeShareLabel,
	feeShareName,
	feeSharePctLabel,
	feeShareSocialUrl,
	feeShareTitle,
	feeShareholders
} from './utils/fee-sharing';

const socialPumpfun: TokenMarketPumpfun = {
	cashbackPct: 0,
	isAgent: false,
	isBoost: false,
	isMayhem: false,
	isHolderReward: false,
	feeSharing: {
		address: 'HsBdhP8ufWJWw1XwENgbqWn9SLonx6gGnm5EP1pSvwtC',
		shareholders: [
			{
				address: 'CXhT72esjHYBZVWoqyL9N5qie7HXkEPUKfrX96GXDrAa',
				shareBps: 10000,
				kind: 'social',
				social: { username: 'Synxneuos' }
			}
		]
	}
};

describe('feeShareholders', () => {
	it('reads destinations from pumpfun.feeSharing', () => {
		const shares = feeShareholders(socialPumpfun);
		expect(shares).toHaveLength(1);
		expect(feeShareName(shares[0])).toBe('@Synxneuos');
		expect(feeSharePctLabel(shares[0])).toBe('100%');
		expect(feeShareLabel(shares[0])).toBe('100% @Synxneuos');
		expect(feeShareSocialUrl(shares[0])).toBe('https://x.com/Synxneuos');
		expect(feeShareTitle(shares)).toContain('@Synxneuos');
	});

	it('labels wallet and donation destinations', () => {
		const shares = feeShareholders({
			cashbackPct: 0,
			isAgent: false,
			isBoost: false,
			isMayhem: false,
			isHolderReward: false,
			feeSharing: {
				address: 'pda',
				shareholders: [
					{ address: 'CXhT72esjHYBZVWoqyL9N5qie7HXkEPUKfrX96GXDrAa', shareBps: 5000, kind: 'wallet' },
					{
						address: 'Donate1111111111111111111111111111111111111',
						shareBps: 2500,
						kind: 'donation',
						donation: { charities: [{ name: 'Water.org' }] }
					}
				]
			}
		});
		expect(feeShareLabel(shares[0])).toBe('50% CXhT72...DrAa');
		expect(feeShareLabel(shares[1])).toBe('25% Water.org');
		expect(feeShareSocialUrl(shares[0])).toBeUndefined();
	});

	it('returns empty when missing', () => {
		expect(feeShareholders(null)).toEqual([]);
		expect(feeShareholders(undefined)).toEqual([]);
		expect(
			feeShareholders({ cashbackPct: 0, isAgent: false, isBoost: false, isMayhem: false, isHolderReward: false })
		).toEqual([]);
	});
});
