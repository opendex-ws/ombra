import { describe, expect, it } from 'vitest';
import {
	applyCandleBatch,
	buildCandleIndex,
	markerFetchRanges,
	shouldClampBarSpacing,
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

describe('shouldClampBarSpacing', () => {
	it('clamps when a token has only a couple of candles', () => {
		// the reported case: one 5m candle fitted across the pane
		expect(shouldClampBarSpacing(1, 900)).toBe(true);
		expect(shouldClampBarSpacing(2, 900)).toBe(true);
	});

	it('leaves a normally populated timeframe fitted', () => {
		// same window at 5s resolution
		expect(shouldClampBarSpacing(60, 900)).toBe(false);
		expect(shouldClampBarSpacing(300, 900)).toBe(false);
	});

	it('is inert before the chart has data or a measured width', () => {
		expect(shouldClampBarSpacing(0, 900)).toBe(false);
		expect(shouldClampBarSpacing(10, 0)).toBe(false);
	});
});

describe('markerFetchRanges', () => {
	const DAY = 86_400;
	const opts = { gapSeconds: 3600, maxSpanSeconds: DAY, maxRanges: 4 };

	it('skips a dead gap instead of requesting across it', () => {
		// one candle 90 days ago, one today: 90 days on screen, ~0 worth fetching
		const times = [1_000_000, 1_000_000 + 90 * DAY];
		const ranges = markerFetchRanges(times, 1_000_000, 1_000_000 + 90 * DAY, opts);
		expect(ranges).toEqual([
			{ from: 1_000_000, to: 1_000_000 },
			{ from: 1_000_000 + 90 * DAY, to: 1_000_000 + 90 * DAY }
		]);
		const requested = ranges.reduce((n, r) => n + (r.to - r.from), 0);
		expect(requested).toBeLessThan(DAY);
	});

	it('never asks for more than the server will return in one request', () => {
		const times = Array.from({ length: 400 }, (_, i) => i * 1800); // ~8 days
		for (const range of markerFetchRanges(times, 0, 1e9, opts)) {
			expect(range.to - range.from).toBeLessThanOrEqual(DAY);
		}
	});

	it('chunks a long window instead of clamping it, so nothing is lost', () => {
		const times = Array.from({ length: 400 }, (_, i) => i * 1800); // ~8 days
		const ranges = markerFetchRanges(times, 0, 1e9, opts);
		expect(ranges).toHaveLength(4);
		// contiguous, newest-anchored coverage rather than a single trimmed range
		for (let i = 1; i < ranges.length; i++) {
			expect(ranges[i].from).toBe(ranges[i - 1].to);
		}
		expect(ranges[ranges.length - 1].to).toBe(399 * 1800);
	});

	it('stops at the start of a short segment rather than over-reaching', () => {
		const times = Array.from({ length: 10 }, (_, i) => 5_000 + i * 60);
		expect(markerFetchRanges(times, 0, 1e9, opts)).toEqual([{ from: 5_000, to: 5_000 + 9 * 60 }]);
	});

	it('keeps only the most recent ranges', () => {
		const times = [0, 10 * DAY, 20 * DAY, 30 * DAY];
		const ranges = markerFetchRanges(times, 0, 1e9, { ...opts, maxRanges: 2 });
		expect(ranges).toEqual([
			{ from: 20 * DAY, to: 20 * DAY },
			{ from: 30 * DAY, to: 30 * DAY }
		]);
	});

	it('ignores candles outside the window and empty input', () => {
		expect(markerFetchRanges([5, 10], 100, 200, opts)).toEqual([]);
		expect(markerFetchRanges([], 0, 100, opts)).toEqual([]);
		expect(markerFetchRanges([50], 100, 50, opts)).toEqual([]);
	});
});
