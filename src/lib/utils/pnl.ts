// Net PnL, in one place.
//
// The API's `pnl` block is explicitly gross — the spec describes every field as
// "before fees" — while `totalFees` is reported separately. Every surface that
// shows a trade's PnL must therefore subtract fees itself, and four components
// each grew their own copy of that arithmetic (with `autobuys` missing it
// entirely, so the same trade read 43.4% there and 38.7% on the share card).

/**
 * Coerce an API decimal to a number.
 *
 * Most numeric fields arrive as plain numbers, but the backend sometimes
 * serialises an exact-decimal wrapper (`{ source, parsedValue }`) for the same
 * field — `totalFees.usd` does this even though the schema types it as `number`.
 * Naive arithmetic on that shape yields NaN, which silently renders as "$NaN"
 * or, worse, flips a loss to a gain because `NaN < 0` is false.
 */
export function decimalToNumber(value: unknown): number {
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	if (value && typeof value === 'object') {
		const wrapper = value as { parsedValue?: unknown; source?: unknown };
		if (wrapper.parsedValue !== undefined) return decimalToNumber(wrapper.parsedValue);
		if (wrapper.source !== undefined) return decimalToNumber(wrapper.source);
	}
	return 0;
}

/** Minimal shape shared by ActiveTrade and CompletedTrade. */
export type PnlTrade = {
	pnl: { usd: unknown; native: unknown; pct: unknown; multiplier: unknown };
	totalFees?: { usd?: unknown; native?: unknown } | null;
	totalBought?: { usd?: unknown } | null;
};

/** Gross PnL minus fees, in USD. */
export function netPnlUsd(trade: PnlTrade): number {
	return decimalToNumber(trade.pnl.usd) - decimalToNumber(trade.totalFees?.usd);
}

/** Gross PnL minus fees, in the chain's native currency. */
export function netPnlNative(trade: PnlTrade): number {
	return decimalToNumber(trade.pnl.native) - decimalToNumber(trade.totalFees?.native);
}

/** Net PnL as a percentage of cost basis; falls back to the gross pct. */
export function netPnlPct(trade: PnlTrade): number {
	const basis = decimalToNumber(trade.totalBought?.usd);
	if (basis <= 0) return decimalToNumber(trade.pnl.pct);
	return (netPnlUsd(trade) / basis) * 100;
}

/** Net return as a multiple of cost basis; falls back to the gross multiplier. */
export function netPnlMultiplier(trade: PnlTrade): number {
	const basis = decimalToNumber(trade.totalBought?.usd);
	if (basis <= 0) return decimalToNumber(trade.pnl.multiplier);
	return Math.max(0, (basis + netPnlUsd(trade)) / basis);
}

/** Profit/loss test used for colour and share-card artwork. */
export function isNetProfit(trade: PnlTrade): boolean {
	return netPnlUsd(trade) >= 0;
}
