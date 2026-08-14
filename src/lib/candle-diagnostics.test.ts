import { describe, expect, it } from 'vitest';
import { createCandleDiagnostics } from './utils/candle-diagnostics';

describe('candle diagnostics', () => {
	it('tracks work counts and high-water marks when enabled', () => {
		const diagnostics = createCandleDiagnostics(true);
		diagnostics.add('rawCandles', 10_000);
		diagnostics.add('distinctCandles', 1);
		diagnostics.add('drains');
		diagnostics.max('maxPendingCandles', 1);
		diagnostics.max('maxPendingCandles', 0);

		expect(diagnostics.snapshot()).toMatchObject({
			rawCandles: 10_000,
			distinctCandles: 1,
			drains: 1,
			maxPendingCandles: 1
		});
	});

	it('is a zero-cost no-op contract when disabled', () => {
		const diagnostics = createCandleDiagnostics(false);
		diagnostics.add('rawCandles', 10_000);
		diagnostics.max('maxPendingCandles', 10_000);
		expect(diagnostics.snapshot().rawCandles).toBe(0);
		expect(diagnostics.snapshot().maxPendingCandles).toBe(0);
	});
});
