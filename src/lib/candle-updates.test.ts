import { describe, expect, it } from 'vitest';
import {
	applyCandleBatch,
	buildCandleIndex,
	latestCandlesByTime,
	normalizeCandle,
	type CandlePoint,
	type VolumePoint,
	type AreaPoint
} from './utils/candle-updates';

const colors = { upVolume: 'up', downVolume: 'down' };

function raw(time: number, close: number) {
	return { time, open: close - 1, high: close + 1, low: close - 2, close, volumeUsd: close * 10 };
}

describe('candle updates', () => {
	it('keeps the latest complete payload per timestamp in chronological order', () => {
		expect(latestCandlesByTime([raw(2, 2), raw(1, 1), raw(2, 3)])).toEqual([raw(1, 1), raw(2, 3)]);
	});

	it('reduces a 10,000-message same-timestamp burst to one normalization candidate', () => {
		const burst = Array.from({ length: 10_000 }, (_, index) => raw(1, index));
		const reduced = latestCandlesByTime(burst);
		expect(reduced).toHaveLength(1);
		expect(reduced[0].close).toBe(9_999);
	});

	it('normalizes candle, volume, and area points in one pass', () => {
		const result = normalizeCandle(raw(1, 10), colors);
		expect(result.candle).toEqual({ time: 1, open: 9, high: 11, low: 8, close: 10 });
		expect(result.volume).toEqual({ time: 1, value: 100, color: 'up' });
		expect(result.area).toEqual({ time: 1, value: 10 });
	});

	it('corrects, inserts, appends, and drops outside-window timestamps', () => {
		const candles: CandlePoint[] = [normalizeCandle(raw(10, 10), colors).candle, normalizeCandle(raw(30, 30), colors).candle];
		const volumes: VolumePoint[] = [normalizeCandle(raw(10, 10), colors).volume, normalizeCandle(raw(30, 30), colors).volume];
		const areas: AreaPoint[] = [normalizeCandle(raw(10, 10), colors).area, normalizeCandle(raw(30, 30), colors).area];
		const index = buildCandleIndex(candles);

		const result = applyCandleBatch([raw(5, 5), raw(10, 11), raw(20, 20), raw(40, 40)], candles, volumes, areas, index, colors);

		expect(result.changes.map((change) => change.kind)).toEqual(['correct', 'insert', 'append']);
		expect(candles.map((candle) => candle.time)).toEqual([10, 20, 30, 40]);
		expect([...index.entries()]).toEqual([[10, 0], [20, 1], [30, 2], [40, 3]]);
		expect(volumes.map((volume) => volume.time)).toEqual(candles.map((candle) => candle.time));
		expect(areas.map((area) => area.time)).toEqual(candles.map((candle) => candle.time));
	});
});
