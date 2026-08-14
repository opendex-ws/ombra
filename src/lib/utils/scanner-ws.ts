import type { ScannerItem, TokenMarketQuote, TokenMarketStats } from '$lib/api/types';
import type { components } from '$lib/api/types';

type ScannerFeedStats = components['schemas']['ScannerFeedStats'];

export type RowFlashType = 'update' | 'new' | 'remove';

export type ScannerWsResult = {
	tokens: ScannerItem[];
	affected: Map<string, RowFlashType>;
	stats?: ScannerFeedStats;
};

type TokensEventData = {
	tokens: ScannerItem[];
	stats: ScannerFeedStats;
};

type UpdateEventData = {
	tokens: Partial<ScannerItem>[];
};

function scannerRowUnchanged(old: ScannerItem, next: ScannerItem): boolean {
	return (
		old.quote.priceUsd === next.quote.priceUsd &&
		old.quote.marketCapUsd === next.quote.marketCapUsd &&
		old.quote.liquidityUsd === next.quote.liquidityUsd &&
		old.calls === next.calls &&
		old.rugged === next.rugged &&
		old.isFavourited === next.isFavourited &&
		old.holders?.holderCount === next.holders?.holderCount &&
		old.createdAtAgeSeconds === next.createdAtAgeSeconds &&
		old.stats?.total?.transactions === next.stats?.total?.transactions
	);
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
	const result = { ...base };
	for (const key of Object.keys(patch) as (keyof T)[]) {
		const val = patch[key];
		if (val !== undefined && val !== null && typeof val === 'object' && !Array.isArray(val)) {
			const baseVal = base[key];
			if (baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
				result[key] = deepMerge(baseVal as Record<string, unknown>, val as Record<string, unknown>) as T[keyof T];
				continue;
			}
		}
		if (val !== undefined) {
			result[key] = val as T[keyof T];
		}
	}
	return result;
}

export function applyScannerWsEvent(
	event: string,
	data: TokensEventData | UpdateEventData,
	current: ScannerItem[]
): ScannerWsResult {
	if (event === 'SCANNER_TOKENS') {
		const typed = data as TokensEventData;
		if (!typed.tokens) return { tokens: current, affected: new Map() };

		const currentByPair = new Map<string, ScannerItem>();
		for (const t of current) currentByPair.set(t.pairAddress, t);

		const seen = new Set<string>();
		const deduped: ScannerItem[] = [];
		const affected = new Map<string, RowFlashType>();

		for (const token of typed.tokens) {
			if (seen.has(token.pairAddress)) continue;
			seen.add(token.pairAddress);
			const old = currentByPair.get(token.pairAddress);
			const merged = { ...token };
			if (!merged.sparkline?.length && old?.sparkline?.length) {
				merged.sparkline = old.sparkline;
			}

			if (old === undefined) {
				affected.set(token.pairAddress, 'new');
				deduped.push(merged);
				continue;
			}
			if (
				old.quote.priceUsd !== token.quote.priceUsd ||
				old.quote.marketCapUsd !== token.quote.marketCapUsd ||
				old.quote.liquidityUsd !== token.quote.liquidityUsd
			) {
				affected.set(token.pairAddress, 'update');
				deduped.push(merged);
				continue;
			}
			deduped.push(scannerRowUnchanged(old, merged) ? old : merged);
		}

		for (const t of current) {
			if (!seen.has(t.pairAddress)) {
				affected.set(t.pairAddress, 'remove');
			}
		}

		return { tokens: deduped, affected, stats: typed.stats };
	} else if (event === 'SCANNER_UPDATE') {
		const typed = data as UpdateEventData;
		if (!typed.tokens) return { tokens: current, affected: new Map() };

		const updateMap = new Map<string, Partial<ScannerItem>>();
		for (const u of typed.tokens) {
			if (u.pairAddress) updateMap.set(u.pairAddress, u);
		}

		const affected = new Map<string, RowFlashType>();
		const tokens = current.map((t) => {
			const upd = updateMap.get(t.pairAddress);
			if (!upd) return t;
			affected.set(t.pairAddress, 'update');

			const merged = { ...t };
			if (upd.quote) {
				merged.quote = deepMerge(t.quote, upd.quote as Partial<TokenMarketQuote>);
			}
			if (upd.stats) {
				merged.stats = deepMerge(t.stats, upd.stats as Partial<TokenMarketStats>);
			}
			if (upd.holders) {
				merged.holders = { ...t.holders, ...upd.holders };
			}
			if (upd.audit) {
				merged.audit = { ...t.audit, ...upd.audit };
			}
			if (upd.socials) {
				merged.socials = { ...t.socials, ...upd.socials };
			}
			if (upd.launchPad !== undefined) {
				merged.launchPad = upd.launchPad;
			}
			if (upd.sparkline?.length) {
				merged.sparkline = upd.sparkline;
			}
			if (upd.rugged !== undefined) merged.rugged = upd.rugged;
			if (upd.isFavourited !== undefined) merged.isFavourited = upd.isFavourited;
			if (upd.calls !== undefined) merged.calls = upd.calls;
			if (upd.createdAtAgeSeconds !== undefined) merged.createdAtAgeSeconds = upd.createdAtAgeSeconds;

			return merged;
		});
		return { tokens, affected };
	}
	return { tokens: current, affected: new Map() };
}
