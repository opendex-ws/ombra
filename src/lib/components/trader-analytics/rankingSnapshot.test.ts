import { describe, expect, test } from 'vitest';
import type { TraderRankItem } from '$lib/api/types';
import {
	itemsMatchingSource,
	mergeLiveRanking,
	mergeTraderLabels,
	rankingSubscribeParams,
	snapshotMatchesSource
} from './rankingSnapshot';

function item(wallet: string, source?: 'FOMO' | 'PUMPFUN' | 'KOL', label?: string): TraderRankItem {
	return {
		chain: 'SOL',
		walletAddress: wallet,
		labels: source ? [{ source, label: label ?? wallet, photoId: source === 'FOMO' ? 'p1' : undefined }] : []
	} as TraderRankItem;
}

describe('snapshotMatchesSource', () => {
	test('All accepts unlabeled global rows', () => {
		expect(snapshotMatchesSource([item('a'), item('b')], '')).toBe(true);
	});

	test('FOMO rejects unlabeled All ranking', () => {
		expect(snapshotMatchesSource([item('a'), item('b')], 'FOMO')).toBe(false);
	});

	test('FOMO accepts only when every row carries FOMO', () => {
		expect(snapshotMatchesSource([item('a', 'FOMO', 'alice'), item('b', 'FOMO', 'bob')], 'FOMO')).toBe(true);
		expect(snapshotMatchesSource([item('a', 'FOMO', 'alice'), item('b')], 'FOMO')).toBe(false);
		expect(snapshotMatchesSource([item('a', 'PUMPFUN', 'pump')], 'FOMO')).toBe(false);
	});

	test('KOL rejects FOMO, Pump.fun, and unlabeled rows', () => {
		expect(snapshotMatchesSource([item('a', 'KOL', 'alice')], 'KOL')).toBe(true);
		expect(snapshotMatchesSource([item('a', 'FOMO', 'fomo'), item('b', 'PUMPFUN', 'pump'), item('c')], 'KOL')).toBe(false);
	});
});

describe('itemsMatchingSource', () => {
	test('KOL keeps only KOL rows', () => {
		const rows = [
			item('a', 'KOL', 'alice'),
			item('b', 'FOMO', 'fomo'),
			item('c', 'PUMPFUN', 'pump'),
			item('d')
		];
		expect(itemsMatchingSource(rows, 'KOL').map((row) => row.walletAddress)).toEqual(['a']);
	});
});

describe('mergeTraderLabels', () => {
	test('keeps REST identity when a later snapshot omits labels', () => {
		const rest = [item('a', 'FOMO', 'alice')];
		const live = [item('a')];
		expect(mergeTraderLabels(live, rest)[0]?.labels?.[0]?.label).toBe('alice');
	});
});

describe('mergeLiveRanking', () => {
	test('keeps load-more tail when a first-page snapshot arrives', () => {
		const page1 = [item('a', 'FOMO', 'a'), item('b', 'FOMO', 'b')];
		const page2 = [item('c', 'FOMO', 'c')];
		const merged = mergeLiveRanking(page1, [...page1, ...page2]);
		expect(merged.map((row) => row.walletAddress)).toEqual(['a', 'b', 'c']);
	});
});

describe('rankingSubscribeParams', () => {
	test('omits sources on All so the subscribe hub matches the HTTP seed', () => {
		expect(rankingSubscribeParams('SOL', 'ONE_DAY', undefined, {})).toEqual({
			chain: 'SOL',
			timeRange: 'ONE_DAY'
		});
		expect(rankingSubscribeParams('SOL', 'ONE_DAY', ['FOMO'], { pnlUsdMin: 10 })).toEqual({
			chain: 'SOL',
			timeRange: 'ONE_DAY',
			pnlUsdMin: 10,
			sources: ['FOMO']
		});
		// An empty array is "no filter", same as undefined.
		expect(rankingSubscribeParams('SOL', 'ONE_DAY', [], {})).toEqual({
			chain: 'SOL',
			timeRange: 'ONE_DAY'
		});
	});
});
