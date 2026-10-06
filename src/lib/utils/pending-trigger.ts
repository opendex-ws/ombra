/**
 * Mirrors `PendingTradeSwapTrigger` / `PendingTradeSwapTriggerValue` from the
 * OpenAPI spec. The committed client predates them, so this pins the shape
 * until the next regen lands; read it from `components['schemas']` then.
 */
type Money = { usd: number; usdStr: string; native: number; nativeStr: string };

export type PendingTrigger =
	| { status: 'AVAILABLE'; value: { price: Money; marketCap: Money } }
	| { status: 'UNAVAILABLE' };

export type DipDetails = {
	dipPct: number;
	/** Absent while the backend has no reference price to measure the dip from. */
	trigger: { price: Money; marketCap: Money } | null;
};

/** A pending buy's dip setup, or null when it is not a dip buy. */
export function dipDetails(pending: unknown): DipDetails | null {
	const strategy = (pending as { strategy?: { type?: string; dipPct?: number; trigger?: PendingTrigger } })
		?.strategy;
	if (strategy?.type !== 'DIP' || typeof strategy.dipPct !== 'number') return null;
	const trigger = strategy.trigger;
	return {
		dipPct: strategy.dipPct,
		trigger: trigger?.status === 'AVAILABLE' ? trigger.value : null
	};
}

/** The first pending dip buy on a trade, which is what the card and modal summarise. */
export function firstDip(pendingSwaps: readonly unknown[] | null | undefined): DipDetails | null {
	for (const p of pendingSwaps ?? []) {
		if ((p as { side?: string })?.side !== 'BUY') continue;
		const d = dipDetails(p);
		if (d) return d;
	}
	return null;
}
