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
