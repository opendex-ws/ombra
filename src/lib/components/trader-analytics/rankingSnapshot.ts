import type { Chain, TraderRankItem, WalletTimeRange } from '$lib/api/types';
import type { TraderRankingFilterValues, TraderRankingSource } from './config';

export function traderKey(item: TraderRankItem): string {
	return `${item.chain}:${item.walletAddress}`;
}

export function dedupeTraders(nextItems: TraderRankItem[], existing: TraderRankItem[] = []): TraderRankItem[] {
	const seen = new Set(existing.map(traderKey));
	return nextItems.filter((item) => {
		const key = traderKey(item);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function itemHasSource(item: TraderRankItem, expected: TraderRankingSource): boolean {
	if (!expected) return true;
	return (item.labels ?? []).some((label) => label.source === expected);
}

export function itemsMatchingSource(items: TraderRankItem[], expected: TraderRankingSource): TraderRankItem[] {
	if (!expected) return items;
	return items.filter((item) => itemHasSource(item, expected));
}

/** Reject All-hub snapshots when the UI is on FOMO/PUMPFUN/KOL. */
export function snapshotMatchesSource(nextItems: TraderRankItem[], expected: TraderRankingSource): boolean {
	if (!expected) return true;
	if (nextItems.length === 0) return true;
	return nextItems.every((item) => itemHasSource(item, expected));
}

export function mergeTraderLabels(nextItems: TraderRankItem[], previous: TraderRankItem[]): TraderRankItem[] {
	if (previous.length === 0) return nextItems;
	const prior = new Map(previous.map((item) => [traderKey(item), item.labels]));
	return nextItems.map((item) => {
		const labels = item.labels ?? [];
		if (labels.length > 0) return item;
		const kept = prior.get(traderKey(item));
		return kept && kept.length > 0 ? { ...item, labels: kept } : item;
	});
}

/** Live snapshot is the current first page. Keep extra pages from Load more. */
export function mergeLiveRanking(incoming: TraderRankItem[], previous: TraderRankItem[]): TraderRankItem[] {
	const live = mergeTraderLabels(dedupeTraders(incoming), previous);
	if (previous.length <= live.length) return live;
	const liveKeys = new Set(live.map(traderKey));
	return [...live, ...previous.filter((item) => !liveKeys.has(traderKey(item)))];
}

export function rankingSubscribeParams(
	nextChain: Chain,
	nextTimeRange: WalletTimeRange,
	sources: string[] | undefined,
	filters: TraderRankingFilterValues
): Record<string, any> {
	const params: Record<string, any> = { chain: nextChain, timeRange: nextTimeRange, ...filters };
	if (sources?.length) params.sources = sources;
	return params;
}
