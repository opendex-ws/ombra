import { subscribe, unsubscribe } from '$lib/ws/client';
import { formatUsd } from '$lib/utils/format';

type PegPrices = Record<string, string>;
type PegPriceValue = {
	priceUsd?: number;
	priceUsdStr?: string;
	sourceGeneration?: number;
	sourceTimestampMs?: number;
};

function safeSourceNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

let prices = $state<PegPrices>({});
let prevDisplay = $state<Record<string, string>>({});
let flashes = $state<Record<string, 'up' | 'down'>>({});
let lastUpdatedAtMs = $state<Record<string, number>>({});
let lastSourceGeneration = $state<Record<string, number>>({});
let lastSourceTimestampMs = $state<Record<string, number>>({});
let timers: Record<string, ReturnType<typeof setTimeout>> = {};
let wsKey: string | null = null;

export function getPegPrices(): PegPrices {
	return prices;
}

export function getPegFlash(chain: string): string {
	const f = flashes[chain];
	if (!f) return '';
	return f === 'up' ? 'flash-up' : 'flash-down';
}

export function getPegLastUpdatedAt(chain: string): number | undefined {
	return lastUpdatedAtMs[chain];
}

export function getPegAgeMs(chain: string, now = Date.now()): number | undefined {
	const updatedAt = getPegLastUpdatedAt(chain);
	return updatedAt === undefined ? undefined : Math.max(0, now - updatedAt);
}

export function startPegPrices() {
	if (wsKey) return;
	wsKey = subscribe('peg-prices', (event, data) => {
		if (event !== 'PEG_PRICES') return;
		if (!data || typeof data !== 'object') return;
		const incoming = (data as { prices?: Record<string, unknown> }).prices ?? (data as Record<string, unknown>);
		const updated: PegPrices = {};
		const acceptedChains = new Set<string>();
		const nextGenerations: Record<string, number> = {};
		const nextTimestamps: Record<string, number> = {};
		for (const [chain, val] of Object.entries(incoming)) {
			const value = typeof val === 'object' && val !== null ? (val as PegPriceValue) : undefined;
			const price =
				typeof value?.priceUsdStr === 'string'
					? value.priceUsdStr
					: typeof value?.priceUsd === 'number'
						? String(value.priceUsd)
						: String(val);
			updated[chain] = price;
			const newDisplay = formatUsd(price);
			const oldDisplay = prevDisplay[chain];
			if (oldDisplay && newDisplay !== oldDisplay) {
				const oldNum = parseFloat(prices[chain] ?? '0');
				const newNum = parseFloat(price);
				const dir = newNum > oldNum ? 'up' : 'down';
				flashes = { ...flashes, [chain]: dir };
				clearTimeout(timers[chain]);
				timers[chain] = setTimeout(() => {
					const { [chain]: _, ...rest } = flashes;
					flashes = rest;
				}, 800);
			}
			prevDisplay[chain] = newDisplay;

			const sourceGeneration = safeSourceNumber(value?.sourceGeneration);
			const sourceTimestampMs = safeSourceNumber(value?.sourceTimestampMs);
			const generationAdvanced =
				sourceGeneration !== undefined &&
				(lastSourceGeneration[chain] === undefined || sourceGeneration > lastSourceGeneration[chain]);
			const timestampAdvanced =
				sourceTimestampMs !== undefined &&
				(lastSourceTimestampMs[chain] === undefined || sourceTimestampMs > lastSourceTimestampMs[chain]);
			if (generationAdvanced || timestampAdvanced) acceptedChains.add(chain);
			if (generationAdvanced) nextGenerations[chain] = sourceGeneration;
			if (timestampAdvanced) nextTimestamps[chain] = sourceTimestampMs;
		}
		prices = { ...prices, ...updated };
		if (acceptedChains.size > 0) {
			const acceptedAt = Date.now();
			lastUpdatedAtMs = {
				...lastUpdatedAtMs,
				...Object.fromEntries([...acceptedChains].map((chain) => [chain, acceptedAt]))
			};
		}
		if (Object.keys(nextGenerations).length > 0) {
			lastSourceGeneration = { ...lastSourceGeneration, ...nextGenerations };
		}
		if (Object.keys(nextTimestamps).length > 0) {
			lastSourceTimestampMs = { ...lastSourceTimestampMs, ...nextTimestamps };
		}
	});
}

export function stopPegPrices() {
	if (wsKey) {
		unsubscribe(wsKey);
		wsKey = null;
	}
}
