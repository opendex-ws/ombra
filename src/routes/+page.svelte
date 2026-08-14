<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/stores';
	import { portal } from '$lib/actions/portal';
	import type { Chain, TokenSnapshot } from '$lib/api/types';
	import TokenDetail from '$lib/components/TokenDetail.svelte';
	import TokenStats from '$lib/components/TokenStats.svelte';
	import TradePanel from '$lib/components/TradePanel.svelte';
	import PositionsPanel from '$lib/components/PositionsPanel.svelte';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import Heart from 'lucide-svelte/icons/heart';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { getFavourites, updateFavouritePrice } from '$lib/stores/settings.svelte';
	import { formatMarketCap, formatPrice, formatPriceText } from '$lib/utils/format';
	import { setActiveToken, getMultiTab, getTradePanelPopout, setTradePanelPopout } from '$lib/stores/feSettings.svelte';
	import { getTokenTabs, openTokenTab, closeTokenTab, updateTabSymbol, popoutToken, type TokenTab } from '$lib/stores/tokenTabs.svelte';
	import { goto } from '$app/navigation';
	import X from 'lucide-svelte/icons/x';
	import PictureInPicture2 from 'lucide-svelte/icons/picture-in-picture-2';
	import TokenTabPreview from '$lib/components/TokenTabPreview.svelte';

	let { routeActive = true }: { routeActive?: boolean } = $props();

	const DEFAULT_CHAIN: Chain = 'SOL';
	const DEFAULT_ADDRESS = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
	const VALID_CHAINS: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];

	function getInitialChain(): Chain {
		const p = $page.url.searchParams.get('chain')?.toUpperCase();
		return (p && VALID_CHAINS.includes(p as Chain)) ? p as Chain : DEFAULT_CHAIN;
	}

	function getInitialAddress(): string {
		return $page.url.searchParams.get('token') || DEFAULT_ADDRESS;
	}

	let selectedChain: Chain = $state(getInitialChain());
	let selectedAddress: string = $state(getInitialAddress());
	let tokenSymbol: string = $state('');
	let currentToken: TokenSnapshot | null = $state(null);
	let tabTokenData = $state<Record<string, TokenSnapshot | null>>({});
	let visitedTabs = $state<Record<string, boolean>>({});
	let tabInactiveSince = $state<Record<string, number>>({});
	const TAB_IDLE_EVICT_MS = 60_000;
	let tickerEl: HTMLDivElement | null = $state(null);
	let tickerInner: HTMLDivElement | null = $state(null);
	let favPriceWsKeys: string[] = [];

	let tickerOffset = 0;
	let tickerSpeed = 0.5;
	let tickerRafId = 0;
	let tickerHovered = false;
	let tickerDragActive = $state(false);
	let tickerDragStartX = 0;
	let tickerDragStartOffset = 0;
	let tickerDragMoved = false;
	let tickerScroll = $state(false);
	const tickerFavCount = $derived(getIsLoggedIn() ? getFavourites().length : 0);

	function tickerPeriodPx(): number {
		if (!tickerInner) return 0;
		const kids = tickerInner.children;
		if (tickerFavCount > 0 && kids.length >= 2 * tickerFavCount) {
			return (kids[tickerFavCount] as HTMLElement).offsetLeft - (kids[0] as HTMLElement).offsetLeft;
		}
		return 0;
	}

	let mobileTradeOpen = $state(false);
	let viewportReady = $state(false);
	let isDesktop = $state(false);

	let sheetDragY = $state(0);
	let sheetDragging = $state(false);
	let sheetStartY = 0;

	onMount(() => {
		const query = window.matchMedia('(min-width: 768px)');
		const syncViewport = () => {
			isDesktop = query.matches;
			viewportReady = true;
		};
		syncViewport();
		query.addEventListener('change', syncViewport);
		const openTrade = () => { mobileTradeOpen = true; };
		window.addEventListener('mobile-trade-open', openTrade);
		return () => { query.removeEventListener('change', syncViewport); window.removeEventListener('mobile-trade-open', openTrade); };
	});

	function onSheetTouchStart(e: TouchEvent) {
		sheetDragging = true;
		sheetStartY = e.touches[0].clientY;
		sheetDragY = 0;
	}

	function onSheetTouchMove(e: TouchEvent) {
		if (!sheetDragging) return;
		const dy = e.touches[0].clientY - sheetStartY;
		sheetDragY = Math.max(0, dy);
	}

	function onSheetTouchEnd(_e: TouchEvent, closeFn: () => void) {
		sheetDragging = false;
		if (sheetDragY > 100) {
			closeFn();
			setTimeout(() => { sheetDragY = 0; }, 250);
		} else {
			sheetDragY = 0;
		}
	}

	let tickerLastTs = 0;
	let tickerLastPeriod = 0;

	function tickerLoop(ts: number) {
		const dt = tickerLastTs > 0 ? Math.min(ts - tickerLastTs, 100) : 16.7;
		tickerLastTs = ts;
		if (tickerInner && tickerEl) {
			const period = tickerPeriodPx();
			const singleW = period > 0 ? period : tickerInner.offsetWidth;
			const needScroll = singleW > tickerEl.clientWidth;
			if (needScroll !== tickerScroll) tickerScroll = needScroll;

			if (!needScroll) {
				if (tickerOffset !== 0) {
					tickerOffset = 0;
					tickerInner.style.transform = 'translate3d(0, 0, 0)';
				}
				tickerLastPeriod = 0;
			} else {
				if (period > 0 && tickerLastPeriod > 0 && period !== tickerLastPeriod) {
					tickerOffset = tickerOffset * (period / tickerLastPeriod);
				}
				if (period > 0) tickerLastPeriod = period;
				if (!tickerHovered && !tickerDragActive) {
					tickerOffset += tickerSpeed * (dt / 16.7);
				}
				if (period > 0) {
					tickerOffset = ((tickerOffset % period) + period) % period;
				}
				tickerInner.style.transform = `translate3d(${-tickerOffset}px, 0, 0)`;
			}
		}
		tickerRafId = requestAnimationFrame(tickerLoop);
	}

	function tickerMouseDown(e: MouseEvent) {
		tickerDragActive = true;
		tickerDragMoved = false;
		tickerDragStartX = e.clientX;
		tickerDragStartOffset = tickerOffset;
		window.addEventListener('mousemove', tickerMouseMove);
		window.addEventListener('mouseup', tickerMouseUp);
	}

	function tickerMouseMove(e: MouseEvent) {
		if (!tickerDragActive) return;
		const dx = e.clientX - tickerDragStartX;
		if (Math.abs(dx) > 3) tickerDragMoved = true;
		tickerOffset = tickerDragStartOffset - dx;
		const period = tickerPeriodPx();
		if (period > 0) {
			tickerOffset = ((tickerOffset % period) + period) % period;
		}
	}

	function tickerMouseUp() {
		tickerDragActive = false;
		window.removeEventListener('mousemove', tickerMouseMove);
		window.removeEventListener('mouseup', tickerMouseUp);
		if (tickerDragMoved) {
			setTimeout(() => { tickerDragMoved = false; }, 0);
		}
	}

	function startTicker() {
		if (!tickerRafId) tickerRafId = requestAnimationFrame(tickerLoop);
	}

	function stopTicker() {
		if (tickerRafId) {
			cancelAnimationFrame(tickerRafId);
			tickerRafId = 0;
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', tickerMouseMove);
			window.removeEventListener('mouseup', tickerMouseUp);
		}
	}

	$effect(() => {
		if (!routeActive) return;
		const params = $page.url.searchParams;
		const qChain = params.get('chain')?.toUpperCase();
		const qToken = params.get('token');
		if (qChain && VALID_CHAINS.includes(qChain as Chain) && qToken) {
			selectedChain = qChain as Chain;
			selectedAddress = qToken;
		}
		setActiveToken(selectedAddress);
		if (getMultiTab() && `${selectedChain}:${selectedAddress}` !== suppressReopenKey) {
			openTokenTab(selectedChain, selectedAddress);
		}
	});

	let favIdKey = $derived(
		getIsLoggedIn()
			? getFavourites().map(f => `${f.token.chain}:${f.token.address}`).join(',')
			: ''
	);

	function cleanupFavPriceWs() {
		favPriceWsKeys.forEach(k => unsubscribe(k));
		favPriceWsKeys = [];
	}

	$effect(() => {
		if (!routeActive) {
			cleanupFavPriceWs();
			return;
		}
		const idKey = favIdKey;
		cleanupFavPriceWs();
		if (!idKey) return;

		const pairs = idKey.split(',');
		const keys: string[] = [];
		for (const pair of pairs) {
			const [chain, address] = pair.split(':');
			const topic = `token:${chain}:${address}:price`;
			const key = subscribe(topic, (event, data) => {
				if (event !== 'TOKEN_PRICE') return;
				const priceUsd = data?.quote?.priceUsd ?? data?.price?.usd ?? data?.price;
				const marketCap = data?.quote?.marketCapUsd ?? data?.marketCap;
				if (priceUsd || marketCap) {
					updateFavouritePrice(chain as Chain, address, priceUsd, marketCap);
				}
			});
			keys.push(key);
		}
		favPriceWsKeys = keys;

		return () => cleanupFavPriceWs();
	});

	$effect(() => {
		if (!routeActive || !tickerInner) {
			stopTicker();
			return;
		}
		startTicker();
		return () => stopTicker();
	});

	$effect(() => {
		if (!routeActive) {
			mobileTradeOpen = false;
			if (getTradePanelPopout()) setTradePanelPopout(false);
			return;
		}
	});

	$effect(() => {
		if (!routeActive) return;
		const token = currentToken;
		if (!token) {
			document.title = 'OMBRA';
			return;
		}
		if (token.tokenAddress !== selectedAddress) return;
		const symbol = token.tokenSymbol ?? '???';
		if (getMultiTab() && token.tokenSymbol) updateTabSymbol(selectedChain, selectedAddress, token.tokenSymbol);
		const price = formatPriceText(token.quote.priceUsdStr);
		const diff = token.stats.timeframes['1h'].priceChangePct;
		const arrow = diff > 0 ? '↗' : diff < 0 ? '↘' : '→';
		const pct = diff > 0 ? `+${diff.toFixed(2)}%` : `${diff.toFixed(2)}%`;
		const mc = formatMarketCap(token.quote.marketCapUsdStr);
		document.title = `${arrow} ${symbol} ${price} (${pct}) MC ${mc} | OMBRA`;
	});

	const multiTabActive = $derived(getMultiTab() && isDesktop && getTokenTabs().length > 0);

	const activeTabKey = $derived(`${selectedChain}:${selectedAddress}`);

	let prevActiveKey = '';

	$effect(() => {
		if (!multiTabActive) return;
		const key = activeTabKey;
		untrack(() => {
			if (!(key in tabTokenData)) tabTokenData[key] = null;
			if (!visitedTabs[key]) visitedTabs[key] = true;
			if (key in tabInactiveSince) delete tabInactiveSince[key];
			if (prevActiveKey && prevActiveKey !== key) {
				tabInactiveSince[prevActiveKey] = Date.now();
			}
			prevActiveKey = key;
		});
	});

	$effect(() => {
		if (!multiTabActive) return;
		const key = activeTabKey;
		const data = tabTokenData[key] ?? null;
		untrack(() => {
			if (data !== currentToken) currentToken = data;
		});
	});

	$effect(() => {
		const openKeys = getTokenTabs().map((t) => `${t.chain}:${t.address}`);
		untrack(() => {
			const open = new Set(openKeys);
			for (const k of openKeys) {
				if (!(k in tabTokenData)) tabTokenData[k] = null;
			}
			for (const k of Object.keys(tabTokenData)) {
				if (!open.has(k)) delete tabTokenData[k];
			}
			for (const k of Object.keys(visitedTabs)) {
				if (!open.has(k)) delete visitedTabs[k];
			}
			for (const k of Object.keys(tabInactiveSince)) {
				if (!open.has(k)) delete tabInactiveSince[k];
			}
		});
	});

	function evictIdleTabs() {
		const now = Date.now();
		for (const k of Object.keys(tabInactiveSince)) {
			if (k === activeTabKey) continue;
			if (now - tabInactiveSince[k] >= TAB_IDLE_EVICT_MS) {
				delete visitedTabs[k];
				tabTokenData[k] = null;
				delete tabInactiveSince[k];
			}
		}
	}

	$effect(() => {
		if (!multiTabActive) return;
		const id = window.setInterval(evictIdleTabs, 10_000);
		return () => clearInterval(id);
	});

	let hoverTab = $state<TokenTab | null>(null);
	let hoverX = $state(0);
	let hoverY = $state(0);
	let hoverTimer = 0;

	function onTabEnter(e: MouseEvent, tab: TokenTab) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		hoverX = Math.min(rect.left, window.innerWidth - 224);
		hoverY = rect.bottom + 4;
		clearTimeout(hoverTimer);
		hoverTimer = window.setTimeout(() => { hoverTab = tab; }, 350);
	}

	function onTabLeave() {
		clearTimeout(hoverTimer);
		hoverTab = null;
	}

	function selectTab(tab: TokenTab) {
		if (tab.chain === selectedChain && tab.address === selectedAddress) return;
		goto(`/?chain=${tab.chain}&token=${tab.address}`);
	}

	let suppressReopenKey = $state<string | null>(null);

	$effect(() => {
		if (suppressReopenKey && `${selectedChain}:${selectedAddress}` !== suppressReopenKey) {
			suppressReopenKey = null;
		}
	});

	function handlePopoutTab(e: MouseEvent, tab: TokenTab) {
		e.preventDefault();
		e.stopPropagation();
		onTabLeave();

		const key = `${tab.chain}:${tab.address}`;
		const tabs = getTokenTabs();
		const idx = tabs.findIndex((t) => t.chain === tab.chain && t.address === tab.address);
		const wasActive = tab.chain === selectedChain && tab.address === selectedAddress;

		suppressReopenKey = key;
		popoutToken(tab.chain, tab.address, tab.symbol);
		closeTokenTab(tab.chain, tab.address);

		const remaining = getTokenTabs();
		if (wasActive && remaining.length > 0) {
			const next = remaining[Math.min(idx, remaining.length - 1)];
			goto(`/?chain=${next.chain}&token=${next.address}`);
		}
	}

	function handleCloseTab(e: MouseEvent, tab: TokenTab) {
		e.preventDefault();
		e.stopPropagation();
		onTabLeave();
		const tabs = getTokenTabs();
		const idx = tabs.findIndex((t) => t.chain === tab.chain && t.address === tab.address);
		const wasActive = tab.chain === selectedChain && tab.address === selectedAddress;
		suppressReopenKey = `${tab.chain}:${tab.address}`;
		closeTokenTab(tab.chain, tab.address);
		if (wasActive) {
			const remaining = getTokenTabs();
			if (remaining.length > 0) {
				const next = remaining[Math.min(idx, remaining.length - 1)];
				goto(`/?chain=${next.chain}&token=${next.address}`);
			}
		}
	}

	onDestroy(() => {
		cleanupFavPriceWs();
		stopTicker();
		setActiveToken('');
		if (typeof document !== 'undefined') document.title = 'OMBRA';
	});
