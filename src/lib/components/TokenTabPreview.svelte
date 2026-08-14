<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Chain, CandleFrame } from '$lib/api/types';
	import { formatMarketCap } from '$lib/utils/format';
	import { getCandleMcap, getCandleSeries, setCandleSeries } from '$lib/stores/candleCache.svelte';

	let { chain, address, symbol = '' }: { chain: Chain | string; address: string; symbol?: string } = $props();

	const W = 200;
	const H = 64;

	let loading = $state(true);
	let closes = $state<number[]>([]);
	let mcapStr = $state('');
	let fromCache = $state(false);

	const up = $derived(closes.length >= 2 && closes[closes.length - 1] >= closes[0]);

	const path = $derived.by(() => {
		if (closes.length < 2) return '';
		let min = Infinity;
		let max = -Infinity;
		for (const c of closes) {
			if (c < min) min = c;
			if (c > max) max = c;
		}
		const range = max - min || 1;
		const stepX = W / (closes.length - 1);
		return closes
			.map((c, i) => {
				const x = i * stepX;
				const y = H - 4 - ((c - min) / range) * (H - 8);
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	});

	const areaPath = $derived(path ? `${path} L${W},${H} L0,${H} Z` : '');

	let pollTimer = 0;

	$effect(() => {
		let cancelled = false;
		const cached = getCandleSeries(chain as string, address, '15m', 'marketCap');
		if (cached && cached.closes.length >= 2) {
			closes = cached.closes.slice();
			mcapStr = getCandleMcap(chain as string, address);
			fromCache = true;
			loading = false;
			pollTimer = window.setInterval(() => {
					const c = getCandleSeries(chain as string, address, '15m', 'marketCap');
					if (c) {
						closes = c.closes.slice();
						mcapStr = getCandleMcap(chain as string, address);
				}
			}, 1000);
			return () => { cancelled = true; clearInterval(pollTimer); };
		}
		loading = true;
		fromCache = false;
		(async () => {
			try {
				const { data: res } = await api.GET('/v2/token/{chain}/{address}/candles', {
					params: {
						path: { chain: chain as Chain, address },
						query: { timeframe: '15m' as CandleFrame, count: 96, mode: 'marketCap' }
					}
				});
				if (cancelled) return;
				const candles = (res?.candles ?? []) as any[];
					closes = candles
						.map((c) => (typeof c.close === 'number' ? c.close : parseFloat(c.close)))
						.filter((n) => !isNaN(n));
					setCandleSeries(chain as string, address, '15m', 'marketCap', candles.map((c) => ({
						time: c.time,
						close: typeof c.close === 'number' ? c.close : parseFloat(c.close)
					})).filter((point) => Number.isFinite(point.close)));
				const last = candles[candles.length - 1];
				if (last) mcapStr = last.closeStr ?? '';
			} catch {
				if (!cancelled) closes = [];
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => { cancelled = true; };
	});

	onDestroy(() => clearInterval(pollTimer));
</script>

<div class="pointer-events-none w-[216px] overflow-hidden rounded-lg border border-bd bg-s5 p-2 shadow-2xl backdrop-blur-xl">
	<div class="mb-1.5 flex items-center gap-2">
		<img src={tokenImage(chain, address)} alt="" class="h-4 w-4 rounded-[4px]" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
		<span class="truncate text-xs font-semibold text-tx">{symbol || address.slice(0, 6)}</span>
		{#if mcapStr}
			<span class="ml-auto text-[10px] text-g6">MC {formatMarketCap(mcapStr)}</span>
		{/if}
	</div>
	<div class="relative h-16 w-full">
		{#if loading}
			<div class="flex h-full items-center justify-center text-[10px] text-g5">Loading…</div>
		{:else if closes.length < 2}
			<div class="flex h-full items-center justify-center text-[10px] text-g5">No data</div>
		{:else}
			<svg viewBox="0 0 {W} {H}" class="h-full w-full" preserveAspectRatio="none">
				<defs>
					<linearGradient id="tabspark-{address}" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color={up ? 'var(--t-grn)' : 'var(--t-red)'} stop-opacity="0.25" />
						<stop offset="100%" stop-color={up ? 'var(--t-grn)' : 'var(--t-red)'} stop-opacity="0" />
					</linearGradient>
				</defs>
				<path d={areaPath} fill="url(#tabspark-{address})" />
				<path d={path} fill="none" stroke={up ? 'var(--t-grn)' : 'var(--t-red)'} stroke-width="1.5" vector-effect="non-scaling-stroke" />
			</svg>
		{/if}
	</div>
</div>
