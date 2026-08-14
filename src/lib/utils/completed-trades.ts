import type { CompletedTrade } from '$lib/api/types';

function validTimestamp(value: number): number {
	return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Best available completion time: latest confirmed swap, then creation time. */
export function completedTradeTimestamp(trade: CompletedTrade): number {
	let timestamp = validTimestamp(trade.createdAtTimestamp);
	for (const swap of trade.swaps) {
		timestamp = Math.max(timestamp, validTimestamp(swap.timestamp));
	}
	return timestamp;
}

/** Newest completion first, with trade ID as a deterministic tie-breaker. */
export function sortCompletedTrades(trades: readonly CompletedTrade[]): CompletedTrade[] {
	return [...trades].sort((left, right) => {
		const timeOrder = completedTradeTimestamp(right) - completedTradeTimestamp(left);
		return timeOrder || right.id - left.id;
	});
}

/** Merge REST pages and WebSocket updates without duplicate trade rows. */
export function mergeCompletedTrades(
	...groups: ReadonlyArray<ReadonlyArray<CompletedTrade>>
): CompletedTrade[] {
	const tradesById = new Map<number, CompletedTrade>();
	for (const group of groups) {
		for (const trade of group) tradesById.set(trade.id, trade);
	}
	return sortCompletedTrades([...tradesById.values()]);
}
