import { describe, expect, test } from 'vitest';
import { pickCandleFrame } from './utils/pnl-chart';

describe('candle frame selection', () => {
	test('a sub-minute scalp gets second-level candles', () => {
		// The 52s trade that prompted this: ~70s window with padding.
		expect(pickCandleFrame(70)).toBe('1s');
		expect(pickCandleFrame(52)).toBe('1s');
	});

	test('scales up with the hold so the series stays readable', () => {
		expect(pickCandleFrame(10 * 60)).toBe('5s');
		expect(pickCandleFrame(60 * 60)).toBe('30s');
		expect(pickCandleFrame(24 * 3600)).toBe('15m');
		expect(pickCandleFrame(3 * 24 * 3600)).toBe('1h');
	});

	test('never returns a frame that would blow past the point cap', () => {
		const frames: Record<string, number> = {
			'1s': 1, '5s': 5, '15s': 15, '30s': 30, '1m': 60, '5m': 300, '15m': 900,
			'30m': 1800, '1h': 3600, '4h': 14400, '6h': 21600, '12h': 43200, '24h': 86400
		};
		for (const windowSeconds of [30, 600, 86400, 30 * 86400, 365 * 86400]) {
			const frame = pickCandleFrame(windowSeconds);
			expect(windowSeconds / frames[frame]).toBeLessThanOrEqual(1200);
		}
	});

	test('degrades sanely on nonsense input', () => {
		expect(pickCandleFrame(0)).toBe('1m');
		expect(pickCandleFrame(-5)).toBe('1m');
		expect(pickCandleFrame(Number.NaN)).toBe('1m');
	});
});
