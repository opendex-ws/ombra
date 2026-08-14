<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import type { CandleFrame, Chain, TokenTimeRange, TraderTokenSwapEntry } from '$lib/api/types';
	import { getTheme, getThemeVersion, tc } from '$lib/stores/theme.svelte';
	import { formatPriceText } from '$lib/utils/format';
	import { SwapPrimitive, type SwapIndicatorData } from '$lib/utils/chart-primitives';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';

	let { chain, address, timeRange, swaps }: { chain: Chain; address: string; timeRange: TokenTimeRange; swaps: TraderTokenSwapEntry[] } = $props();

	let chartContainer: HTMLDivElement;
	let chart: any = null;
	let candleSeries: any = null;
	let swapPrimitive: SwapPrimitive | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let candleTimes: number[] = [];
	let ready = $state(false);
	let loading = $state(true);
	let error = $state('');
	let requestGeneration = 0;
	let disposed = false;

	const frames: Record<TokenTimeRange, CandleFrame> = {
		ONE_HOUR: '1m',
		ONE_DAY: '5m',
		NINETY_DAY: '6h'
	};
	const candleCounts: Record<TokenTimeRange, number> = {
		ONE_HOUR: 60,
		ONE_DAY: 288,
		NINETY_DAY: 360
	};

	function nearestCandleTime(timestamp: number): number | undefined {
		if (candleTimes.length === 0) return undefined;
		const seconds = Math.floor(timestamp / 1000);
		let left = 0;
		let right = candleTimes.length - 1;
		while (left <= right) {
			const middle = Math.floor((left + right) / 2);
			if (candleTimes[middle] <= seconds) left = middle + 1;
			else right = middle - 1;
		}
		return right < 0 ? undefined : candleTimes[right];
	}

	let storedCandles: { time: number; open: number; high: number; low: number; close: number }[] = [];

	function buildSwapData(): SwapIndicatorData[] {
		if (swaps.length === 0 || candleTimes.length === 0) return [];
		const candleMap = new Map(storedCandles.map(c => [c.time, c]));
		const bucketSize = Math.max(1, Math.floor(candleTimes.length > 1 ? (candleTimes[candleTimes.length - 1] - candleTimes[0]) / 20 : 300));
		const grouped = new Map<string, { time: number; isBuy: boolean; swaps: { side: string; usd: number }[] }>();
		for (const swap of swaps) {
			const time = nearestCandleTime(swap.timestamp);
			if (time === undefined) continue;
			const bucket = Math.floor(time / bucketSize) * bucketSize;
			const isBuy = swap.side === 'BUY';
			const key = `${bucket}:${isBuy}`;
			const existing = grouped.get(key);
			if (existing) {
				existing.swaps.push({ side: swap.side, usd: swap.amountUsd });
				if (time > existing.time) existing.time = time;
			} else {
				grouped.set(key, { time, isBuy, swaps: [{ side: swap.side, usd: swap.amountUsd }] });
			}
		}
		return [...grouped.values()].map(g => {
			const snappedTime = nearestCandleTime(g.time * 1000) ?? g.time;
			const candle = candleMap.get(snappedTime);
			const price = candle
				? (g.isBuy ? Math.min(candle.low, candle.open, candle.close) : Math.max(candle.high, candle.open, candle.close))
				: 0;
			return { time: snappedTime, price, isBuy: g.isBuy, swaps: g.swaps };
		}).filter(d => d.price > 0);
	}

	function updateMarkers() {
		if (!swapPrimitive) return;
		swapPrimitive.setData(buildSwapData());
	}

	function applyTheme() {
		if (!chart || !candleSeries) return;
		const green = tc('--t-grn');
		const red = tc('--t-red');
		chart.applyOptions({
			layout: { background: { color: tc('--t-s4') }, textColor: tc('--t-g7') },
			grid: { vertLines: { color: tc('--t-s8') }, horzLines: { color: tc('--t-s8') } },
			timeScale: { borderColor: tc('--t-bd2') },
			rightPriceScale: { borderColor: tc('--t-bd2') }
		});
		candleSeries.applyOptions({
			upColor: green,
			downColor: red,
			borderUpColor: green,
			borderDownColor: red,
			wickUpColor: green,
			wickDownColor: red
		});
		updateMarkers();
	}

	async function loadCandles(nextChain: Chain, nextAddress: string, range: TokenTimeRange) {
		if (!ready) return;
		const generation = ++requestGeneration;
		loading = true;
		error = '';
		try {
			const { data, error: responseError } = await api.GET('/v2/token/{chain}/{address}/candles', {
				params: {
					path: { chain: nextChain, address: nextAddress },
					query: { timeframe: frames[range], mode: 'price', count: candleCounts[range] }
				}
			});
			if (generation !== requestGeneration || disposed) return;
			if (responseError || !data) throw new Error('Unable to load token price history.');
			candleTimes = data.candles.map((candle) => candle.time);
			storedCandles = data.candles.map((candle) => ({
				time: candle.time,
				open: candle.open,
				high: candle.high,
				low: candle.low,
				close: candle.close
			}));
			candleSeries.setData(storedCandles);
			updateMarkers();
			chart.timeScale().fitContent();
			if (data.candles.length === 0) error = 'No price history is available for this range.';
		} catch (cause) {
			if (generation !== requestGeneration || disposed) return;
			candleTimes = [];
			candleSeries?.setData([]);
			error = cause instanceof Error ? cause.message : 'Unable to load token price history.';
		} finally {
			if (generation === requestGeneration && !disposed) loading = false;
		}
	}

	onMount(() => {
		void (async () => {
			const library = await import('lightweight-charts');
			if (disposed) return;
			chart = library.createChart(chartContainer, {
				width: chartContainer.clientWidth,
				height: 240,
				layout: { background: { color: tc('--t-s4') }, textColor: tc('--t-g7'), fontFamily: 'monospace' },
				grid: { vertLines: { color: tc('--t-s8') }, horzLines: { color: tc('--t-s8') } },
				crosshair: { mode: 0 },
				timeScale: { borderColor: tc('--t-bd2'), timeVisible: true, secondsVisible: false },
				rightPriceScale: { borderColor: tc('--t-bd2') },
				localization: { priceFormatter: (price: number) => formatPriceText(price).replace('$', '') }
			});
			candleSeries = chart.addSeries(library.CandlestickSeries, {
				upColor: tc('--t-grn'),
				downColor: tc('--t-red'),
				borderUpColor: tc('--t-grn'),
				borderDownColor: tc('--t-red'),
				wickUpColor: tc('--t-grn'),
				wickDownColor: tc('--t-red'),
				priceFormat: { type: 'custom', formatter: (price: number) => formatPriceText(price).replace('$', ''), minMove: 1e-20 }
			});
			swapPrimitive = new SwapPrimitive();
			candleSeries.attachPrimitive(swapPrimitive);
			resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) chart?.applyOptions({ width: entry.contentRect.width });
			});
			resizeObserver.observe(chartContainer);
			ready = true;
		})();

		return () => {
			disposed = true;
			requestGeneration++;
			resizeObserver?.disconnect();
			chart?.remove();
			chart = null;
			candleSeries = null;
			swapPrimitive = null;
		};
	});

	$effect(() => {
		const nextChain = chain;
		const nextAddress = address;
		const nextRange = timeRange;
		if (ready) void loadCandles(nextChain, nextAddress, nextRange);
	});

	$effect(() => {
		void swaps;
		if (ready) updateMarkers();
	});

	$effect(() => {
		getTheme();
		getThemeVersion();
		if (ready) applyTheme();
	});
</script>

<div class="relative overflow-hidden rounded-xl border border-bd bg-s4">
	<div bind:this={chartContainer} class="h-[240px] w-full"></div>
	{#if loading}
		<div class="absolute inset-0 flex items-center justify-center bg-s4/90 text-g5"><LoaderCircle class="h-5 w-5 animate-spin" /></div>
	{:else if error}
		<div class="absolute inset-0 flex items-center justify-center bg-s4/90 px-6 text-center text-xs text-g5">{error}</div>
	{/if}
</div>
