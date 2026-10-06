import { describe, expect, it } from 'vitest';
import { dipDetails, firstDip } from '$lib/utils/pending-trigger';

const money = (usd: number, native: number) => ({ usd, usdStr: String(usd), native, nativeStr: String(native) });

// Shape taken from a live pending-swap payload.
const dipBuy = {
	side: 'BUY',
	strategy: {
		type: 'DIP',
		dipPct: 68,
		trigger: {
			status: 'AVAILABLE',
			value: { marketCap: money(73407989.3851, 615701.17), price: money(0.073493424127, 0.000616417746) }
		}
	}
};

describe('dipDetails', () => {
	it('reads the percentage and the resolved trigger', () => {
		const d = dipDetails(dipBuy);
		expect(d?.dipPct).toBe(68);
		expect(d?.trigger?.marketCap.usdStr).toBe('73407989.3851');
		expect(d?.trigger?.price.nativeStr).toBe('0.000616417746');
	});

	it('keeps the percentage when the trigger is not yet available', () => {
		const d = dipDetails({ side: 'BUY', strategy: { type: 'DIP', dipPct: 20, trigger: { status: 'UNAVAILABLE' } } });
		expect(d).toEqual({ dipPct: 20, trigger: null });
	});

	it('tolerates a payload with no trigger at all', () => {
		expect(dipDetails({ side: 'BUY', strategy: { type: 'DIP', dipPct: 5 } })).toEqual({ dipPct: 5, trigger: null });
	});

	it('is null for non-dip strategies', () => {
		expect(dipDetails({ side: 'BUY', strategy: { type: 'MARKET' } })).toBeNull();
		expect(dipDetails({ side: 'BUY', strategy: { type: 'LIMIT', priceUsd: 1 } })).toBeNull();
		expect(dipDetails(null)).toBeNull();
	});
});

describe('firstDip', () => {
	it('skips sells and non-dip buys', () => {
		const out = firstDip([{ side: 'SELL', pct: 50 }, { side: 'BUY', strategy: { type: 'MARKET' } }, dipBuy]);
		expect(out?.dipPct).toBe(68);
	});

	it('is null when there is nothing pending', () => {
		expect(firstDip([])).toBeNull();
		expect(firstDip(undefined)).toBeNull();
	});
});
