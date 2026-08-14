export type CandleCacheMode = 'price' | 'marketCap';

export interface CachedCandlePoint {
	time: number;
	close: number;
}

export interface CachedSeries {
	points: CachedCandlePoint[];
	closes: number[];
	updatedAt: number;
}

interface TokenMetadata {
	mcapStr: string;
	updatedAt: number;
}

const seriesCache = new Map<string, CachedSeries>();
const metadataCache = new Map<string, TokenMetadata>();
const MAX_CACHED_SERIES = 200;
const MAX_CACHED_TOKENS = 200;
const MAX_POINTS = 120;

function tokenKey(chain: string, address: string): string {
	return `${chain}:${address}`;
}

function seriesKey(chain: string, address: string, timeframe: string, mode: CandleCacheMode): string {
	return `${tokenKey(chain, address)}:${timeframe}:${mode}`;
}

function evictOldest<T extends { updatedAt: number }>(cache: Map<string, T>, limit: number) {
	if (cache.size <= limit) return;
	let oldestKey = '';
	let oldestAt = Infinity;
	for (const [key, entry] of cache) {
		if (entry.updatedAt < oldestAt) {
			oldestAt = entry.updatedAt;
			oldestKey = key;
		}
	}
	if (oldestKey) cache.delete(oldestKey);
}

function createSeries(points: readonly CachedCandlePoint[], now: number): CachedSeries {
	const bounded = points.slice(-MAX_POINTS).map((point) => ({ ...point }));
	return { points: bounded, closes: bounded.map((point) => point.close), updatedAt: now };
}

export function setCandleSeries(
	chain: string,
	address: string,
	timeframe: string,
	mode: CandleCacheMode,
	points: readonly CachedCandlePoint[]
) {
	if (points.length === 0) return;
	const key = seriesKey(chain, address, timeframe, mode);
	const existing = seriesCache.get(key);
	const incomingTip = points[points.length - 1].time;
	const existingTip = existing?.points[existing.points.length - 1]?.time ?? -Infinity;
	if (existing && incomingTip < existingTip) return;
	if (existing) {
		updateCandleSeries(chain, address, timeframe, mode, points);
		return;
	}
	seriesCache.set(key, createSeries(points, Date.now()));
	evictOldest(seriesCache, MAX_CACHED_SERIES);
}

export function updateCandleSeries(
	chain: string,
	address: string,
	timeframe: string,
	mode: CandleCacheMode,
	updates: readonly CachedCandlePoint[]
) {
	if (updates.length === 0) return;
	const key = seriesKey(chain, address, timeframe, mode);
	const entry = seriesCache.get(key);
	if (!entry) {
		setCandleSeries(chain, address, timeframe, mode, updates);
		return;
	}

	for (const update of updates) {
		if (!Number.isFinite(update.close)) continue;
		const last = entry.points[entry.points.length - 1];
		if (!last || update.time > last.time) {
			entry.points.push({ ...update });
			entry.closes.push(update.close);
			if (entry.points.length > MAX_POINTS) {
				entry.points.shift();
				entry.closes.shift();
			}
			continue;
		}
		for (let i = entry.points.length - 1; i >= 0; i--) {
			const point = entry.points[i];
			if (point.time === update.time) {
				point.close = update.close;
				entry.closes[i] = update.close;
				break;
			}
			if (point.time < update.time) {
				entry.points.splice(i + 1, 0, { ...update });
				entry.closes.splice(i + 1, 0, update.close);
				if (entry.points.length > MAX_POINTS) {
					entry.points.shift();
					entry.closes.shift();
				}
				break;
			}
		}
	}
	entry.updatedAt = Date.now();
}

export function setCandleMcap(chain: string, address: string, mcapStr: string) {
	if (!mcapStr) return;
	const key = tokenKey(chain, address);
	const existing = metadataCache.get(key);
	if (existing) {
		existing.mcapStr = mcapStr;
		existing.updatedAt = Date.now();
	} else {
		metadataCache.set(key, { mcapStr, updatedAt: Date.now() });
		evictOldest(metadataCache, MAX_CACHED_TOKENS);
	}
}

export function getCandleSeries(
	chain: string,
	address: string,
	timeframe: string,
	mode: CandleCacheMode
): CachedSeries | null {
	const entry = seriesCache.get(seriesKey(chain, address, timeframe, mode));
	if (!entry) return null;
	entry.updatedAt = Date.now();
	return entry;
}

export function getCandleMcap(chain: string, address: string): string {
	return metadataCache.get(tokenKey(chain, address))?.mcapStr ?? '';
}
