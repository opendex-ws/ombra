import { describe, expect, it } from 'vitest';

/**
 * Mirrors the reload guard in ThesisFeedPanel. The panel's `tokenAddress` prop is
 * read from a parent object that is replaced on every price/stats frame, so the
 * effect re-fires with identical values many times a second. Only a value-keyed
 * guard stops that becoming a request per frame.
 */
function loadKeyOf(f: {
	chain: string;
	tokenAddress: string;
	feedMode: string;
	sources: string[];
	minMarketcapUsd: string;
	wallets: string[];
}) {
	return JSON.stringify([
		f.chain,
		f.tokenAddress,
		f.feedMode,
		[...f.sources].sort(),
		f.minMarketcapUsd.trim(),
		f.wallets
	]);
}

const base = {
	chain: 'SOL',
	tokenAddress: 'ECcsXjJpdhB1pdX3SK9yc6k5a2UrScaY3LKc7q6Tpump',
	feedMode: 'all',
	sources: [] as string[],
	minMarketcapUsd: '',
	wallets: [] as string[]
};

describe('thesis reload key', () => {
	it('is stable across identical re-renders', () => {
		let key = '';
		let loads = 0;
		for (let frame = 0; frame < 500; frame++) {
			const next = loadKeyOf({ ...base });
			if (next !== key) {
				key = next;
				loads++;
			}
		}
		expect(loads).toBe(1);
	});

	it('reloads when a filter actually changes', () => {
		expect(loadKeyOf(base)).not.toBe(loadKeyOf({ ...base, feedMode: 'mine' }));
		expect(loadKeyOf(base)).not.toBe(loadKeyOf({ ...base, minMarketcapUsd: '1000' }));
		expect(loadKeyOf(base)).not.toBe(loadKeyOf({ ...base, wallets: ['abc'] }));
		expect(loadKeyOf(base)).not.toBe(loadKeyOf({ ...base, chain: 'SOL2' }));
		expect(loadKeyOf(base)).not.toBe(loadKeyOf({ ...base, tokenAddress: 'other' }));
	});

	it('ignores source ordering and whitespace, which do not change the query', () => {
		expect(loadKeyOf({ ...base, sources: ['PUMPFUN', 'FOMO'] })).toBe(
			loadKeyOf({ ...base, sources: ['FOMO', 'PUMPFUN'] })
		);
		expect(loadKeyOf({ ...base, sources: ['FOMO'] })).not.toBe(loadKeyOf(base));
		expect(loadKeyOf({ ...base, minMarketcapUsd: ' ' })).toBe(loadKeyOf(base));
	});
});
