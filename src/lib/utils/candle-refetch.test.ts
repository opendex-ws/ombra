import { describe, expect, test } from 'vitest';
import {
	applyCandleBatch,
	buildCandleIndex,
	type AreaPoint,
	type CandlePoint,
	type RawCandleUpdate,
	type VolumePoint
} from './candle-updates';
import { isCandleRequestCurrent, selectTailUpdates, shouldRefetchAfterHidden } from './candle-refetch';

const colors = { upVolume: 'u', downVolume: 'd' };
const bar = (time: number, close: number, high = close, low = close): RawCandleUpdate => ({
	time, open: close, high, low, close, volume: 1
});

function series(times: number[]) {
	const candles: CandlePoint[] = [];
	const volumes: VolumePoint[] = [];
	const areas: AreaPoint[] = [];
	const index = new Map<number, number>();
	applyCandleBatch(times.map((t) => bar(t, 10)), candles, volumes, areas, index, colors);
	return { candles, volumes, areas, index };
}

describe('selectTailUpdates', () => {
	test('gap in the middle is filled after merge', () => {
		const s = series([60, 120, 240, 300]);
		const tail = [60, 120, 180, 240, 300].map((t) => bar(t, 10));
		const updates = selectTailUpdates(tail, s.candles, s.index);
		expect(updates.map((u) => u.time)).toEqual([180, 300]);
		applyCandleBatch(updates, s.candles, s.volumes, s.areas, s.index, colors);
		expect(s.candles.map((c) => c.time)).toEqual([60, 120, 180, 240, 300]);
		expect(s.index).toEqual(buildCandleIndex(s.candles));
	});

	test('last bar is updated by newer data', () => {
		const s = series([60, 120]);
		const updates = selectTailUpdates([bar(60, 10), bar(120, 15, 16, 9)], s.candles, s.index);
		applyCandleBatch(updates, s.candles, s.volumes, s.areas, s.index, colors);
		expect(s.candles[1]).toMatchObject({ time: 120, close: 15, high: 16 });
		expect(s.candles).toHaveLength(2);
	});

	test('bars older than the loaded range and live-touched bars are skipped', () => {
		const s = series([120, 180]);
		const tail = [bar(60, 1), bar(120, 99), bar(180, 99)];
		const updates = selectTailUpdates(tail, s.candles, s.index, new Set([180]));
		expect(updates.map((u) => u.time)).toEqual([120]);
	});

	test('identical history produces no updates except the tip', () => {
		const s = series([60, 120, 180]);
		const updates = selectTailUpdates([60, 120, 180].map((t) => bar(t, 10)), s.candles, s.index);
		expect(updates.map((u) => u.time)).toEqual([180]);
	});
});

describe('isCandleRequestCurrent', () => {
	const key = { id: 2, chain: 'rh', address: 'a', frame: '1m', mode: 'price' };
	test('same key is current', () => expect(isCandleRequestCurrent(key, { ...key })).toBe(true));
	test('stale after id, token, frame or mode change', () => {
		expect(isCandleRequestCurrent(key, { ...key, id: 3 })).toBe(false);
		expect(isCandleRequestCurrent(key, { ...key, address: 'b' })).toBe(false);
		expect(isCandleRequestCurrent(key, { ...key, frame: '5m' })).toBe(false);
		expect(isCandleRequestCurrent(key, { ...key, mode: 'marketCap' })).toBe(false);
	});
});

describe('shouldRefetchAfterHidden', () => {
	test('no refetch for a short hide or when never hidden', () => {
		expect(shouldRefetchAfterHidden(1000, 2500)).toBe(false);
		expect(shouldRefetchAfterHidden(null, 99999)).toBe(false);
	});
	test('refetch after a long hide', () => {
		expect(shouldRefetchAfterHidden(1000, 4000)).toBe(true);
	});
});

describe('applyCandleBatch with an insert followed by an existing bar', () => {
	test('index stays consistent so the later bar is not written to a shifted slot', () => {
		const s = series([60, 240, 300]);
		applyCandleBatch([bar(120, 5), bar(300, 7)], s.candles, s.volumes, s.areas, s.index, colors);
		expect(s.candles.map((c) => [c.time, c.close])).toEqual([[60, 10], [120, 5], [240, 10], [300, 7]]);
	});
});