</script>

{#if viewportReady}
	{#if isDesktop}
		<div class="flex h-[calc(100dvh-48px-28px)]">
			<div class="glass flex flex-1 flex-col overflow-hidden bg-s0">
				{#if getIsLoggedIn() && getFavourites().length > 0}
					{@const favs = getFavourites()}
				<div
					bind:this={tickerEl}
					class="shrink-0 overflow-hidden border-b border-bd bg-transparent select-none {tickerDragActive ? 'cursor-grabbing' : tickerScroll ? 'cursor-grab' : ''}"
					role="toolbar"
					aria-label="Favourite tokens"
					tabindex="-1"
					onmouseenter={() => { tickerHovered = true; }}
					onmouseleave={() => { tickerHovered = false; }}
					onmousedown={(e) => { if (tickerScroll) tickerMouseDown(e); }}
				>
						<div
							bind:this={tickerInner}
							class="flex w-max items-center gap-4 whitespace-nowrap px-4 py-1.5 tabular-nums"
							style="will-change: transform; backface-visibility: hidden;"
						>
							{#each tickerScroll ? [...favs, ...favs] : favs as fav, i (fav.token.chain + ':' + fav.token.address + ':' + (i >= favs.length ? 'dup' : 'orig'))}
								<a
									href="/?chain={fav.token.chain}&token={fav.token.address}"
									onclick={(e: MouseEvent) => { if (tickerDragMoved) { e.preventDefault(); return; } }}
									class="relative flex shrink-0 items-center gap-2 rounded-md px-2 py-0.5 text-xs transition-colors hover:bg-s7"
									draggable="false"
								>
									<img src={tokenImage(fav.token.chain, fav.token.address)} alt="" class="h-4 w-4 rounded-[4px]" draggable="false" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
									<span class="font-medium text-g11">{fav.token.symbol ?? fav.token.address.slice(0, 6)}</span>
									<Heart class="h-2.5 w-2.5 text-pnk" fill="var(--t-pnk)" />
									<span class="inline-block min-w-[72px] text-grn">{@html formatPrice(fav.priceUsdStr)}</span>
									<span class="inline-block min-w-[56px] text-g5">{formatMarketCap(fav.marketCapUsdStr)}</span>
									{#if fav.token.address === selectedAddress}
										<div class="absolute bottom-0 left-1/4 h-[2px] w-1/2 rounded-full bg-grn"></div>
									{/if}
								</a>
							{/each}
						</div>
					</div>
				{/if}
				{#if multiTabActive}
					<div class="flex shrink-0 items-stretch overflow-x-auto border-b border-bd bg-transparent">
						{#each getTokenTabs() as tab (tab.chain + ':' + tab.address)}
							{@const active = tab.chain === selectedChain && tab.address === selectedAddress}
							<button
								onclick={() => selectTab(tab)}
								onmouseenter={(e: MouseEvent) => onTabEnter(e, tab)}
								onmouseleave={onTabLeave}
								class="group relative flex min-w-0 max-w-[12rem] shrink-0 cursor-pointer items-center gap-2 border-r border-bd px-3 py-2 text-xs transition-colors {active ? 'bg-s2 text-tx' : 'text-g6 hover:bg-wh/5 hover:text-g9'}"
							>
								{#if active}
									<div class="absolute inset-x-0 top-0 h-[2px] bg-grn"></div>
								{/if}
								<img src={tokenImage(tab.chain, tab.address)} alt="" class="h-4 w-4 shrink-0 rounded-[4px] {active ? '' : 'opacity-70 group-hover:opacity-100'}" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
								<span class="truncate {active ? 'font-semibold' : 'font-medium'}">{tab.symbol || tab.address.slice(0, 4)}</span>
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<span
									role="button"
									tabindex="-1"
									onclick={(e: MouseEvent) => handlePopoutTab(e, tab)}
									class="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-g5 transition-colors hover:bg-s7 hover:text-tx opacity-0 group-hover:opacity-100"
									title="Pop out"
								>
									<PictureInPicture2 class="h-3 w-3" />
								</span>
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<span
									role="button"
									tabindex="-1"
									onclick={(e: MouseEvent) => handleCloseTab(e, tab)}
									class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-g5 transition-colors hover:bg-s7 hover:text-tx {active ? '' : 'opacity-0 group-hover:opacity-100'}"
									title="Close"
								>
									<X class="h-3 w-3" />
								</span>
							</button>
						{/each}
					</div>
					{#if hoverTab}
						<div use:portal class="fixed z-[200]" style="left: {hoverX}px; top: {hoverY}px;">
							<TokenTabPreview chain={hoverTab.chain} address={hoverTab.address} symbol={hoverTab.symbol} />
						</div>
					{/if}
					<div class="relative flex-1 overflow-hidden">
						{#each getTokenTabs() as tab (tab.chain + ':' + tab.address)}
							{@const key = tab.chain + ':' + tab.address}
							{@const active = tab.chain === selectedChain && tab.address === selectedAddress}
							{#if visitedTabs[key] && key in tabTokenData}
								<div class="absolute inset-0 {active ? '' : 'pointer-events-none opacity-0'}" inert={!active}>
									<TokenDetail chain={tab.chain} address={tab.address} bind:tokenData={tabTokenData[key]} {active} />
								</div>
							{/if}
						{/each}
					</div>
				{:else}
					<div class="flex-1 overflow-hidden">
						<TokenDetail chain={selectedChain} address={selectedAddress} bind:tokenData={currentToken} />
					</div>
				{/if}
			</div>

			<div class="glass flex w-[21rem] shrink-0 flex-col border-l border-bd bg-s0">
				<div class="shrink-0">
					<TokenStats token={currentToken} />
				</div>
				<div class="shrink-0">
					<TradePanel chain={selectedChain} tokenAddress={selectedAddress} tokenSymbol={tokenSymbol} autoSlippage={currentToken?.autoSlippage ?? null} currentPriceUsd={currentToken?.quote?.priceUsd ?? 0} />
				</div>
				<div class="min-h-0 flex-1 border-t border-bd">
					<PositionsPanel selectedChain={selectedChain} selectedAddress={selectedAddress} />
				</div>
			</div>
		</div>
	{:else}
		<div class="glass flex flex-col md:hidden bg-s0" style="height: calc(100dvh - 48px - 56px - {getIsLoggedIn() ? '40px' : '0px'});">
			<div class="flex-1 overflow-hidden">
				<TokenDetail chain={selectedChain} address={selectedAddress} bind:tokenData={currentToken} />
			</div>
		</div>
	{/if}
{/if}

{#snippet mobileSheet(isOpen: boolean, closeFn: () => void, title: string, height: string, children: import('svelte').Snippet)}
	{#if isOpen}
		{@const sheetId = title.toLowerCase().replace(/\s/g, '-')}
		<div class="fixed inset-0 z-[100] md:hidden flex flex-col justify-end">
			<button class="absolute inset-0 bg-s0/50" onclick={closeFn} aria-label="Close"></button>
			<div
				class="glass-strong relative mobile-panel-enter flex flex-col rounded-t-2xl border-t border-bd bg-s2 mobile-safe-bottom"
				style="max-height: {height}; transform: translateY({sheetDragY}px); transition: {sheetDragging ? 'none' : 'transform 0.25s ease-out'};"
				data-sheet={sheetId}
			>
			<div
				class="shrink-0 cursor-grab active:cursor-grabbing touch-none"
				role="presentation"
				ontouchstart={onSheetTouchStart}
				ontouchmove={onSheetTouchMove}
				ontouchend={(e) => onSheetTouchEnd(e, closeFn)}
			>
					<div class="flex justify-center pt-2 pb-1">
						<div class="h-1 w-10 rounded-full bg-g3"></div>
					</div>
					<div class="flex items-center justify-between px-4 py-2 border-b border-bd">
						<span class="text-sm font-bold text-tx">{title}</span>
						<button onclick={closeFn} class="cursor-pointer rounded-lg p-1.5 text-g5 active:text-tx">
							<span class="text-lg">✕</span>
						</button>
					</div>
				</div>
				<div class="flex flex-1 flex-col min-h-0 overflow-hidden">
					{@render children()}
				</div>
			</div>
		</div>
	{/if}
{/snippet}

{@render mobileSheet(mobileTradeOpen, () => (mobileTradeOpen = false), `Trade ${tokenSymbol || currentToken?.tokenSymbol || ''}`, '85vh', tradeSheetContent)}
{#snippet tradeSheetContent()}
	<div class="flex min-h-0 flex-1 flex-col">
		<div class="shrink-0">
			<TokenStats token={currentToken} />
		</div>
		<div class="min-h-0 flex-1">
			<TradePanel mobile chain={selectedChain} tokenAddress={selectedAddress} tokenSymbol={tokenSymbol} autoSlippage={currentToken?.autoSlippage ?? null} currentPriceUsd={currentToken?.quote?.priceUsd ?? 0} />
		</div>
	</div>
{/snippet}
