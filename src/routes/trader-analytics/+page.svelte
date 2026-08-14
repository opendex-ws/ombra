<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Chain, TraderRankItem, TraderRankingResponse, WalletTimeRange } from '$lib/api/types';
	import { openTraderPortfolio } from '$lib/stores/traderAnalytics.svelte';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import TraderRankingFilters from '$lib/components/trader-analytics/TraderRankingFilters.svelte';
	import { TRADER_RANKING_FILTER_KEYS, type TraderRankingFilterKey, type TraderRankingFilterValues } from '$lib/components/trader-analytics/config';
	import TraderRankingTable from '$lib/components/trader-analytics/TraderRankingTable.svelte';
	import TraderRankingCard from '$lib/components/trader-analytics/TraderRankingCard.svelte';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import TrendingUp from 'lucide-svelte/icons/trending-up';

	let { routeActive = true }: { routeActive?: boolean } = $props();

	const validChains: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];
	const validTimeRanges: WalletTimeRange[] = ['ONE_DAY', 'SEVEN_DAY', 'THIRTY_DAY', 'NINETY_DAY'];

	let chain: Chain = $state('SOL');
	let timeRange: WalletTimeRange = $state('ONE_DAY');
	let draftFilters: TraderRankingFilterValues = $state({});
	let appliedFilters: TraderRankingFilterValues = $state({});
	let items: TraderRankItem[] = $state([]);
	let nextCursor: string | undefined = $state(undefined);
	let loading = $state(true);
	let refreshing = $state(false);
	let loadingMore = $state(false);
	const isDesktop = $derived(getIsDesktop());
	let error = $state('');
	let requestGeneration = 0;
	let rankingWsKey: string | null = null;

	function cleanupRankingWs() {
		if (!rankingWsKey) return;
		unsubscribe(rankingWsKey);
		rankingWsKey = null;
	}

	function readUrlState() {
		const params = new URL(window.location.href).searchParams;
		const nextChain = params.get('chain') as Chain | null;
		const nextTimeRange = params.get('timeRange') as WalletTimeRange | null;
		if (nextChain && validChains.includes(nextChain)) chain = nextChain;
		if (nextTimeRange && validTimeRanges.includes(nextTimeRange)) timeRange = nextTimeRange;

		const restored: TraderRankingFilterValues = {};
		for (const key of TRADER_RANKING_FILTER_KEYS) {
			const raw = params.get(key);
			if (raw === null || raw === '') continue;
			const parsed = Number(raw);
			if (Number.isFinite(parsed)) restored[key] = parsed;
		}
		appliedFilters = restored;
		draftFilters = { ...restored };
	}

	function syncUrl() {
		const params = new URLSearchParams();
		if (chain !== 'SOL') params.set('chain', chain);
		if (timeRange !== 'ONE_DAY') params.set('timeRange', timeRange);
		for (const key of TRADER_RANKING_FILTER_KEYS) {
			const value = appliedFilters[key];
			if (value !== undefined) params.set(key, String(value));
		}
		const query = params.toString();
		history.replaceState(history.state, '', query ? `/trader-analytics?${query}` : '/trader-analytics');
	}

	function dedupeTraders(nextItems: TraderRankItem[], existing: TraderRankItem[] = []): TraderRankItem[] {
		const seen = new Set(existing.map((item) => `${item.chain}:${item.walletAddress}`));
		return nextItems.filter((item) => {
			const key = `${item.chain}:${item.walletAddress}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	async function fetchRanking(reset: boolean, opts?: { soft?: boolean }) {
		if (!reset && (!nextCursor || loadingMore)) return;
		const nextChain = chain;
		const nextTimeRange = timeRange;
		const filters = { ...appliedFilters };
		cleanupRankingWs();
		const generation = ++requestGeneration;
		const keepVisible = !!(reset && opts?.soft && items.length > 0);
		if (reset) {
			if (keepVisible) refreshing = true;
			else {
				loading = true;
				items = [];
				nextCursor = undefined;
			}
			error = '';
		} else {
			loadingMore = true;
		}

		try {
			const cursor = reset ? undefined : nextCursor;
			const { data, error: responseError } = await api.GET('/v2/traders/ranking', {
				params: {
					query: {
						chain: nextChain,
						timeRange: nextTimeRange,
						cursor,
						...filters
					}
				}
			});
			if (generation !== requestGeneration) return;
			if (responseError || !data) throw new Error('Unable to load trader rankings.');

			if (reset) {
				items = dedupeTraders(data.items);
			} else {
				items = [...items, ...dedupeTraders(data.items, items)];
			}
			nextCursor = data.nextCursor;
			rankingWsKey = subscribe('traders:ranking', (event, payload, topic) => {
				if (event !== 'TRADER_RANKING' || topic !== 'traders:ranking' || generation !== requestGeneration) return;
				const snapshot = payload as TraderRankingResponse;
				if (!Array.isArray(snapshot?.items)) return;
				items = dedupeTraders(snapshot.items);
				nextCursor = snapshot.nextCursor;
			}, { chain: nextChain, timeRange: nextTimeRange, ...filters, endCursor: data.cursor }, {
				recovery: 'refetch',
				onReconnect: () => { void fetchRanking(true, { soft: true }); }
			});
		} catch (cause) {
			if (generation !== requestGeneration) return;
			error = cause instanceof Error ? cause.message : 'Unable to load trader rankings.';
			if (reset && !keepVisible) {
				items = [];
				nextCursor = undefined;
			}
		} finally {
			if (generation === requestGeneration) {
				loading = false;
				refreshing = false;
				loadingMore = false;
			}
		}
	}

	function changeChain(value: Chain) {
		if (value === chain) return;
		chain = value;
		syncUrl();
		void fetchRanking(true);
	}

	function changeTimeRange(value: WalletTimeRange) {
		if (value === timeRange) return;
		timeRange = value;
		syncUrl();
		void fetchRanking(true);
	}

	function changeDraftFilter(key: TraderRankingFilterKey, value?: number) {
		draftFilters = { ...draftFilters, [key]: value };
	}

	function applyFilters() {
		appliedFilters = Object.fromEntries(
			Object.entries(draftFilters).filter(([, value]) => value !== undefined)
		) as TraderRankingFilterValues;
		syncUrl();
		void fetchRanking(true);
	}

	function resetDraftFilters() {
		draftFilters = {};
	}

	function selectTrader(item: TraderRankItem) {
		openTraderPortfolio({ chain: item.chain, walletAddress: item.walletAddress });
	}

	onMount(() => {
		readUrlState();
		return () => {
			requestGeneration++;
			cleanupRankingWs();
		};
	});

	$effect(() => {
		if (!routeActive) {
			cleanupRankingWs();
			return;
		}
		// Active tab: (re)subscribe. Soft when table already painted.
		untrack(() => {
			if (items.length > 0) void fetchRanking(true, { soft: true });
			else void fetchRanking(true);
		});
	});
</script>

<svelte:head>
	<title>Trader Analytics | OMBRA</title>
</svelte:head>

<div class="flex min-h-[calc(100dvh-48px)] flex-col bg-s0 px-2 pb-24 pt-2 md:px-4 md:pb-9 md:pt-4">
	<div class="mb-3 flex flex-col gap-3">
		<div class="flex items-center justify-between gap-3">
			<div class="flex items-center gap-2.5">
				<div class="flex h-9 w-9 items-center justify-center rounded-xl border border-bd bg-s1 text-grn">
					<TrendingUp class="h-4.5 w-4.5" strokeWidth={1.7} />
				</div>
				<div>
					<h1 class="text-base font-bold text-tx md:text-lg">Trader Analytics</h1>
					<p class="text-[10px] text-g5 md:text-xs">Ranked wallet performance from the trader analytics API</p>
				</div>
			</div>
			<button type="button" class="btn-secondary flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-40" disabled={loading || refreshing} onclick={() => fetchRanking(true, { soft: true })}>
				<RefreshCw class="h-3.5 w-3.5 {loading || refreshing ? 'animate-spin' : ''}" />
				<span class="hidden sm:inline">Refresh</span>
			</button>
		</div>

		<TraderRankingFilters
			{chain}
			{timeRange}
			filters={draftFilters}
			onchainchange={changeChain}
			ontimechange={changeTimeRange}
			onfilterchange={changeDraftFilter}
			onapply={applyFilters}
			onreset={resetDraftFilters}
			appliedFilterCount={Object.values(appliedFilters).filter((value) => value !== undefined).length}
		/>
	</div>

	<div class="min-h-0 flex-1">
		{#if loading}
			<div class="hidden space-y-1 md:block">
				{#each Array(9) as _, index}
					<div class="skeleton h-14 rounded-lg" style="animation-delay: {index * 40}ms"></div>
				{/each}
			</div>
			<div class="space-y-2 md:hidden">
				{#each Array(6) as _, index}
					<div class="skeleton h-32 rounded-xl" style="animation-delay: {index * 50}ms"></div>
				{/each}
			</div>
		{:else if error && items.length === 0}
			<div class="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-bd bg-s1 p-6 text-center">
				<div class="text-sm font-medium text-tx">Trader rankings are unavailable</div>
				<div class="max-w-md text-xs text-g5">{error}</div>
				<button type="button" class="btn-secondary px-4 py-2 text-xs" onclick={() => fetchRanking(true)}>Retry</button>
			</div>
		{:else if items.length === 0}
			<div class="flex min-h-64 items-center justify-center rounded-xl border border-bd bg-s1 text-sm text-g6">No traders match these filters.</div>
		{:else}
			{#if isDesktop}
			<div>
				<TraderRankingTable {items} {timeRange} onselect={selectTrader} />
			</div>
			{:else}
			<div class="space-y-2">
				{#each items as item, index (`${item.chain}:${item.walletAddress}`)}
					<TraderRankingCard {item} rank={index + 1} {timeRange} onselect={selectTrader} />
				{/each}
			</div>
			{/if}

			<div class="flex flex-col items-center gap-2 py-4">
				{#if error}
					<div class="text-xs text-red">{error}</div>
				{/if}
				{#if nextCursor}
					<button
						type="button"
						class="flex cursor-pointer items-center gap-2 rounded-xl border border-bd bg-s4 px-5 py-2 text-xs font-medium text-g7 transition-colors hover:text-tx disabled:opacity-40"
						disabled={loadingMore}
						onclick={() => fetchRanking(false)}
					>
						{#if loadingMore}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{/if}
						{loadingMore ? 'Loading…' : 'Load more traders'}
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
