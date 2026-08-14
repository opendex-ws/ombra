import { describe, expect, it } from 'vitest';
import { getCandleSeries, setCandleSeries, updateCandleSeries } from './stores/candleCache.svelte';

describe('candle cache', () => {
	it('isolates series by timeframe and mode', () => {
		setCandleSeries('SOL', 'isolation', '1m', 'price', [{ time: 1, close: 1 }]);
		setCandleSeries('SOL', 'isolation', '15m', 'marketCap', [{ time: 1, close: 100 }]);

		expect(getCandleSeries('SOL', 'isolation', '1m', 'price')?.closes).toEqual([1]);
		expect(getCandleSeries('SOL', 'isolation', '15m', 'marketCap')?.closes).toEqual([100]);
	});

	it('updates historical timestamps without replacing the tip', () => {
		setCandleSeries('SOL', 'correction', '15m', 'marketCap', [
			{ time: 1, close: 1 },
			{ time: 2, close: 2 }
		]);
		updateCandleSeries('SOL', 'correction', '15m', 'marketCap', [{ time: 1, close: 10 }]);

		expect(getCandleSeries('SOL', 'correction', '15m', 'marketCap')?.points).toEqual([
			{ time: 1, close: 10 },
			{ time: 2, close: 2 }
		]);
	});

	it('rejects a structural snapshot older than the cached tip', () => {
		setCandleSeries('SOL', 'freshness', '15m', 'marketCap', [{ time: 10, close: 10 }]);
		setCandleSeries('SOL', 'freshness', '15m', 'marketCap', [{ time: 5, close: 5 }]);

		expect(getCandleSeries('SOL', 'freshness', '15m', 'marketCap')?.closes).toEqual([10]);
	});

	it('merges same-tip snapshots without shrinking the canonical preview tail', () => {
		setCandleSeries('SOL', 'multi-writer', '15m', 'marketCap', [
			{ time: 1, close: 1 },
			{ time: 2, close: 2 }
		]);
		setCandleSeries('SOL', 'multi-writer', '15m', 'marketCap', [{ time: 2, close: 20 }]);

		expect(getCandleSeries('SOL', 'multi-writer', '15m', 'marketCap')?.points).toEqual([
			{ time: 1, close: 1 },
			{ time: 2, close: 20 }
		]);
	});
});
