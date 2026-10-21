import type { CandlePoint, RawCandleUpdate } from './candle-updates';

/** How many of the newest bars a soft refetch asks the REST endpoint for. */
export const TAIL_REFETCH_COUNT = 300;
/** A tab hidden for less than this cannot have lost a meaningful number of frames. */
export const TAIL_REFETCH_MIN_HIDDEN_MS = 3000;

/** Identity of the series a request was made for; a mismatch means the response is stale. */
export interface CandleRequestKey {
	id: number;
	chain: string;
	address: string;
	frame: string;
	mode: string;
}

export function isCandleRequestCurrent(request: CandleRequestKey, current: CandleRequestKey): boolean {
	return (
		request.id === current.id &&
		request.chain === current.chain &&
		request.address === current.address &&
		request.frame === current.frame &&
		request.mode === current.mode
	);
}

/** Whether returning to a visible tab warrants refetching the tail. */
export function shouldRefetchAfterHidden(hiddenAt: number | null, now: number, minHiddenMs = TAIL_REFETCH_MIN_HIDDEN_MS): boolean {
	return hiddenAt !== null && now - hiddenAt >= minHiddenMs;
}

function raw(value: number | string): number {
	return typeof value === 'number' ? value : Number.parseFloat(value);
}

/**
 * Picks the refetched bars worth feeding into the live merge: bars the series is
 * missing (gaps), bars whose OHLC differs, and always the newest loaded bar (its
 * volume may have moved). Bars older than the loaded range are left to the
 * pan-left history fetch, and times in `skipTimes` (touched by a live frame while
 * the request was in flight) are never overwritten with the older REST snapshot.
 */
export function selectTailUpdates(
	tail: readonly RawCandleUpdate[],
	candles: readonly CandlePoint[],
	index: ReadonlyMap<number, number>,
	skipTimes: ReadonlySet<number> = new Set()
): RawCandleUpdate[] {
	if (candles.length === 0) return [];
	const first = candles[0].time;
	const lastIndex = candles.length - 1;
	const out: RawCandleUpdate[] = [];
	for (const bar of tail) {
		if (bar.time < first || skipTimes.has(bar.time)) continue;
		const at = index.get(bar.time);
		if (at === undefined) {
			out.push(bar);
			continue;
		}
		const have = candles[at];
		const changed =
			at === lastIndex ||
			have.high !== raw(bar.high) ||
			have.low !== raw(bar.low) ||
			have.close !== raw(bar.close);
		if (changed) out.push(bar);
	}
	return out;
}
