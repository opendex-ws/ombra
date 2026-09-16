<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Chain, TokenSwap } from '$lib/api/types';
	import { isUsd } from '$lib/stores/currency.svelte';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import Pause from 'lucide-svelte/icons/pause';
	import TokenSwapRow from './TokenSwapRow.svelte';

	let {
		liveTrades,
		historicalTrades,
		tradeCount,
		chain,
		filteredMaker = '',
		loadingMore = false,
		onLoadMore,
		onOpenTrader,
		onFilterMaker,
		onhoverpause
	}: {
		liveTrades: TokenSwap[];
		historicalTrades: TokenSwap[];
		tradeCount: number;
		chain: Chain | string;
		filteredMaker?: string;
		loadingMore?: boolean;
		onLoadMore: () => void;
		onOpenTrader: (walletAddress: string) => void;
		onFilterMaker: (walletAddress: string) => void;
		onhoverpause?: (paused: boolean) => void;
	} = $props();

	let hoverPaused = $state(false);
	let pointerInside = false;
	const LIVE_EDGE_PX = 8;

	function fineHover() {
		return typeof window !== 'undefined'
			&& window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	}

	function canHoverPause(event: PointerEvent) {
		return event.pointerType === 'mouse' && fineHover();
	}

	function setHoverPaused(paused: boolean) {
		if (hoverPaused === paused) return;
		hoverPaused = paused;
		onhoverpause?.(paused);
	}

	function syncHoverPause() {
		setHoverPaused(pointerInside && fineHover() && scrollTop > LIVE_EDGE_PX);
	}

	onDestroy(() => {
		pointerInside = false;
		hoverPaused = false;
		onhoverpause?.(false);
	});

	let scrollContainer: HTMLDivElement | null = $state(null);
	let scrollTop = $state(0);
	let viewportHeight = $state(600);
	let desktop = $derived(getIsDesktop());
	let rowHeight = $derived(desktop ? 33 : 52);
	let headerHeight = $derived(desktop ? 27 : 0);
	const OVERSCAN = 6;
	const LOAD_MORE_THRESHOLD = 160;
	let listScrollTop = $derived(Math.max(0, scrollTop - headerHeight));
	let startIndex = $derived(Math.max(0, Math.floor(listScrollTop / rowHeight) - OVERSCAN));
	let visibleCount = $derived(Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2);
	let endIndex = $derived(Math.min(tradeCount, startIndex + visibleCount));
	let offsetY = $derived(startIndex * rowHeight);
	let totalHeight = $derived(tradeCount * rowHeight);
	let visibleTrades = $derived.by(() => {
		const rows: TokenSwap[] = [];
		for (let i = startIndex; i < endIndex; i++) {
			const trade = i < liveTrades.length ? liveTrades[i] : historicalTrades[i - liveTrades.length];
			if (trade) rows.push(trade);
		}
		return rows;
	});

	function onScroll() {
		if (!scrollContainer) return;
		scrollTop = scrollContainer.scrollTop;
		syncHoverPause();
		if (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < LOAD_MORE_THRESHOLD) onLoadMore();
	}

	$effect(() => {
		if (!scrollContainer) return;
		const observer = new ResizeObserver(([entry]) => {
			viewportHeight = entry.contentRect.height;
		});
		observer.observe(scrollContainer);
		return () => observer.disconnect();
	});
</script>

<div
	role="presentation"
	class="relative h-full min-h-0"
	onpointerenter={(event) => { if (canHoverPause(event)) { pointerInside = true; syncHoverPause(); } }}
	onpointerleave={() => { pointerInside = false; setHoverPaused(false); }}
>
	{#if hoverPaused}
		<div class="pointer-events-none absolute right-2 z-30 flex items-center gap-1 rounded-md border border-yel/40 bg-s0/90 px-1.5 py-px text-[10px] font-semibold text-yel shadow-md {desktop ? 'top-8' : 'top-1'}">
			<Pause class="h-3 w-3" fill="currentColor" />
			Paused
		</div>
	{/if}
	<div bind:this={scrollContainer} class="h-full min-h-0 overflow-auto overscroll-none" onscroll={onScroll}>
	{#if desktop}
		<div class="sticky top-0 z-10 grid h-[27px] grid-cols-[minmax(70px,1fr)_minmax(70px,1fr)_minmax(70px,1fr)_minmax(60px,1fr)_minmax(90px,1.2fr)_minmax(60px,0.9fr)_minmax(60px,0.9fr)_minmax(50px,0.8fr)] items-center gap-2 border-b border-bd bg-s0 px-1 text-xs font-medium uppercase tracking-wider text-g7">
			<span class="text-left">Type</span>
			<span class="text-right">Price</span>
			<span class="text-right">{isUsd() ? 'USD' : 'Value'}</span>
			<span class="text-right">Tokens</span>
			<span class="text-right">Maker</span>
			<span class="text-right">Fees</span>
			<span class="text-right">Tx</span>
			<span class="text-right">Time</span>
		</div>
	{/if}
	<div class="relative" style:height="{totalHeight}px">
		<div class="absolute inset-x-0 top-0" style:transform="translateY({offsetY}px)">
			{#each visibleTrades as trade (trade.id || trade.txHash)}
				<TokenSwapRow {trade} {chain} mobile={!desktop} {filteredMaker} {onOpenTrader} {onFilterMaker} />
			{/each}
		</div>
		{#if loadingMore}
			<div class="absolute inset-x-0 bottom-0 flex h-10 items-center justify-center gap-2 bg-s0/90">
				<LoaderCircle class="h-4 w-4 animate-spin text-g7" />
				<span class="text-xs text-g6">Loading more...</span>
			</div>
		{/if}
	</div>
	</div>
</div>
