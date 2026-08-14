import { describe, expect, test } from 'vitest';
import type { CompletedTrade } from './api/types';
import {
	completedTradeTimestamp,
	mergeCompletedTrades,
	sortCompletedTrades
} from './utils/completed-trades';

function completedTrade(id: number, createdAtTimestamp: number, swapTimestamps: number[]): CompletedTrade {
	return {
		id,
		createdAtTimestamp,
		swaps: swapTimestamps.map((timestamp) => ({ timestamp }))
	} as CompletedTrade;
}

describe('completed trade chronology', () => {
	test('orders by latest execution time rather than opening time', () => {
		const closedLater = completedTrade(1, 100, [200, 500]);
		const openedLater = completedTrade(2, 300, [400]);

		expect(completedTradeTimestamp(closedLater)).toBe(500);
		expect(sortCompletedTrades([openedLater, closedLater]).map((trade) => trade.id)).toEqual([1, 2]);
	});

	test('deduplicates pages and uses trade ID to break equal timestamps', () => {
		const olderVersion = completedTrade(1, 100, [400]);
		const newerVersion = completedTrade(1, 100, [500]);
		const sameTime = completedTrade(2, 200, [500]);

		const merged = mergeCompletedTrades([olderVersion], [newerVersion, sameTime]);
		expect(merged.map((trade) => trade.id)).toEqual([2, 1]);
		expect(merged).toHaveLength(2);
		expect(completedTradeTimestamp(merged[1])).toBe(500);
	});
});
