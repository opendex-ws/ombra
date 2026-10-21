<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import { tokenImage } from '$lib/api/config';
	import type { components } from '$lib/api/v2.d.ts';
	import { subscribe, unsubscribe, updateParams } from '$lib/ws/client';
	import { chainBrandArt } from '$lib/utils/chain-brand';
	import { formatCompactNumber } from '$lib/utils/format';
	import { getRouterInfo } from '$lib/utils/routers';
	import {
		HIGH_PRICE_IMPACT_PCT,
		noRouteMessage,
		routeStops,
		tokenLabel,
		type TradeQuote,
		type TradeQuoteQuery
	} from '$lib/utils/trade-quote';
	import type { Chain } from '$lib/api/types';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';

	let {
		chain,
		tokenAddress,
		tokenSymbol,
		query
	}: {
		chain: string;
		tokenAddress: string;
		tokenSymbol: string;
		/** Null while the form has no usable amount. */
		query: TradeQuoteQuery | null;
	} = $props();

	type TradeQuoteStreamFrame = components['schemas']['TradeQuoteStreamFrame'];

	const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
	function stopImage(address: string): string {
		return (address === NATIVE_SOL && chainBrandArt('SOL')) || tokenImage(chain, address);
	}

	let quote = $state<TradeQuote | null>(null);
	let loading = $state(false);
	let noRoute = $state<string | null>(null);
	/** 404/503: the endpoint is not deployed or the router is down. Render nothing. */
	let unavailable = $state(false);
	let requestId = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function load(q: TradeQuoteQuery, id: number) {
		loading = true;
		try {
			const { data, error, response } = await api.GET('/v2/trade/{chain}/{token}/quote', {
				params: { path: { chain: chain as Chain, token: tokenAddress }, query: q }
			});
			if (id !== requestId) return;
			if (response.status === 404 || response.status === 503) {
				unavailable = true;
				quote = null;
				stopStream();
				return;
			}
			unavailable = false;
			if (response.status === 422) {
				quote = null;
				noRoute = noRouteMessage((error as { error?: string } | undefined)?.error);
				return;
			}
			noRoute = null;
			quote = data ?? null;
		} catch {
			if (id === requestId) quote = null;
		} finally {
			if (id === requestId) loading = false;
		}
	}

	let subKey: string | null = null;
	let subTopic: string | null = null;

	function stopStream() {
		if (subKey) unsubscribe(subKey);
		subKey = null;
		subTopic = null;
	}

	// REST answers first (and tells us the endpoint is missing); the stream then
	// sends a fresh quote every second. A new amount moves the same subscription
	// with `update_params`; a new token needs a new topic.
	function startStream(q: TradeQuoteQuery) {
		const topic = `quote:${chain}:${tokenAddress}`;
		if (subKey && subTopic === topic) {
			updateParams(subKey, { ...q });
			return;
		}
		stopStream();
		subTopic = topic;
		subKey = subscribe(
			topic,
			(event, data) => {
				if (event !== 'TRADE_QUOTE') return;
				const frame = data as TradeQuoteStreamFrame;
				if (frame.quote) {
					quote = frame.quote;
					noRoute = null;
				} else if (frame.error && frame.error.code !== 'SERVICE_UNAVAILABLE') {
					quote = null;
					noRoute = noRouteMessage(frame.error.code);
				}
			},
			{ ...q }
		);
	}

	// Keyed on the request itself, so changing tokens or sides re-quotes and a
	// burst of keystrokes collapses into one call and one resubscribe.
	const key = $derived(query ? `${chain}:${tokenAddress}:${JSON.stringify(query)}` : '');
	$effect(() => {
		const k = key;
		const q = query;
		untrack(() => {
			if (timer) clearTimeout(timer);
			const id = ++requestId;
			if (!k || !q) {
				stopStream();
				quote = null;
				noRoute = null;
				loading = false;
				return;
			}
			timer = setTimeout(() => {
				void load(q, id);
				startStream(q);
			}, 350);
		});
		return () => {
			if (timer) clearTimeout(timer);
		};
	});

	onDestroy(stopStream);

	const symbols = $derived({ [tokenAddress]: tokenSymbol });
	const stops = $derived(quote ? routeStops(quote) : []);
	const outSymbol = $derived(
		quote ? tokenLabel(stops[stops.length - 1] ?? quote.outputToken, symbols) : ''
	);
	const highImpact = $derived((quote?.priceImpactPct ?? 0) >= HIGH_PRICE_IMPACT_PCT);
</script>

{#if !unavailable && query}
	<div class="rounded-lg border border-bd/40 bg-s2 px-2.5 py-1.5 text-[11px]">
		{#if noRoute}
			<span class="text-yel">{noRoute}</span>
		{:else if quote}
			<div class="flex items-center gap-1.5">
				<span class="text-g5">Est. out</span>
				<span class="font-bold tabular-nums text-tx" title={quote.expectedOutStr}>≈ {formatCompactNumber(quote.expectedOutStr)}</span>
				<span class="truncate font-medium text-g7">{outSymbol}</span>
				<span
					class="ml-auto shrink-0 tabular-nums {highImpact ? 'font-semibold text-red' : 'text-g5'}"
					title="Price impact against the pools' spot price (pool fees not included)"
				>
					{quote.priceImpactPct.toFixed(2)}%
				</span>
				{#if loading}<LoaderCircle class="h-3 w-3 shrink-0 animate-spin text-g5" />{/if}
			</div>
			{#if quote.minAmountOutStr !== undefined}
				<div class="mt-0.5 text-[10px] text-g5">
					Min <span class="tabular-nums text-g8" title={quote.minAmountOutStr}>{formatCompactNumber(quote.minAmountOutStr)}</span> after slippage
				</div>
			{/if}
			<!-- Route: one chip per token, carrying the venue icon of the hop that reached it. -->
			<div class="mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-0.5">
				{#each stops as stop, i (i)}
					{@const info = stop.via ? getRouterInfo(stop.via) : null}
					{#if i > 0}<ChevronRight class="h-3 w-3 shrink-0 text-g4" />{/if}
					<span
						class="flex items-center gap-1 rounded bg-s4 py-0.5 pl-0.5 pr-1.5 text-[10px] font-medium text-g8"
						title={info ? `${stop.address} via ${info.name}` : stop.address}
					>
						<span class="relative h-3.5 w-3.5 shrink-0">
							<img
								src={stopImage(stop.address)}
								alt=""
								loading="lazy"
								class="h-3.5 w-3.5 rounded-full bg-s7 object-cover"
								onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
							/>
							{#if info?.icon}
								<img
									src={info.icon}
									alt={info.name}
									class="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-s6 ring-1 ring-s6"
								/>
							{/if}
						</span>
						{tokenLabel(stop, symbols)}
					</span>
				{/each}
				{#if quote.legs.length > 1}
					<span class="ml-1 text-[10px] text-g5">{quote.legs.length} hops</span>
				{/if}
			</div>
		{:else}
			<div class="flex items-center gap-1.5 text-g5">
				<LoaderCircle class="h-3 w-3 animate-spin" /> Getting quote…
			</div>
		{/if}
	</div>
{/if}
