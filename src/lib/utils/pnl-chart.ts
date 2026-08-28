// Real price history for the PnL share card.
//
// The "Candles" background used to be procedural noise. This fetches the token's
// actual candles across the trade's own window and returns a series plus the
// swap markers, so the card shows what really happened.

import { api } from '$lib/api/client';
import type { Chain, CandleFrame, CompletedTrade } from '$lib/api/types';

export type SparkPoint = { time: number; value: number };
export type SwapMarker = { time: number; value: number; side: 'BUY' | 'SELL' };
export type TradeChart = {
	points: SparkPoint[];
	markers: SwapMarker[];
	frame: CandleFrame;
};

/** Seconds covered by each candle bucket, smallest first. */
const FRAME_SECONDS: [CandleFrame, number][] = [
	['1s', 1],
	['5s', 5],
	['15s', 15],
	['30s', 30],
	['1m', 60],
	['5m', 300],
	['15m', 900],
	['30m', 1800],
	['1h', 3600],
	['4h', 14400],
	['6h', 21600],
	['12h', 43200],
	['24h', 86400]
];

/** Aim for a line with enough shape to read, without a pointless number of buckets. */
const TARGET_POINTS = 90;
/** The API caps `count`, and a from/to window has to stay under it too. */
const MAX_POINTS = 1200;

/**
 * Pick the finest timeframe that still keeps the window near TARGET_POINTS.
 * A 52-second scalp wants 1s candles; a three-day hold wants 30m.
 */
export function pickCandleFrame(windowSeconds: number): CandleFrame {
	if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return '1m';
	// Whichever bucket lands closest to the target point count, rather than the
	// first one that fits — "first that fits" systematically undershoots (a 24h
	// hold would get 48 points when 15m candles would give a much nicer 96).
	let best: CandleFrame = FRAME_SECONDS[FRAME_SECONDS.length - 1][0];
	let bestDistance = Infinity;
	for (const [frame, seconds] of FRAME_SECONDS) {
		const points = windowSeconds / seconds;
		if (points > MAX_POINTS || points < 2) continue;
		const distance = Math.abs(points - TARGET_POINTS);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = frame;
		}
	}
	return best;
}

function frameSeconds(frame: CandleFrame): number {
	return FRAME_SECONDS.find(([f]) => f === frame)?.[1] ?? 60;
}

function swapMarkers(trade: CompletedTrade): SwapMarker[] {
	const out: SwapMarker[] = [];
	for (const swap of trade.swaps ?? []) {
		const time = Math.floor(Number(swap.timestamp) / 1000);
		const value = Number(swap.value?.price?.usd);
		if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) continue;
		out.push({ time, value, side: swap.side === 'SELL' ? 'SELL' : 'BUY' });
	}
	return out.sort((a, b) => a.time - b.time);
}

/**
 * Candles spanning the trade, padded so the first and last swap aren't pinned to
 * the edges. Returns null when there is nothing usable to draw — the caller
 * falls back to the procedural background rather than showing an empty chart.
 */
export async function loadTradeChart(trade: CompletedTrade): Promise<TradeChart | null> {
	const markers = swapMarkers(trade);
	if (markers.length === 0) return null;

	const firstSwap = markers[0].time;
	const lastSwap = markers[markers.length - 1].time;
	// A single-swap or same-second trade still needs a window to draw into.
	const span = Math.max(lastSwap - firstSwap, 10);
	const pad = Math.max(Math.round(span * 0.18), 3);
	const from = firstSwap - pad;
	const to = lastSwap + pad;

	const frame = pickCandleFrame(to - from);
	// The address form matters: a pair address pins the series to that pair and
	// stitches in pre-migration history, which is what the trade actually traded.
	const address = trade.bestPairAddress || trade.tokenAddress;

	try {
		const { data } = await api.GET('/v2/token/{chain}/{address}/candles', {
			params: {
				path: { chain: trade.chain as Chain, address },
				query: { timeframe: frame, from, to } as never
			}
		});
		const candles = data?.candles ?? [];
		const points: SparkPoint[] = [];
		for (const candle of candles) {
			const time = Number(candle.time);
			const value = Number(candle.close);
			if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) continue;
			points.push({ time, value });
		}
		if (points.length < 2) return null;
		points.sort((a, b) => a.time - b.time);

		// Candle buckets are floored to the frame, so a marker can land just past
		// the last bucket. Widen the domain so markers stay inside the plot.
		const step = frameSeconds(frame);
		const domainEnd = points[points.length - 1].time + step;
		return {
			points,
			markers: markers.filter((m) => m.time >= points[0].time - step && m.time <= domainEnd),
			frame
		};
	} catch {
		return null;
	}
}
