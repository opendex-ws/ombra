import type { components } from '$lib/api/v2.d.ts';
import type { QueryOf } from '$lib/api/client';

export type TradeQuote = components['schemas']['TradeQuoteResponse'];
export type TradeQuoteLeg = components['schemas']['TradeQuoteLeg'];
export type TradeQuoteQuery = QueryOf<'/v2/trade/{chain}/{token}/quote'>;

/** Reasons the endpoint gives in `error` on a 422. */
const NO_ROUTE_REASONS: Record<string, string> = {
	NO_ROUTE: 'No route for this token',
	NO_OUTPUT: 'Route returns nothing at this size',
	INSUFFICIENT_LIQUIDITY: 'Not enough liquidity for this size',
	TOO_MANY_ACCOUNTS: 'Route too complex to execute',
	UNTRADEABLE_MINT: 'Token cannot be traded'
};

export function noRouteMessage(error: string | null | undefined): string {
	return (error && NO_ROUTE_REASONS[error]) || 'No route available';
}

/** Decimal text for the API, without float noise or exponent notation. */
function decimalText(n: number, maxDecimals: number): string | null {
	if (!Number.isFinite(n) || n <= 0) return null;
	const fixed = n.toFixed(maxDecimals).replace(/\.?0+$/, '');
	return fixed === '' || fixed === '0' ? null : fixed;
}

export function buyQuoteQuery(args: {
	amount: string;
	usd: boolean;
	buyWith: 'NATIVE' | 'FIAT';
	slippagePct: number | null;
}): TradeQuoteQuery | null {
	const amount = decimalText(Number(args.amount), args.usd ? 2 : 9);
	if (!amount) return null;
	const q: TradeQuoteQuery = { side: 'BUY', amount, amountType: args.usd ? 'USD' : 'NATIVE' };
	if (args.buyWith === 'FIAT') q.currency = 'FIAT';
	if (args.slippagePct !== null && args.slippagePct > 0) q.slippagePct = String(args.slippagePct);
	return q;
}

/**
 * The sell panel works in percent of the position; the endpoint wants token
 * units. The backend rounds extra decimals down, so 9 is safe for any mint.
 */
export function sellQuoteQuery(args: {
	pct: number;
	tokensRemaining: number;
	buyWith: 'NATIVE' | 'FIAT';
	slippagePct: number | null;
}): TradeQuoteQuery | null {
	const amount = decimalText((args.tokensRemaining * args.pct) / 100, 9);
	if (!amount) return null;
	const q: TradeQuoteQuery = { side: 'SELL', amount };
	if (args.buyWith === 'FIAT') q.currency = 'FIAT';
	if (args.slippagePct !== null && args.slippagePct > 0) q.slippagePct = String(args.slippagePct);
	return q;
}

/** A token on the route, and the venue of the hop that reached it (null for the start). */
export type RouteStop = { address: string; symbol: string | null; via: TradeQuoteLeg['venue'] };

/** Tokens along the route, in order, so `A→B, B→C` reads `A, B, C`. */
export function routeStops(quote: Pick<TradeQuote, 'legs' | 'inputToken' | 'outputToken'>): RouteStop[] {
	if (quote.legs.length === 0) {
		return [
			{ address: quote.inputToken, symbol: null, via: null },
			{ address: quote.outputToken, symbol: null, via: null }
		];
	}
	const first = quote.legs[0];
	const out: RouteStop[] = [{ address: first.inputToken, symbol: first.inputSymbol, via: null }];
	for (const leg of quote.legs) {
		if (out[out.length - 1].address !== leg.inputToken) {
			out.push({ address: leg.inputToken, symbol: leg.inputSymbol, via: null });
		}
		out.push({ address: leg.outputToken, symbol: leg.outputSymbol, via: leg.venue });
	}
	return out;
}

/**
 * Legs carry a symbol, but it is nullable, so fall back to what the panel
 * already knows and the common Solana intermediates before a short address.
 */
export const KNOWN_MINTS: Record<string, string> = {
	So11111111111111111111111111111111111111112: 'SOL',
	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
	USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: 'USD1'
};

export function tokenLabel(
	stop: RouteStop | string,
	extra: Record<string, string> = {}
): string {
	const { address, symbol } = typeof stop === 'string' ? { address: stop, symbol: null } : stop;
	return symbol || extra[address] || KNOWN_MINTS[address] || `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Above this, warn: a large impact means the size moves the pool. */
export const HIGH_PRICE_IMPACT_PCT = 5;
