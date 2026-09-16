import { describe, expect, it } from 'vitest';

/**
 * Mirrors matchesFilters() in ThesisFeedPanel. The backend echoes the canonical
 * filter suffix on the subscribe ACK but publishes frames on the bare topic, so
 * a token-scoped subscription is handed every thesis. These guards keep the live
 * rows consistent with the REST seed and the filter UI.
 */
function matchesFilters(
	item: {
		chain: string;
		token: { address: string };
		source: string | null;
		labels: { label: string }[];
		marketcapUsd: string | null;
	},
	f: {
		chain?: string;
		tokenAddress?: string;
		sources?: Set<string>;
		labels?: Set<string>;
		minMarketcapUsd?: string;
	}
) {
	if (f.tokenAddress && item.token.address !== f.tokenAddress) return false;
	if (f.chain && item.chain !== f.chain) return false;
	if (f.sources?.size && !(item.source && f.sources.has(item.source))) return false;
	if (f.labels?.size) {
		const wanted = [...f.labels].map((l) => l.toLowerCase());
		if (!item.labels.some((l) => wanted.includes(l.label.toLowerCase()))) return false;
	}
	const floor = Number(f.minMarketcapUsd);
	if (f.minMarketcapUsd?.trim() && Number.isFinite(floor) && floor > 0) {
		const mc = Number(item.marketcapUsd ?? 0);
		if (!Number.isFinite(mc) || mc < floor) return false;
	}
	return true;
}

const item = {
	chain: 'SOL',
	token: { address: 'TOKEN_A' },
	source: 'PUMPFUN' as string | null,
	labels: [{ label: 'KOL' }],
	marketcapUsd: '5000'
};

describe('thesis live-frame filters', () => {
	it('drops another token when scoped, which is the popover bug', () => {
		expect(matchesFilters(item, { tokenAddress: 'TOKEN_A' })).toBe(true);
		expect(matchesFilters(item, { tokenAddress: 'TOKEN_B' })).toBe(false);
	});

	it('applies the market cap floor to live rows', () => {
		expect(matchesFilters(item, { minMarketcapUsd: '1000' })).toBe(true);
		expect(matchesFilters(item, { minMarketcapUsd: '10000' })).toBe(false);
		// blank and junk must not filter everything out
		expect(matchesFilters(item, { minMarketcapUsd: '  ' })).toBe(true);
		expect(matchesFilters(item, { minMarketcapUsd: 'abc' })).toBe(true);
	});

	it('matches labels case-insensitively, as the server does', () => {
		expect(matchesFilters(item, { labels: new Set(['kol']) })).toBe(true);
		expect(matchesFilters(item, { labels: new Set(['whale']) })).toBe(false);
	});

	it('filters by source and chain', () => {
		expect(matchesFilters(item, { sources: new Set(['PUMPFUN']) })).toBe(true);
		expect(matchesFilters(item, { sources: new Set(['FOMO']) })).toBe(false);
		expect(matchesFilters({ ...item, source: 'FOMO' }, { sources: new Set(['FOMO']) })).toBe(true);
		expect(matchesFilters({ ...item, source: null }, { sources: new Set(['PUMPFUN']) })).toBe(false);
		expect(matchesFilters(item, { chain: 'SOL' })).toBe(true);
	});

	it('passes everything through when unfiltered', () => {
		expect(matchesFilters(item, {})).toBe(true);
	});
});
