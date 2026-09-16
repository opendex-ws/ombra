export interface RawCandleUpdate {
	time: number;
	open: number | string;
	openStr?: string;
	high: number | string;
	low: number | string;
	close: number | string;
	closeStr?: string;
	volume?: number | string;
	volumeUsd?: number | string;
}

export interface CandlePoint {
	time: number;
	open: number;
	high: number;
	low: number;
	close: number;
}

export interface VolumePoint {
	time: number;
	value: number;
	color: string;
}

export interface AreaPoint {
	time: number;
	value: number;
}

export interface NormalizedCandle {
	candle: CandlePoint;
	volume: VolumePoint;
	area: AreaPoint;
	rawClose: string;
}

export interface CandleColors {
	upVolume: string;
	downVolume: string;
}

export type CandleChangeKind = 'append' | 'correct' | 'insert' | 'drop';

export interface CandleChange {
	kind: CandleChangeKind;
	index: number;
	point: NormalizedCandle;
}

function finiteNumber(value: number | string | undefined, fallback = 0): number {
	const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCandle(
	raw: RawCandleUpdate,
	colors: CandleColors,
	effectiveOpen?: number
): NormalizedCandle {
	const close = finiteNumber(raw.close);
	const sourceOpen = effectiveOpen ?? finiteNumber(raw.openStr ?? raw.open, close);
	const open = sourceOpen;
	const high = Math.max(finiteNumber(raw.high, close), open, close);
	const low = Math.min(finiteNumber(raw.low, open), open, close);
	const volume = finiteNumber(raw.volumeUsd ?? raw.volume);
	const isUp = close > open;
	const candle = { time: raw.time, open, high, low, close };

	return {
		candle,
		volume: { time: raw.time, value: volume, color: isUp ? colors.upVolume : colors.downVolume },
		area: { time: raw.time, value: close },
		rawClose: raw.closeStr ?? String(close)
	};
}

export function buildCandleIndex(candles: readonly CandlePoint[]): Map<number, number> {
	const index = new Map<number, number>();
	for (let i = 0; i < candles.length; i++) index.set(candles[i].time, i);
	return index;
}

export function latestCandlesByTime(candles: readonly RawCandleUpdate[]): RawCandleUpdate[] {
	const latest = new Map<number, RawCandleUpdate>();
	for (const candle of candles) latest.set(candle.time, candle);
	return [...latest.values()].sort((a, b) => a.time - b.time);
}

export function classifyCandleTime(
	time: number,
	candles: readonly CandlePoint[],
	index: ReadonlyMap<number, number>
): { kind: CandleChangeKind; index: number } {
	const existing = index.get(time);
	if (existing !== undefined) return { kind: 'correct', index: existing };
	if (candles.length === 0 || time > candles[candles.length - 1].time) {
		return { kind: 'append', index: candles.length };
	}
	if (time < candles[0].time) return { kind: 'drop', index: -1 };

	let low = 0;
	let high = candles.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (candles[middle].time < time) low = middle + 1;
		else high = middle;
	}
	return { kind: 'insert', index: low };
}

export function applyCandleBatch(
	rawCandles: readonly RawCandleUpdate[],
	candles: CandlePoint[],
	volumes: VolumePoint[],
	areas: AreaPoint[],
	index: Map<number, number>,
	colors: CandleColors
): { changes: CandleChange[]; rebuiltIndex: boolean } {
	const changes: CandleChange[] = [];
	let rebuiltIndex = false;

	for (const raw of latestCandlesByTime(rawCandles)) {
		const classification = classifyCandleTime(raw.time, candles, index);
		if (classification.kind === 'drop') continue;
		const effectiveOpen = classification.kind === 'correct'
			? candles[classification.index]?.open
			: undefined;
		const point = normalizeCandle(raw, colors, effectiveOpen);

		if (classification.kind === 'append') {
			candles.push(point.candle);
			volumes.push(point.volume);
			areas.push(point.area);
			index.set(raw.time, candles.length - 1);
		} else if (classification.kind === 'correct') {
			candles[classification.index] = point.candle;
			volumes[classification.index] = point.volume;
			areas[classification.index] = point.area;
		} else {
			candles.splice(classification.index, 0, point.candle);
			volumes.splice(classification.index, 0, point.volume);
			areas.splice(classification.index, 0, point.area);
			rebuiltIndex = true;
		}
		changes.push({ ...classification, point });
	}

	if (rebuiltIndex) {
		index.clear();
		for (let i = 0; i < candles.length; i++) index.set(candles[i].time, i);
	}

	return { changes, rebuiltIndex };
}

export function candleHigh(candles: readonly CandlePoint[]): { value: number; time: number | null } {
	let value = 0;
	let time: number | null = null;
	for (const candle of candles) {
		if (candle.high > value) {
			value = candle.high;
			time = candle.time;
		}
	}
	return { value, time };
}

/** Widest bar the viewport reset will leave in place before falling back. */
export const MAX_RESET_BAR_SPACING = 30;
/** Bar width used when fitting the data would stretch it absurdly wide. */
export const DEFAULT_BAR_SPACING = 10;

/**
 * Whether fitting `count` candles across `width` px would produce absurdly wide
 * bars. Bar spacing survives a data swap, so a fit over one or two candles leaves
 * the next timeframe zoomed to a couple of bars until it is clamped.
 */
export function shouldClampBarSpacing(count: number, width: number): boolean {
	return count > 0 && width > 0 && width / count > MAX_RESET_BAR_SPACING;
}

export interface MarkerRange {
	from: number;
	to: number;
}

export interface MarkerRangeOptions {
	/** A run of empty time longer than this splits the request in two. */
	gapSeconds: number;
	/** Server-enforced ceiling on one request's span. Longer spans are CHUNKED,
	 *  never clamped: the backend silently trims an over-long range, so clamping
	 *  would report history as covered that was never actually returned. */
	maxSpanSeconds: number;
	/** Most recent N chunks are requested; older ones wait for a pan. */
	maxRanges: number;
}

/**
 * Requests for chart markers must follow the candles, not the visible time span.
 * A token with one candle today and one 90 days ago spans 90 days on screen, but
 * markers can only sit on candles, so the empty middle is never worth fetching.
 */
export function markerFetchRanges(
	candleTimes: readonly number[],
	from: number,
	to: number,
	options: MarkerRangeOptions
): MarkerRange[] {
	if (to <= from) return [];
	const { gapSeconds, maxSpanSeconds, maxRanges } = options;
	const span = Math.max(1, maxSpanSeconds);
	const segments: MarkerRange[] = [];
	let start: number | null = null;
	let prev = 0;

	for (const time of candleTimes) {
		if (time < from || time > to) continue;
		if (start === null) {
			start = time;
		} else if (time - prev > gapSeconds) {
			segments.push({ from: start, to: prev });
			start = time;
		}
		prev = time;
	}
	if (start !== null) segments.push({ from: start, to: prev });

	// Newest first, chunked to the server limit, so nothing is silently trimmed.
	const chunks: MarkerRange[] = [];
	for (let i = segments.length - 1; i >= 0 && chunks.length < maxRanges; i--) {
		const segment = segments[i];
		let end = segment.to;
		while (end >= segment.from && chunks.length < maxRanges) {
			const chunkFrom = Math.max(segment.from, end - span);
			chunks.push({ from: chunkFrom, to: end });
			if (chunkFrom === segment.from) break;
			end = chunkFrom;
		}
	}
	return chunks.sort((a, b) => a.from - b.from);
}
