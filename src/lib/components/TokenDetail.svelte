<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy, untrack } from 'svelte';
	import { dev } from '$app/environment';
	import { portal } from '$lib/actions/portal';
	import { api } from '$lib/api/client';
	import type { Chain, TokenSnapshot, TokenHoldersResponse, TokenSafetyResponse, TokenSwap, TokenTopTrader, TokenCallsResponse, DevTokensResponse, DevTokenItem, WatchlistCallItem, TokenMarketHolderInfo, TokenMarketStats, TokenMarketTimeframeStats, TokenPairMarket, components } from '$lib/api/types';
	import { formatPrice, formatUsd, formatPercent, formatNumber, formatMarketCap, timeAgo, fullDateTime, shortAddress, liveAge, explorerTxUrl, explorerAddressUrl, formatMultiplier, fmtVal, fmtPrice, fmtPriceHtml, formatPriceText, avatarUrl, formatCompactNumber } from '$lib/utils/format';
	import { getWalletIconUrl, getWalletAddress } from '$lib/utils/walleticon';

	import { getRouterName, getRouterInfo, getRouterIconForChain } from '$lib/utils/routers';
	import { isCursorRecoveryReason, subscribe, unsubscribe, type WsErrorInfo } from '$lib/ws/client';
	import { createCoalescer } from '$lib/utils/coalesce';
	import { getNow } from '$lib/stores/tick.svelte';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';
	import { siX, siTelegram, siDiscord, siInstagram } from 'simple-icons';
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import Globe from 'lucide-svelte/icons/globe';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Flame from 'lucide-svelte/icons/flame';
	import Coins from 'lucide-svelte/icons/coins';
	import Users from 'lucide-svelte/icons/users';
	import BadgeCheck from 'lucide-svelte/icons/badge-check';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import Heart from 'lucide-svelte/icons/heart';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import ShieldAlert from 'lucide-svelte/icons/shield-alert';
	import Snowflake from 'lucide-svelte/icons/snowflake';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Filter from 'lucide-svelte/icons/funnel';
	import XIcon from 'lucide-svelte/icons/x';
	import DexPaidIcon from './DexPaidIcon.svelte';
	import { isUsd } from '$lib/stores/currency.svelte';
	import { addFavourite, removeFavourite } from '$lib/stores/settings.svelte';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { getLiveAthPrice } from '$lib/stores/chart.svelte';
	import { selectWatchlistCaller } from '$lib/stores/watchlist.svelte';
	import { liveAccumulatedParams, type CursorTriplet } from '$lib/utils/livecursor';
	import TokenChart from './TokenChart.svelte';
	import { openTraderOverview } from '$lib/stores/traderAnalytics.svelte';
	import { setCandleMcap } from '$lib/stores/candleCache.svelte';

	import ChainIcon from './ChainIcon.svelte';
	import CurrencyValue from './CurrencyValue.svelte';
	import FundingSourcePreview from './FundingSourcePreview.svelte';
	import VirtualSwapList from './VirtualSwapList.svelte';
	import { fundingSourceOf, preserveFundingSources } from '$lib/source-funds';

	type TokenHolderBalanceUpdate = components['schemas']['TokenHolderBalanceUpdate'];
	type TokenHolderDistributionUpdate = components['schemas']['TokenHolderDistributionUpdate'];
	type TokenMarketLiveSnapshot = components['schemas']['TokenMarketLiveSnapshot'];
	type TokenTopTradersSnapshot = components['schemas']['TokenTopTradersSnapshot'];
	type TokenMigrationUpdate = components['schemas']['TokenMigrationUpdate'];

	let { chain, address, tokenData = $bindable(null), active = true }: { chain: Chain | string; address: string; tokenData?: TokenSnapshot | null; active?: boolean } = $props();

	function cursorLabel(cursor: string | null | undefined) {
		if (!cursor) return null;
		return cursor.length > 16 ? `${cursor.slice(0, 8)}…${cursor.slice(-8)}` : cursor;
	}

	function detailLog(event: string, details: Record<string, unknown>) {
		if (dev) console.debug(`[TokenDetail] ${event}`, details);
	}

	function tradeKey(trade: TokenSwap) {
		return trade.id || trade.txHash || `${trade.timestamp}:${trade.side}:${trade.walletAddress}:${trade.amountTokenStr}`;
	}

	const MAX_TRADES_PAGINATED = 1000;
	const MAX_LIVE_TRADES = 100;
	const swapsCoalescer = createCoalescer<TokenSwap>((batch) => {
		const fresh: TokenSwap[] = [];
		for (let i = batch.length - 1; i >= 0 && fresh.length < MAX_LIVE_TRADES; i--) {
			const swap = batch[i];
			if (!swap) continue;
			const key = tradeKey(swap);
			if (liveTradeKeys.has(key) || historicalTradeKeys.has(key)) continue;
			liveTradeKeys.add(key);
			if (!swap.timestamp && swap.ageSeconds) {
				(swap as Record<string, unknown>).timestamp = Math.floor(Date.now() / 1000) - swap.ageSeconds;
			}
			fresh.push(swap);
		}
		if (fresh.length > 0) {
			const next = [...fresh, ...liveTrades];
			for (let i = MAX_LIVE_TRADES; i < next.length; i++) liveTradeKeys.delete(tradeKey(next[i]));
			liveTrades = next.slice(0, MAX_LIVE_TRADES);
		}
	}, { maxBatch: MAX_TRADES_PAGINATED });

	function applySwapsUpdate(data: unknown) {
		if (!data) return;
		if (Array.isArray(data)) {
			swapsCoalescer.pushMany(data as TokenSwap[]);
		} else if (typeof data === 'object' && Array.isArray((data as { swaps?: unknown }).swaps)) {
			swapsCoalescer.pushMany((data as { swaps: TokenSwap[] }).swaps);
		} else {
			swapsCoalescer.push(data as TokenSwap);
		}
	}

	const priceCoalescer = createCoalescer<TokenMarketLiveSnapshot>((batch) => {
		const latest = batch[batch.length - 1];
		if (latest) applyPriceUpdate(latest);
	}, { maxBatch: 60 });

	const statsCoalescer = createCoalescer<TokenSnapshot>((batch) => {
		const latest = batch[batch.length - 1];
		if (latest) applyStatsUpdate(latest);
	}, { maxBatch: 60 });

	function openTrader(walletAddress: string) {
		if (!token || !walletAddress) return;
		openTraderOverview({
			chain: token.chain,
			walletAddress,
			token: {
				address: token.tokenAddress,
				chain: token.chain,
				decimals: token.tokenDecimals,
				name: token.tokenName,
				symbol: token.tokenSymbol
			}
		});
	}

	function openTopTrader(trader: TokenTopTrader) {
		openTrader(trader.walletAddress);
	}

	let token: TokenSnapshot | null = $state(null);
	let tokenBirth: string | null = $state(null);
	let liveTrades: TokenSwap[] = $state([]);
	let historicalTrades: TokenSwap[] = $state([]);
	let liveTradeKeys = new Set<string>();
	let historicalTradeKeys = new Set<string>();
	let tradesPaginated: boolean = $state(false);
	let tradeCount = $derived(Math.min(liveTrades.length + historicalTrades.length, tradesPaginated ? MAX_TRADES_PAGINATED : MAX_LIVE_TRADES));

	function resetTrades(swaps: TokenSwap[] = []) {
		liveTrades = [];
		historicalTrades = swaps.slice(0, MAX_TRADES_PAGINATED);
		liveTradeKeys.clear();
		historicalTradeKeys = new Set(historicalTrades.map(tradeKey));
	}

	function appendHistoricalTrades(swaps: TokenSwap[]) {
		if (historicalTrades.length >= MAX_TRADES_PAGINATED) return;
		const fresh: TokenSwap[] = [];
		for (const swap of swaps) {
			const key = tradeKey(swap);
			if (liveTradeKeys.has(key) || historicalTradeKeys.has(key)) continue;
			historicalTradeKeys.add(key);
			fresh.push(swap);
			if (historicalTrades.length + fresh.length >= MAX_TRADES_PAGINATED) break;
		}
		if (fresh.length > 0) historicalTrades = [...historicalTrades, ...fresh];
	}
	let mobileHeaderExpanded = $state(false);
	let aiNarrativeOpen = $state(false);
	let tradeFilterSide: 'ALL' | 'BUY' | 'SELL' = $state('ALL');
	let tradeFilterMinUsd: string = $state('');
	let tradeFilterMaxUsd: string = $state('');
	let tradeFilterMaker: string = $state('');
	let tradeFiltersOpen = $state(false);
	let tradeFilterDebounce: ReturnType<typeof setTimeout> | null = null;
	let hasTradeFilters = $derived(tradeFilterSide !== 'ALL' || tradeFilterMinUsd || tradeFilterMaxUsd || tradeFilterMaker);
	function clearTradeFilters() { tradeFilterSide = 'ALL'; tradeFilterMinUsd = ''; tradeFilterMaxUsd = ''; tradeFilterMaker = ''; tradeFiltersOpen = false; refetchTrades(); }
	function filterByMaker(addr: string) { tradeFilterMaker = addr; tradeFiltersOpen = true; refetchTrades(); }
	function buildTradesQuery(cursor?: string): Record<string, unknown> {
		const q: Record<string, unknown> = { limit: 50 };
		if (cursor) q.cursor = cursor;
		if (tradeFilterSide !== 'ALL') q.side = tradeFilterSide;
		if (tradeFilterMinUsd) { const v = parseFloat(tradeFilterMinUsd); if (!isNaN(v)) q.minUsd = v; }
		if (tradeFilterMaxUsd) { const v = parseFloat(tradeFilterMaxUsd); if (!isNaN(v)) q.maxUsd = v; }
		if (tradeFilterMaker) q.walletAddress = tradeFilterMaker;
		return q;
	}
	function buildSwapsWsParams(): Record<string, unknown> {
		const p: Record<string, unknown> = {};
		if (tradeFilterSide !== 'ALL') p.side = tradeFilterSide;
		if (tradeFilterMinUsd) { const v = parseFloat(tradeFilterMinUsd); if (!isNaN(v)) p.minUsd = v; }
		if (tradeFilterMaxUsd) { const v = parseFloat(tradeFilterMaxUsd); if (!isNaN(v)) p.maxUsd = v; }
		if (tradeFilterMaker) p.walletAddress = tradeFilterMaker;
		return p;
	}
	function resubscribeSwapsWs() {
		if (!chain || !resolvedAddress) return;
		if (swapsWsKey) { unsubscribe(swapsWsKey); swapsWsKey = null; }
		swapsCoalescer.clear();
		const topic = `token:${chain}:${resolvedAddress}:swaps`;
		const params = buildSwapsWsParams();
		swapsWsKey = subscribe(topic, (event, data) => {
			if (event !== 'TOKEN_SWAPS') return;
			applySwapsUpdate(data);
		}, Object.keys(params).length > 0 ? params : undefined);
	}
	function debouncedRefetchTrades() {
		if (tradeFilterDebounce) clearTimeout(tradeFilterDebounce);
		tradeFilterDebounce = setTimeout(() => refetchTrades(), 300);
	}
	function refetchTrades() {
		if (!chain || !resolvedAddress) return;
		tradesLoading = true;
		tradesHasMore = false;
		tradesPaginated = false;
		tradesCursor = undefined;
		tradesInFlightCursor = undefined;
		lastLoadedTradesCursor = undefined;
		api.GET('/v2/token/{chain}/{address}/swaps', {
			params: { path: { chain: chain as Chain, address: resolvedAddress }, query: buildTradesQuery() as never }
		}).then(({ data }) => {
			resetTrades(data?.swaps ?? []);
			tradesHasMore = !!data?.nextCursor;
			tradesCursor = data?.nextCursor;
		}).catch(() => { resetTrades(); }).finally(() => { tradesLoading = false; });
		resubscribeSwapsWs();
	}
	let holders: TokenHoldersResponse | null = $state(null);
	let safety: (TokenSafetyResponse & { loaded?: boolean }) | null = $state(null);
	let topTraders: TokenTopTrader[] = $state([]);
	let loading: boolean = $state(true);
	let tradesLoading: boolean = $state(true);
	let tradesHasMore: boolean = $state(false);
	let tradesLoadingMore: boolean = $state(false);
	let holdersLoading: boolean = $state(false);
	let holdersHasMore: boolean = $state(false);
	let holdersLoadingMore: boolean = $state(false);
	let tradesInFlightCursor: string | undefined;
	let holdersInFlightCursor: string | undefined;
	let lastLoadedTradesCursor: string | undefined;
	let lastLoadedHoldersCursor: string | undefined;
	let safetyLoading: boolean = $state(false);
	let tradersLoading: boolean = $state(false);
	let devTokens: DevTokensResponse | null = $state(null);
	let devTokensLoading: boolean = $state(false);
	let devTokensHasMore: boolean = $state(false);
	let devTokensLoadingMore: boolean = $state(false);
	let devTokensCursor: string | undefined = $state(undefined);
	let devTokensInFlightCursor: string | undefined;
	let lastLoadedDevTokensCursor: string | undefined;
	let devTokensLoadedKey: string = $state('');
	let calls: WatchlistCallItem[] = $state([]);
	let callsPagination = $state<CursorTriplet>({});
	let callsHasMore: boolean = $state(false);
	let callsLoadingMore: boolean = $state(false);
	let isFav: boolean = $state(false);
	let favToggling: boolean = $state(false);
	let callsPopoverOpen: boolean = $state(false);
	let callsPopoverPos: { x: number; y: number } = $state({ x: 0, y: 0 });
	let activeTab: string = $state('Trades');
	let statsTimeframe: string = $state('5m');
	let error: string = $state('');
	let pairs: TokenPairMarket[] = $state([]);
	let selectedPairIdx: number | null = $state(null);
	let pairsOpen = $state(false);
	let resolvedAddress = $derived(selectedPairIdx !== null && pairs[selectedPairIdx] ? pairs[selectedPairIdx].pairAddress : address);
	let wsKeys: string[] = [];
	let swapsWsKey: string | null = null;
	let holdersWsKey: string | null = null;
	let tokenFeedWsKey: string | null = null;
	let devTokensWsKey: string | null = null;
	let safetyWsKey: string | null = null;
	let holderBalanceBlocks = new Map<string, number>();
	let handledMigrations = new Set<string>();
	let devTokensRevision = 0;
	let safetyWsRevision = 0;
	let safetyRequestGeneration = 0;
	let holdersLoadedKey: string = $state('');
	let copied: boolean = $state(false);
	let holdersCount: number | null = $state(null);
	let chartHeight = $state(typeof window !== 'undefined' && window.innerWidth < 768 ? 300 : 450);
	let dragging = $state(false);

	let liveAthDisplay = $derived.by(() => {
		const live = getLiveAthPrice();
		const orig = token?.athPriceUsd ?? 0;
		const usdStr = live > orig ? String(live) : token?.athPriceUsdStr;
		const nativeStr = token?.athPriceNativeStr;
		return { usdStr, nativeStr };
	});
	let liveAthMultDisplay = $derived.by(() => {
		const currentPrice = token?.quote?.priceUsd ?? 0;
		const liveAth = getLiveAthPrice();
		const athPrice = Math.max(liveAth, token?.athPriceUsd ?? 0);
		if (athPrice > 0 && currentPrice > 0) {
			return String(athPrice / currentPrice);
		}
		return token?.athMultiplier != null ? String(token.athMultiplier) : undefined;
	});
	let dragStartY = 0;
	let dragStartHeight = 0;

	function onDragStart(e: MouseEvent) {
		dragging = true;
		dragStartY = e.clientY;
		dragStartHeight = chartHeight;
		document.addEventListener('mousemove', onDragMove);
		document.addEventListener('mouseup', onDragEnd);
	}

	function onDragMove(e: MouseEvent) {
		const delta = e.clientY - dragStartY;
		chartHeight = Math.max(200, Math.min(800, dragStartHeight + delta));
	}

	function onDragEnd() {
		dragging = false;
		document.removeEventListener('mousemove', onDragMove);
		document.removeEventListener('mouseup', onDragEnd);
	}

	function onTouchDragStart(e: TouchEvent) {
		e.preventDefault();
		dragging = true;
		dragStartY = e.touches[0].clientY;
		dragStartHeight = chartHeight;
		document.addEventListener('touchmove', onTouchDragMove, { passive: false });
		document.addEventListener('touchend', onTouchDragEnd);
	}

	function onTouchDragMove(e: TouchEvent) {
		e.preventDefault();
		const delta = e.touches[0].clientY - dragStartY;
		chartHeight = Math.max(200, Math.min(800, dragStartHeight + delta));
	}

	function onTouchDragEnd() {
		dragging = false;
		document.removeEventListener('touchmove', onTouchDragMove);
		document.removeEventListener('touchend', onTouchDragEnd);
	}

	$effect(() => {
		tokenData = token;
		const mc = (token as TokenSnapshot | null)?.quote?.marketCapUsdStr;
		if (mc) setCandleMcap(chain as string, address, mc);
	});

	// Flattened social links (new nested `socials.links`; twitter is {handle,url}).
	let socialLinks = $derived.by(() => {
		const l = (token as TokenSnapshot | null)?.socials?.links;
		if (!l) return undefined;
		return {
			website: l.website,
			twitter: l.twitter?.url,
			twitterHandle: l.twitter?.handle,
			telegram: l.telegram,
			discord: l.discord,
			instagram: l.instagram
		};
	});
	// Rich scraped social metadata (new TokenSocialData).
	let socialData = $derived((token as TokenSnapshot | null)?.socials);
	let aiNarrative = $derived(socialData?.aiNarrative?.trim() || null);
	let twitterProfile = $derived(socialData?.profile ?? null);
	let twitterCommunity = $derived(socialData?.community ?? null);
	let communityTokens = $derived(socialData?.twitterCommunities ?? null);
	let hasSocialSection = $derived(!!(aiNarrative || twitterProfile || twitterCommunity || (communityTokens && communityTokens.count > 0)));
	let hasCommunityInfo = $derived(!!(twitterCommunity || (communityTokens && communityTokens.count > 0)));
	function communityTokenHref(t: { tokenAddress: string }): string {
		return `/?chain=${chain}&token=${t.tokenAddress}`;
	}
	let displayRouter = $derived(getRouterInfo((token as TokenSnapshot | null)?.platformType ?? ''));
	let routerIconUrl = $derived.by(() => {
		const p = (token as TokenSnapshot | null)?.platformType;
		return p ? getRouterIconForChain(p, chain as string) : '';
	});
	let pumpfun = $derived((token as TokenSnapshot | null)?.launchPad?.pumpfun ?? null);
	let isMayhem = $derived(pumpfun?.isMayhem ?? false);
	let cashbackPct = $derived(pumpfun?.cashbackPct ?? 0);
	let migPct = $derived((token as TokenSnapshot | null)?.launchPad?.bondingCurve?.progressPct ?? 0);
	let isGraduated = $derived((token as TokenSnapshot | null)?.launchPad?.bondingCurve?.state === 'Migrated');
	let migratedFromIcon = $derived.by(() => {
		const bc = (token as TokenSnapshot | null)?.launchPad?.bondingCurve;
		if (bc?.state !== 'Migrated' || !bc.migratedFromPlatformType) return '';
		return getRouterIconForChain(bc.migratedFromPlatformType, chain as string);
	});

	const detailTabs = ['Trades', 'Top Traders', 'Holders', 'Details'];

	function percentColor(value: string | number | undefined | null): string {
		if (value === undefined || value === null) return 'text-g7';
		const num = typeof value === 'string' ? parseFloat(value) : value;
		if (isNaN(num)) return 'text-g7';
		return num > 0 ? 'text-grn' : num < 0 ? 'text-red' : 'text-g7';
	}

	function safetyColor(safe: boolean | undefined | null): string {
		if (safe === undefined || safe === null) return 'text-g7';
		return safe ? 'text-grn' : 'text-red';
	}

	function safetyIcon(safe: boolean | undefined | null): string {
		if (safe === undefined || safe === null) return '—';
		return safe ? '✓' : '✗';
	}

	function copyAddress() {
		navigator.clipboard.writeText(token?.tokenAddress ?? address);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	let copiedPair = $state<string | null>(null);
	function copyPairAddress(addr: string) {
		navigator.clipboard.writeText(addr);
		copiedPair = addr;
		setTimeout(() => { if (copiedPair === addr) copiedPair = null; }, 1500);
	}

	async function toggleFavourite() {
		if (!getIsLoggedIn() || favToggling) return;
		const c = chain as Chain;
		const a = token?.tokenAddress ?? address;
		favToggling = true;
		try {
			if (isFav) {
				await removeFavourite(c, a);
				isFav = false;
			} else {
				await addFavourite(c, a);
				isFav = true;
			}
		} catch {}
		favToggling = false;
	}

	function getStats(tf: string): TokenMarketTimeframeStats | null {
		if (!token?.stats?.timeframes) return null;
		return (token.stats.timeframes as Record<string, TokenMarketTimeframeStats>)[tf] ?? null;
	}

	function buyPct(tf: string): number {
		const s = getStats(tf);
		if (!s) return 50;
		return Math.max(5, Math.min(95, s.buyVolumePct));
	}

	function cleanupWs() {
		cleanupHoldersWs();
		cleanupTokenFeedWs();
		if (swapsWsKey) { unsubscribe(swapsWsKey); swapsWsKey = null; }
		wsKeys.forEach((k) => unsubscribe(k));
		wsKeys = [];
	}

	function cleanupHoldersWs() {
		if (holdersWsKey) {
			unsubscribe(holdersWsKey);
			holdersWsKey = null;
		}
	}

	function cleanupTokenFeedWs() {
		if (tokenFeedWsKey) {
			unsubscribe(tokenFeedWsKey);
			tokenFeedWsKey = null;
		}
	}

	function cleanupDevTokensWs() {
		if (devTokensWsKey) {
			unsubscribe(devTokensWsKey);
			devTokensWsKey = null;
		}
	}

	function cleanupSafetyWs() {
		if (safetyWsKey) {
			unsubscribe(safetyWsKey);
			safetyWsKey = null;
		}
	}

	function cleanupDetailsWs() {
		cleanupDevTokensWs();
		cleanupSafetyWs();
		safetyRequestGeneration += 1;
		safetyLoading = false;
	}

	function applyHolderBalanceUpdate(update: TokenHolderBalanceUpdate) {
		if (!holders) return;
		const incoming = new Map<string, TokenHolderBalanceUpdate['holders'][number]>();
		for (const row of update.holders) {
			const current = incoming.get(row.walletAddress);
			if (!current || row.blockNumber > current.blockNumber) incoming.set(row.walletAddress, row);
		}
		let changed = false;
		const nextHolders = holders.holders.map((holder) => {
			const next = incoming.get(holder.walletAddress);
			if (!next) return holder;
			const lastBlock = holderBalanceBlocks.get(next.walletAddress);
			if (lastBlock !== undefined && next.blockNumber <= lastBlock) return holder;
			holderBalanceBlocks.set(next.walletAddress, next.blockNumber);
			const { blockNumber: _, ...replacement } = next;
			changed = true;
			return { ...holder, ...replacement };
		});
		if (changed) holders = { ...holders, holders: nextHolders };
	}

	function patchHolderInfo(current: TokenMarketHolderInfo, update: TokenHolderDistributionUpdate): TokenMarketHolderInfo {
		switch (update.bucket) {
			case 'TOP10': return { ...current, top10Pct: update.holders.top10Pct };
			case 'SNIPER': return { ...current, snipers: update.holders.snipers, snipersPct: update.holders.snipersPct };
			case 'BUNDLER': return { ...current, bundlers: update.holders.bundlers, bundlersPct: update.holders.bundlersPct };
			case 'DEV': return { ...current, devPct: update.holders.devPct };
			case 'INSIDER': return { ...current, insiders: update.holders.insiders, insidersPct: update.holders.insidersPct };
			case 'TRADER': return { ...current, traders: update.holders.traders, tradersPct: update.holders.tradersPct };
		}
	}

	function applyHolderDistributionUpdate(update: TokenHolderDistributionUpdate) {
		if (holders) {
			const distribution = { ...holders.distribution };
			switch (update.bucket) {
				case 'TOP10': distribution.top10Pct = update.distribution.top10Pct; break;
				case 'SNIPER': distribution.sniperPct = update.distribution.sniperPct; break;
				case 'BUNDLER': distribution.bundlerPct = update.distribution.bundlerPct; break;
				case 'DEV': distribution.devPct = update.distribution.devPct; break;
				case 'INSIDER':
					distribution.insiderPct = update.distribution.insiderPct;
					distribution.insiderCount = update.distribution.insiderCount;
					break;
				case 'TRADER': distribution.traderPct = update.distribution.traderPct; break;
			}
			holders = { ...holders, distribution };
		}
		if (token) token = { ...token, holders: patchHolderInfo(token.holders, update) };
	}

	function applyTokenFeedCall(call: WatchlistCallItem) {
		const index = calls.findIndex((item) => item.id === call.id);
		if (index >= 0) {
			calls = calls.map((item, itemIndex) => itemIndex === index ? call : item);
			return;
		}
		const windowSize = Math.max(calls.length, 1);
		calls = [call, ...calls].slice(0, windowSize);
	}

	function applyTokenFeedUpdate(call: WatchlistCallItem) {
		if (!calls.some((item) => item.id === call.id)) return;
		calls = calls.map((item) => item.id === call.id ? call : item);
	}

	function setupDevTokensWs(c: string, a: string, page: CursorTriplet | undefined | null) {
		cleanupDevTokensWs();
		if (!c || !a || activeTab !== 'Details' || typeof page?.cursor !== 'string') return;
		const identity = `${c}:${a}`;
		devTokensWsKey = subscribe(`token:${c}:${a}:dev_tokens`, (event, data) => {
			if (event !== 'TOKEN_DEV_TOKENS' || `${chain}:${address}` !== identity || activeTab !== 'Details') return;
			devTokensRevision += 1;
			const snapshot = data as DevTokensResponse | null;
			devTokens = snapshot;
			devTokensHasMore = typeof snapshot?.nextCursor === 'string';
			devTokensCursor = snapshot?.nextCursor ?? undefined;
			devTokensInFlightCursor = undefined;
			lastLoadedDevTokensCursor = undefined;
			devTokensLoadingMore = false;
			devTokensLoadedKey = identity;
		}, { endCursor: page.cursor }, {
			recovery: 'refetch',
			onReconnect: () => { void fetchDevTokensPage(); }
		});
	}

	function setupSafetyWs(c: string, a: string) {
		cleanupSafetyWs();
		if (!c || !a || activeTab !== 'Details') return;
		const identity = `${c}:${a}`;
		safetyWsKey = subscribe(`token:${c}:${a}:safety`, (event, data) => {
			if (event !== 'TOKEN_SAFETY' || !data || `${chain}:${address}` !== identity || activeTab !== 'Details') return;
			safetyWsRevision += 1;
			safety = { ...(data as TokenSafetyResponse), loaded: true };
			safetyLoading = false;
		});
	}

	function handleHoldersWsError(error: WsErrorInfo) {
		if (isCursorRecoveryReason(error.reason)) {
			if (activeTab === 'Holders') {
				void fetchHolders({ soft: true });
			} else {
				holdersHasMore = false;
				holdersLoadingMore = false;
				rememberHoldersPage(undefined);
				holdersInFlightCursor = undefined;
				lastLoadedHoldersCursor = undefined;
				setupHoldersWs(chain as Chain, address);
			}
		} else if (error.reason === 'PARAMS_INVALID' || error.reason === 'TOPIC_INVALID') {
			console.error('[WS] holders subscription rejected:', error);
		}
	}

	function setupHoldersWs(c: string, a: string, page: CursorTriplet | undefined | null = holdersTriplet()) {
		cleanupHoldersWs();
		if (!c || !a) return;
		const topic = `token:${c}:${a}:holders`;
		const params = liveAccumulatedParams(page);
		if (!params) return;
		detailLog('holders:subscribe', {
			topic,
			paramsKeys: Object.keys(params),
			endCursor: cursorLabel(params.endCursor),
			rows: holders?.holders?.length ?? 0
		});
		holdersWsKey = subscribe(topic, (event, data) => {
			if (!data) return;
			if (event === 'TOKEN_HOLDERS') {
				const snapshot = data as TokenHoldersResponse;
				detailLog('holders:ws-snapshot', {
					activeTab,
					prevRows: holders?.holders?.length ?? 0,
					nextRows: snapshot.holders?.length ?? 0,
					cursor: cursorLabel(snapshot.cursor),
					nextCursor: cursorLabel(snapshot.nextCursor),
					currentCursor: cursorLabel(holdersPagination.nextCursor),
					windowCursor: cursorLabel(holdersPagination.cursor),
					lastLoadedCursor: cursorLabel(lastLoadedHoldersCursor)
				});
				applyHoldersSnapshot(snapshot);
			} else if (event === 'TOKEN_HOLDER_COUNT') {
				applyHolderCount(data);
			} else if (event === 'TOKEN_HOLDER_BALANCES') {
				applyHolderBalanceUpdate(data as TokenHolderBalanceUpdate);
			} else if (event === 'TOKEN_HOLDERS_CHANGE') {
				applyHolderDistributionUpdate(data as TokenHolderDistributionUpdate);
			}
		}, params, {
			onError: handleHoldersWsError,
			recovery: 'refetch',
			onReconnect: () => { void fetchHolders({ soft: true }); }
		});
	}

	function handleTokenFeedWsError(error: WsErrorInfo) {
		if (isCursorRecoveryReason(error.reason)) {
			calls = [];
			rememberCallsPage(undefined);
			void fetchCalls(chain as Chain, resolvedAddress);
		} else if (error.reason === 'PARAMS_INVALID' || error.reason === 'TOPIC_INVALID') {
			console.error('[WS] token feed subscription rejected:', error);
		}
	}

	function setupTokenFeedWs(c: string, a: string, page: CursorTriplet | undefined | null = callsTriplet()) {
		cleanupTokenFeedWs();
		if (!c || !a) return;
		const params = liveAccumulatedParams(page);
		if (!params) return;
		const topic = `token:${c}:${a}:feed`;
		detailLog('calls:subscribe', {
			topic,
			paramsKeys: Object.keys(params),
			endCursor: cursorLabel(params.endCursor),
			rows: calls.length
		});
		tokenFeedWsKey = subscribe(topic, (event, data) => {
			if (!data) return;
			if (event === 'TOKEN_FEED') {
				const snapshot = data as TokenCallsResponse;
				calls = Array.isArray(snapshot.calls) ? snapshot.calls : [];
				if (typeof snapshot.cursor === 'string') {
					rememberCallsPage(snapshot);
				}
			} else if (event === 'TOKEN_FEED_CALL') {
				applyTokenFeedCall(data as WatchlistCallItem);
			} else if (event === 'TOKEN_FEED_UPDATE') {
				applyTokenFeedUpdate(data as WatchlistCallItem);
			}
		}, params, {
			onError: handleTokenFeedWsError,
			recovery: 'refetch',
			onReconnect: () => { void fetchCalls(c as Chain, a); }
		});
	}

	function applyPriceUpdate(data: TokenMarketLiveSnapshot) {
		if (!token) return;
		if (data.quote) token = { ...token, quote: { ...token.quote, ...data.quote } as typeof token.quote };
		if (data.stats) {
			let updatedStats = { ...token.stats };
			if (data.stats.timeframes) {
				const curTimeframes = { ...token.stats.timeframes };
				for (const tf of ['5m', '1h', '6h', '24h'] as const) {
					if (data.stats.timeframes[tf]) curTimeframes[tf] = { ...curTimeframes[tf], ...data.stats.timeframes[tf] } as typeof curTimeframes[typeof tf];
				}
				updatedStats = { ...updatedStats, timeframes: curTimeframes };
			}
			if (data.stats.total) updatedStats = { ...updatedStats, total: { ...updatedStats.total, ...data.stats.total } };
			token = { ...token, stats: updatedStats };
		}
	}

	function applyStatsUpdate(data: TokenSnapshot) {
		if (!token) return;
		let updated = { ...token };
		if (data.calls !== undefined) updated = { ...updated, calls: data.calls };
		if (data.autoSlippage !== undefined) updated = { ...updated, autoSlippage: data.autoSlippage };
		if (data.quote) updated = { ...updated, quote: { ...updated.quote, ...data.quote } as typeof updated.quote };
		if (data.stats?.timeframes) {
			const curTimeframes = { ...token.stats.timeframes };
			for (const tf of ['5m', '1h', '6h', '24h'] as const) {
				if (data.stats.timeframes[tf]) curTimeframes[tf] = { ...curTimeframes[tf], ...data.stats.timeframes[tf] } as typeof curTimeframes[typeof tf];
			}
			updated = { ...updated, stats: { ...updated.stats, timeframes: curTimeframes } };
		}
		if (data.stats?.total) updated = { ...updated, stats: { ...updated.stats, total: { ...updated.stats.total, ...data.stats.total } } };
		if (data.holders) updated = { ...updated, holders: { ...updated.holders, ...data.holders } };
		if (data.holders?.holderCount !== undefined) holdersCount = data.holders.holderCount;
		token = updated;
	}

	function applyHoldersSnapshot(snapshot: TokenHoldersResponse) {
		holders = snapshot;
		holdersCount = snapshot.holderCount;
		if (typeof snapshot.cursor === 'string') rememberHoldersPage(snapshot);
	}

	function applyHolderCount(data: { holderCount?: number; nonZeroHolders?: number }) {
		const count = data.holderCount ?? data.nonZeroHolders;
		if (count !== undefined) holdersCount = count;
	}

	function applyTopTradersSnapshot(data: TokenTopTradersSnapshot) {
		if (!Array.isArray(data.traders)) {
			topTraders = [];
			return;
		}
		topTraders = preserveFundingSources(topTraders, data.traders);
	}

	function applyMigrationUpdate(data: TokenMigrationUpdate) {
		if (!token || !data.delta.migratedToPairAddress) return;
		const delta = data.delta;
		const migrationKey = `${delta.chain}:${delta.pairAddress}:${delta.migratedToPairAddress}`;
		if (handledMigrations.has(migrationKey)) return;
		handledMigrations.add(migrationKey);
		const bc = {
			state: 'Migrated' as const,
			progressPct: 100,
			migratedFromPairAddress: token.pairAddress ?? delta.pairAddress,
			migratedFromPlatformAddress: token.platformAddress,
			migratedFromPlatformName: token.platformName,
			migratedFromPlatformType: token.platformType,
			migratedAtAgeSeconds: 0,
			migratedAtTimestamp: Date.now(),
			migratedAtTimestampStr: new Date().toISOString()
		};
		token = { ...token, launchPad: { bondingCurve: bc, pumpfun: token.launchPad?.pumpfun ?? null } };
		setTimeout(() => {
			if (destroyed) return;
			const newPair = delta.migratedToPairAddress;
			const mc = chain as Chain;
			api.GET('/v2/token/{chain}/{address}', {
				params: { path: { chain: mc, address: newPair } }
			}).then(({ data: snap }) => {
				if (!snap) return;
				token = {
					...snap,
					tokenSymbol: token?.tokenSymbol ?? snap.tokenSymbol,
					tokenName: token?.tokenName ?? snap.tokenName,
					launchPad: { bondingCurve: bc, pumpfun: snap.launchPad?.pumpfun ?? null }
				};
				isFav = !!snap.isFavourited;
				if (snap.holders?.holderCount !== undefined) holdersCount = snap.holders.holderCount;
			}).catch(() => {});
			api.GET('/v2/token/{chain}/{address}/pairs', {
				params: { path: { chain: mc, address: newPair } }
			}).then(({ data: d }) => {
				pairs = (d?.pairs ?? []).sort((x, y) => (y.isBestPair ? 1 : 0) - (x.isBestPair ? 1 : 0));
				selectedPairIdx = null;
			}).catch(() => {});
			tradesLoading = true;
			api.GET('/v2/token/{chain}/{address}/swaps', {
				params: { path: { chain: mc, address: newPair }, query: buildTradesQuery() as never }
			}).then(({ data: d }) => {
				resetTrades(d?.swaps ?? []);
				tradesHasMore = !!d?.nextCursor;
				tradesCursor = d?.nextCursor;
			}).catch(() => { resetTrades(); }).finally(() => { tradesLoading = false; });
			cleanupWs();
			untrack(() => setupWs(mc, newPair));
		}, 2000);
	}

	function setupWs(c: string, a: string) {
		cleanupWs();
		priceCoalescer.clear();
		statsCoalescer.clear();
		const topic = `token:${c}:${a}`;

		const priceKey = subscribe(`${topic}:price`, (event, data) => {
			if (event === 'TOKEN_PRICE' && data) priceCoalescer.push(data as TokenMarketLiveSnapshot);
		});

		const statsKey = subscribe(`${topic}:stats`, (event, data) => {
			if (event === 'TOKEN_STATS' && data) statsCoalescer.push(data as TokenSnapshot);
		});

		resubscribeSwapsWs();

		setupHoldersWs(c, a);

		const topTradersKey = subscribe(`${topic}:top_traders`, (event, data) => {
			if (event === 'TOKEN_TOP_TRADERS' && data) applyTopTradersSnapshot(data as TokenTopTradersSnapshot);
		});

		const migrationKey = subscribe(`${topic}:migration`, (event, data) => {
			if (event === 'TOKEN_MIGRATION' && data) applyMigrationUpdate(data as TokenMigrationUpdate);
		});

		wsKeys = [priceKey, statsKey, topTradersKey, migrationKey];
	}

	$effect(() => {
		const c = chain as Chain;
		const a = address;
		if (!c || !a) return;
		untrack(() => {
			const key = `${c}:${a}`;

			holderBalanceBlocks.clear();
			handledMigrations.clear();
			devTokensRevision += 1;
			safetyWsRevision += 1;
			loading = true;
			error = '';
			holders = null;
			holdersHasMore = false;
			holdersLoadingMore = false;
			rememberHoldersPage(undefined);
			holdersInFlightCursor = undefined;
			lastLoadedHoldersCursor = undefined;
			holdersLoadedKey = '';
			safety = null;
			topTraders = [];
			devTokens = null;
			devTokensHasMore = false;
			devTokensLoadingMore = false;
			devTokensCursor = undefined;
			devTokensInFlightCursor = undefined;
			lastLoadedDevTokensCursor = undefined;
			devTokensLoadedKey = '';
			calls = [];
			rememberCallsPage(undefined);
			callsPopoverOpen = false;
			activeTab = 'Trades';
			holdersCount = null;
			isFav = false;
			favToggling = false;
			pairs = [];
			selectedPairIdx = null;
			pairsOpen = false;

			api.GET('/v2/token/{chain}/{address}/pairs', {
				params: { path: { chain: c, address: a } }
			})
				.then(({ data }) => {
					const sorted = (data?.pairs ?? []).sort((x, y) => (y.isBestPair ? 1 : 0) - (x.isBestPair ? 1 : 0));
					pairs = sorted;
				})
				.catch(() => { pairs = []; });

			api.GET('/v2/token/{chain}/{address}', {
				params: { path: { chain: c, address: a } }
			})
				.then(({ data, error: err }) => {
					if (`${chain}:${address}` !== key) return;
					if (err) throw new Error('Failed to load token');
					token = data ?? null;
					isFav = !!data?.isFavourited;
					if (data?.holders?.holderCount !== undefined) holdersCount = data.holders.holderCount;
					if (data?.createdAtAgeSeconds) tokenBirth = new Date(Date.now() - data.createdAtAgeSeconds * 1000).toISOString();
					void fetchCalls(c, a);
				})
				.catch((e) => {
					token = null;
					error = e?.message ?? 'Failed to load token';
				})
				.finally(() => {
					loading = false;
				});

			tradesLoading = true;
			tradesHasMore = false;
			tradesPaginated = false;
			tradesCursor = undefined;
			tradesInFlightCursor = undefined;
			lastLoadedTradesCursor = undefined;
			api.GET('/v2/token/{chain}/{address}/swaps', {
				params: { path: { chain: c, address: a }, query: buildTradesQuery() as never }
			})
				.then(({ data }) => {
					resetTrades(data?.swaps ?? []);
					tradesHasMore = !!data?.nextCursor;
					tradesCursor = data?.nextCursor;
				})
				.catch(() => {
					resetTrades();
				})
				.finally(() => {
					tradesLoading = false;
				});

			setupWs(c, a);
		});

		return () => cleanupWs();
	});

	async function loadMoreCalls() {
		const cursor = callsPagination.nextCursor;
		if (callsLoadingMore || !callsHasMore || !cursor) return;
		callsLoadingMore = true;
		try {
			const { data } = await api.GET('/v2/token/{chain}/{address}/calls', {
				params: { path: { chain: chain as Chain, address: resolvedAddress }, query: { cursor } as never }
			});
			calls = [...calls, ...(data?.calls ?? [])];
			rememberCallsPage(data);
			setupTokenFeedWs(chain, resolvedAddress);
		} catch {
			callsHasMore = false;
		} finally {
			callsLoadingMore = false;
		}
	}

	function handleCallsScroll(e: Event) {
		if (!callsHasMore || callsLoadingMore) return;
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
			loadMoreCalls();
		}
	}

	function openCallerView(call: WatchlistCallItem) {
		const caller = call.caller;
		const id = 'id' in caller ? String(caller.id) : '';
		if (!id) return;
		selectWatchlistCaller(id, caller.type);
		if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('watchlist-open-caller'));
		callsPopoverOpen = false;
	}

	function selectPair(idx: number | null) {
		selectedPairIdx = idx;
		pairsOpen = false;
		const c = chain as Chain;
		const ra = idx !== null && pairs[idx] ? pairs[idx].pairAddress : address;
		const key = `${c}:${ra}`;
		calls = [];
		rememberCallsPage(undefined);
		cleanupTokenFeedWs();
		callsPopoverOpen = false;

		api.GET('/v2/token/{chain}/{address}', {
			params: { path: { chain: c, address: ra } }
		})
			.then(({ data }) => {
				if (`${chain}:${resolvedAddress}` !== key) return;
				if (!data) return;
				token = {
					...data,
					tokenSymbol: token?.tokenSymbol ?? data.tokenSymbol,
					tokenName: token?.tokenName ?? data.tokenName,
				};
				isFav = !!data.isFavourited;
				if (data.holders?.holderCount !== undefined) holdersCount = data.holders.holderCount;
				void fetchCalls(c, ra);
			})
			.catch(() => {});

		tradesLoading = true;
		tradesHasMore = false;
		tradesPaginated = false;
		tradesCursor = undefined;
		tradesInFlightCursor = undefined;
		lastLoadedTradesCursor = undefined;
		api.GET('/v2/token/{chain}/{address}/swaps', {
			params: { path: { chain: c, address: ra }, query: buildTradesQuery() as never }
		})
			.then(({ data }) => {
				resetTrades(data?.swaps ?? []);
				tradesHasMore = !!data?.nextCursor;
				tradesCursor = data?.nextCursor;
			})
			.catch(() => { resetTrades(); })
			.finally(() => { tradesLoading = false; });

		cleanupWs();
		untrack(() => setupWs(c, ra));
	}

	let tradesCursor: string | undefined = $state(undefined);
	let holdersPagination = $state<CursorTriplet>({});

	function callsTriplet(): CursorTriplet {
		return callsPagination;
	}

	function rememberCallsPage(page: CursorTriplet | undefined | null) {
		const pagination = {
			cursor: page?.cursor ?? undefined,
			prevCursor: page?.prevCursor ?? undefined,
			nextCursor: page?.nextCursor ?? undefined
		};
		callsPagination = pagination;
		callsHasMore = !!pagination.nextCursor;
	}

	function holdersTriplet(): CursorTriplet {
		return holdersPagination;
	}

	function rememberHoldersPage(page: CursorTriplet | undefined | null) {
		const pagination = {
			cursor: page?.cursor ?? undefined,
			prevCursor: page?.prevCursor ?? undefined,
			nextCursor: page?.nextCursor ?? undefined
		};
		holdersPagination = pagination;
		holdersHasMore = !!pagination.nextCursor;
	}

	async function loadMoreTrades() {
		const cursor = tradesCursor;
		if (tradesLoadingMore || !tradesHasMore || !cursor || cursor === tradesInFlightCursor || cursor === lastLoadedTradesCursor) return;
		tradesLoadingMore = true;
		tradesInFlightCursor = cursor;
		const c = chain as Chain;
		const a = resolvedAddress;
		try {
			const { data } = await api.GET('/v2/token/{chain}/{address}/swaps', {
				params: { path: { chain: c, address: a }, query: buildTradesQuery(cursor) as never }
			});
			if (data?.swaps) {
				appendHistoricalTrades(data.swaps);
				tradesPaginated = true;
				tradesHasMore = !!data.nextCursor && historicalTrades.length < MAX_TRADES_PAGINATED;
				tradesCursor = data.nextCursor;
				lastLoadedTradesCursor = cursor;
			}
		} catch {} finally {
			if (tradesInFlightCursor === cursor) tradesInFlightCursor = undefined;
			tradesLoadingMore = false;
		}
	}

	async function fetchCalls(c: Chain, a: string) {
		const key = `${c}:${a}`;
		cleanupTokenFeedWs();
		rememberCallsPage(undefined);
		try {
			const { data } = await api.GET('/v2/token/{chain}/{address}/calls', {
				params: { path: { chain: c, address: a } }
			});
			if (`${chain}:${resolvedAddress}` !== key) return;
			calls = data?.calls ?? [];
			rememberCallsPage(data);
			setupTokenFeedWs(c, a, data);
		} catch (e) {
			if (`${chain}:${resolvedAddress}` !== key) return;
			console.error('[CALLS] fetch error:', e);
			calls = [];
			rememberCallsPage(undefined);
		}
	}

	async function loadMoreHolders() {
		const cursor = holdersPagination.nextCursor;
		if (holdersLoadingMore || !holdersHasMore || !cursor || !holders || cursor === holdersInFlightCursor || cursor === lastLoadedHoldersCursor) return;
		holdersLoadingMore = true;
		holdersInFlightCursor = cursor;
		const c = chain as Chain;
		const a = address;
		detailLog('holders:load-more-start', {
			cursor: cursorLabel(cursor),
			windowCursor: cursorLabel(holdersPagination.cursor),
			rows: holders.holders?.length ?? 0
		});
		try {
			const previousCursor = holdersPagination.cursor;
			const { data } = await api.GET('/v2/token/{chain}/{address}/holders', {
				params: { path: { chain: c, address: a }, query: { cursor } }
			});
			if (data?.holders) {
				holders = {
					...data,
					holders: [...holders.holders, ...data.holders]
				};
				holdersCount = data.holderCount;
				rememberHoldersPage(data);
				lastLoadedHoldersCursor = cursor;
				detailLog('holders:load-more-success', {
					requestCursor: cursorLabel(cursor),
					responseCursor: cursorLabel(data.cursor),
					nextCursor: cursorLabel(data.nextCursor),
					addedRows: data.holders.length,
					rows: holders.holders?.length ?? 0
				});
				if (holdersPagination.cursor && holdersPagination.cursor !== previousCursor) setupHoldersWs(c, a);
			} else {
				holdersHasMore = false;
				rememberHoldersPage(undefined);
				detailLog('holders:load-more-empty', {
					requestCursor: cursorLabel(cursor)
				});
			}
		} catch {} finally {
			if (holdersInFlightCursor === cursor) holdersInFlightCursor = undefined;
			holdersLoadingMore = false;
		}
	}

	async function fetchHolders(opts?: { soft?: boolean }) {
		if (holdersLoading) return;
		const keepVisible = !!(opts?.soft && holders);
		if (!keepVisible) holdersLoading = true;
		rememberHoldersPage(undefined);
		holdersInFlightCursor = undefined;
		lastLoadedHoldersCursor = undefined;
		const c = chain as Chain;
		const a = address;
		const key = `${c}:${a}`;
		try {
			const { data } = await api.GET('/v2/token/{chain}/{address}/holders', {
				params: { path: { chain: c, address: a } }
			});
			if (`${chain}:${address}` !== key) return;
			holders = data ?? null;
			rememberHoldersPage(data);
			if (data?.holderCount !== undefined) holdersCount = data.holderCount;
		} catch {
			if (`${chain}:${address}` !== key) return;
			if (!keepVisible) holders = null;
			holdersHasMore = false;
			rememberHoldersPage(undefined);
			holdersInFlightCursor = undefined;
			lastLoadedHoldersCursor = undefined;
		} finally {
			if (`${chain}:${address}` !== key) return;
			holdersLoadedKey = key;
			holdersLoading = false;
			setupHoldersWs(c, a);
		}
	}

	function onHoldersScroll(e: Event) {
		const el = e.target as HTMLElement;
		const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
		if (remaining < 100) {
			void loadMoreHolders();
		}
	}

	async function fetchDevTokensPage(cursor?: string) {
		const initial = !cursor;
		if (initial) {
			if (devTokensLoading) return;
			devTokensLoading = true;
			devTokensHasMore = false;
			devTokensCursor = undefined;
			devTokensInFlightCursor = undefined;
			lastLoadedDevTokensCursor = undefined;
		}

		const c = chain as Chain;
		const a = address;
		const key = `${c}:${a}`;
		const revision = devTokensRevision;
		try {
			const { data } = await api.GET('/v2/token/{chain}/{address}/dev-tokens', {
				params: {
					path: { chain: c, address: a },
					...(cursor ? { query: { cursor } } : {})
				}
			});
			if (`${chain}:${address}` !== key) return;
			if (revision !== devTokensRevision) return;
			if (!data) {
				if (initial) devTokens = null;
				devTokensHasMore = false;
				devTokensCursor = undefined;
				return;
			}

			devTokens = !initial && devTokens
				? {
						...data,
						tokens: [...devTokens.tokens, ...data.tokens]
					}
				: data;
			devTokensHasMore = !!data.nextCursor;
			devTokensCursor = data.nextCursor;
			if (!initial) lastLoadedDevTokensCursor = cursor;
			setupDevTokensWs(c, a, data);
		} catch {
			if (`${chain}:${address}` !== key) return;
			if (initial) devTokens = null;
			devTokensHasMore = false;
			devTokensCursor = undefined;
		} finally {
			if (`${chain}:${address}` !== key) return;
			if (initial) {
				devTokensLoadedKey = key;
				devTokensLoading = false;
			} else {
				if (devTokensInFlightCursor === cursor) devTokensInFlightCursor = undefined;
				devTokensLoadingMore = false;
			}
		}
	}

	async function loadMoreDevTokens() {
		const cursor = devTokensCursor;
		if (devTokensLoadingMore || !devTokensHasMore || !cursor || cursor === devTokensInFlightCursor || cursor === lastLoadedDevTokensCursor) return;
		devTokensLoadingMore = true;
		devTokensInFlightCursor = cursor;
		await fetchDevTokensPage(cursor);
	}

	function onDevTokensScroll(e: Event) {
		const el = e.target as HTMLElement;
		const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
		if (remaining < 100) {
			void loadMoreDevTokens();
		}
	}

	function onDetailScroll(e: Event) {
		if (activeTab === 'Holders') {
			onHoldersScroll(e);
		}
	}

	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		cleanupWs();
		cleanupDetailsWs();
		swapsCoalescer.dispose();
		priceCoalescer.dispose();
		statsCoalescer.dispose();
	});

	$effect(() => {
		const c = chain as Chain;
		const a = address;
		const detailsActive = activeTab === 'Details';
		if (!c || !a || !detailsActive) {
			untrack(() => cleanupDetailsWs());
			return;
		}
		untrack(() => {
			cleanupDetailsWs();
			setupSafetyWs(c, a);
			if (devTokensLoadedKey === `${c}:${a}` && devTokens) setupDevTokensWs(c, a, devTokens);
		});
		return () => cleanupDetailsWs();
	});

	$effect(() => {
		const c = chain as Chain;
		const a = address;
		if (!c || !a) return;

		if (activeTab === 'Holders' && !holders && !holdersLoading && holdersLoadedKey !== `${c}:${a}`) {
			void fetchHolders();
		}

		if (activeTab === 'Details' && !safety) {
			const identity = `${c}:${a}`;
			const wsRevision = safetyWsRevision;
			const requestGeneration = ++safetyRequestGeneration;
			safetyLoading = true;
			api.GET('/v2/token/{chain}/{address}/safety', {
				params: { path: { chain: c, address: a } }
			})
				.then(({ data }) => {
					if (`${chain}:${address}` !== identity || activeTab !== 'Details' || requestGeneration !== safetyRequestGeneration || wsRevision !== safetyWsRevision) return;
					safety = data ? { ...data, loaded: true } : null;
				})
				.catch(() => {
					if (`${chain}:${address}` !== identity || activeTab !== 'Details' || requestGeneration !== safetyRequestGeneration || wsRevision !== safetyWsRevision) return;
					safety = { loaded: true } as TokenSafetyResponse & { loaded: true };
				})
				.finally(() => {
					if (requestGeneration === safetyRequestGeneration) safetyLoading = false;
				});
		}

		if (activeTab === 'Details' && !devTokensLoading && devTokensLoadedKey !== `${c}:${a}`) {
			void fetchDevTokensPage();
		}

		if (activeTab === 'Top Traders' && topTraders.length === 0) {
			tradersLoading = true;
			api.GET('/v2/token/{chain}/{address}/top-traders', {
				params: { path: { chain: c, address: a } }
			})
				.then(({ data }) => {
					topTraders = data?.traders ?? [];
				})
				.catch(() => {
					topTraders = [];
				})
				.finally(() => {
					tradersLoading = false;
				});
		}
	});
</script>

<div class="flex h-full flex-col overflow-hidden">
	{#if loading}
		<div class="shrink-0 border-b border-bd/40 px-4 py-3">
			<div class="flex items-start gap-6">
				<div class="shrink-0">
					<div class="mb-2.5 flex items-center gap-3">
						<div class="skeleton h-14 w-14 rounded-xl"></div>
						<div class="space-y-1.5">
							<div class="skeleton h-5 w-40 rounded-md" style="animation-delay: 60ms"></div>
							<div class="skeleton h-4 w-28 rounded-md" style="animation-delay: 120ms"></div>
						</div>
					</div>
				</div>
				<div class="flex flex-1 flex-wrap gap-2">
					{#each Array(7) as _, i}
						<div class="skeleton h-12 w-20 flex-1 rounded-lg" style="animation-delay: {(i + 2) * 60}ms"></div>
					{/each}
				</div>
			</div>
		</div>
		<div class="shrink-0 px-4 py-3">
			<div class="skeleton rounded-lg" style="height: {chartHeight}px; animation-delay: 300ms"></div>
		</div>
		<div class="flex shrink-0 gap-2 border-b border-t border-bd/40 px-4 py-2">
			{#each Array(4) as _, i}
				<div class="skeleton h-5 w-16 rounded-md" style="animation-delay: {(i + 8) * 60}ms"></div>
			{/each}
		</div>
		<div class="space-y-2 p-4">
			{#each Array(5) as _, i}
				<div class="skeleton h-10 rounded-md" style="animation-delay: {(i + 12) * 60}ms"></div>
			{/each}
		</div>
	{:else if error}
		<div class="m-4 rounded-xl border border-bd/40 bg-s2 p-4">
			<div class="flex items-center gap-3">
				<div class="flex h-8 w-8 items-center justify-center rounded-full bg-red/10">
					<AlertTriangle class="h-4 w-4 text-red" />
				</div>
				<div>
					<div class="flex items-center gap-2">
						<span class="text-base font-bold text-tx">{shortAddress(address)}</span>
						<ChainIcon chain={chain} class="h-4 w-4 text-tx" />
					</div>
					<span class="text-sm text-red">Token data unavailable</span>
				</div>
			</div>
		</div>
	{:else if token}
		<div class="shrink-0 border-b border-bd/40 px-2 md:px-4 py-2">
			<!-- Mobile compact header -->
			<div class="flex md:hidden items-center gap-2">
				<div
					class="relative h-8 w-8 shrink-0 rounded-lg p-[2px]"
					style={isGraduated ? 'background: var(--t-yel)' : migPct > 0 ? `background: conic-gradient(var(--t-grn) ${migPct * 3.6}deg, var(--t-bd2) ${migPct * 3.6}deg)` : 'background: var(--t-s5)'}
				>
					{#if token.tokenAddress}
						<img src={tokenImage(token.chain, token.tokenAddress)} alt="" class="h-full w-full rounded-[6px] object-cover" />
					{:else}
						<div class="flex h-full w-full items-center justify-center rounded-[6px] bg-s7 text-sm font-bold text-tx">{(token.tokenSymbol ?? '?').slice(0, 2)}</div>
					{/if}
					{#if isGraduated}
						<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-s6 px-1 text-[8px] font-bold text-yel ring-1 ring-yel/20">GRAD</span>
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1">
						<span class="truncate text-sm font-bold text-tx">{token.tokenSymbol ?? '???'}</span>
						<span class="text-xs text-g6">/</span>
						<span class="text-xs text-g7">{token.quoteTokenSymbol ?? ''}</span>
						<span class="relative inline-flex items-center ml-0.5" title={chain}>
							<img src="/icons/{chain.toLowerCase()}.png" alt={chain} class="h-4 w-4 rounded-full" />
							{#if routerIconUrl}
								<img src={routerIconUrl} alt={displayRouter.name} class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" />
							{/if}
						</span>
						{#if token.calls > 0}
							<button onclick={(e) => { callsPopoverOpen = !callsPopoverOpen; const r = e.currentTarget.getBoundingClientRect(); callsPopoverPos = { x: Math.min(r.left, window.innerWidth - 352), y: r.bottom }; }} class="cursor-pointer rounded bg-yel/10 px-1.5 py-px text-xs font-bold text-yel ring-1 ring-yel/20">{token.calls}</button>
						{/if}
					</div>
					<div class="flex items-center gap-1 text-[11px]">
						<CurrencyValue usd={token.quote.priceUsdStr} native={token.quote.priceNativeStr} chain={chain} mode="price" class="font-bold text-tx" iconClass="h-3 w-3 text-tx" />
						<span class="text-g5">MC {formatUsd(token.quote.marketCapUsdStr)}</span>
						{#if holdersCount !== null}<span class="text-g5">· {formatNumber(holdersCount)} holders</span>{/if}
						{#if token.tokenName}<span class="truncate text-g6">· {token.tokenName}</span>{/if}
					</div>
				</div>
				<button onclick={() => (mobileHeaderExpanded = !mobileHeaderExpanded)} class="shrink-0 cursor-pointer rounded-md p-1 text-g4 transition-colors hover:text-tx">
					<ChevronDown class="h-4 w-4 transition-transform {mobileHeaderExpanded ? 'rotate-180' : ''}" />
				</button>
			</div>
			{#if mobileHeaderExpanded}
				<div class="mt-2 space-y-1.5 md:hidden">
					<div class="flex items-center gap-1.5 flex-wrap">
						{#if socialLinks?.website}<a href={socialLinks.website} target="_blank" rel="noopener" title="Website" class="flex h-6 w-6 items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:text-grn"><Globe class="h-3.5 w-3.5" /></a>{/if}
						{#if socialLinks?.twitter}<a href={socialLinks.twitter} target="_blank" rel="noopener" title={socialLinks.twitterHandle ? `@${socialLinks.twitterHandle}` : 'Twitter'} class="flex h-6 w-6 items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:text-grn"><svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg></a>{/if}
						{#if socialLinks?.telegram}<a href={socialLinks.telegram} target="_blank" rel="noopener" title="Telegram" class="flex h-6 w-6 items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:text-grn"><svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d={siTelegram.path}/></svg></a>{/if}
						{#if socialLinks?.instagram}<a href={socialLinks.instagram} target="_blank" rel="noopener" title="Instagram" class="flex h-6 w-6 items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:text-grn"><svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d={siInstagram.path}/></svg></a>{/if}
						{#if socialLinks?.discord}<a href={socialLinks.discord} target="_blank" rel="noopener" title="Discord" class="flex h-6 w-6 items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:text-grn"><svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d={siDiscord.path}/></svg></a>{/if}
						{#if aiNarrative}
							<button onclick={() => (aiNarrativeOpen = !aiNarrativeOpen)} class="flex h-6 w-6 items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:text-grn" aria-label="AI summary" title="AI summary"><Sparkles class="h-3.5 w-3.5" /></button>
						{/if}
						{#if getIsLoggedIn()}
							<button onclick={toggleFavourite} disabled={favToggling} class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-s7 transition-colors {isFav ? 'text-pnk' : 'text-g7 hover:text-pnk'} disabled:opacity-50"><Heart class="h-3.5 w-3.5" fill={isFav ? 'currentColor' : 'none'} /></button>
						{/if}
						<button onclick={copyAddress} class="rounded-md px-1.5 py-0.5 text-[11px] text-g7 transition-colors hover:bg-s7 hover:text-tx">{copied ? 'Copied!' : shortAddress(token.tokenAddress ?? address)}</button>
						<span class="text-[11px] text-g6">{liveAge(tokenBirth, getNow())}</span>
						{#if pairs.length > 1}
							<button onclick={() => (pairsOpen = !pairsOpen)} class="flex cursor-pointer items-center gap-0.5 rounded-md border border-bd bg-s4 px-1.5 py-0.5 text-[10px] text-g9 hover:text-tx">
								{#if selectedPairIdx !== null && pairs[selectedPairIdx]}{getRouterInfo(pairs[selectedPairIdx].platformType ?? '').name}{:else}{pairs.find(p => p.isBestPair) ? getRouterInfo(pairs.find(p => p.isBestPair)!.platformType ?? '').name : 'Best'}{/if}
								<ChevronDown class="h-2.5 w-2.5" />
							</button>
						{/if}
					</div>
					{#if aiNarrative && aiNarrativeOpen}
						<div class="rounded-lg border border-bd bg-s2 p-2.5">
							<div class="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-g5">
								<Sparkles class="h-2.5 w-2.5" /> AI Summary
							</div>
							<p class="text-[11px] leading-relaxed text-g8">{aiNarrative}</p>
						</div>
					{/if}
					<div class="grid grid-cols-4 gap-1">
						<div class="rounded border border-bd/30 bg-s2 px-1.5 py-1"><div class="text-[8px] font-medium uppercase text-g7">Liq</div><CurrencyValue usd={token.quote.liquidityUsdStr} native={token.quote.liquidityNativeStr} chain={chain} mode="value" class="text-[11px] font-bold text-tx" iconClass="h-3 w-3 text-tx" /></div>
						<div class="rounded border border-bd/30 bg-s2 px-1.5 py-1"><div class="text-[8px] font-medium uppercase text-g7">Vol 24h</div><div class="text-[11px] font-bold text-tx">{formatUsd(token.stats.total.volumeStr)}</div></div>
						<div class="rounded border border-bd/30 bg-s2 px-1.5 py-1"><div class="text-[8px] font-medium uppercase text-g7">ATH</div><CurrencyValue usd={liveAthDisplay.usdStr} native={liveAthDisplay.nativeStr} chain={chain} mode="price" class="text-[11px] font-bold text-tx" iconClass="h-3 w-3 text-tx" /></div>
						<div class="rounded border border-bd/30 bg-s2 px-1.5 py-1"><div class="text-[8px] font-medium uppercase text-g7">ATH x</div><div class="text-[11px] font-bold text-tx">{liveAthMultDisplay ? formatMultiplier(liveAthMultDisplay) : '—'}</div></div>
					</div>
					<div class="flex items-center gap-1 flex-wrap">
						<span class="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium {token.audit.mintable ? 'bg-red/10 text-red' : 'bg-grn/10 text-grn'}">
							{#if token.audit.mintable}<ShieldAlert size={9} />{:else}<ShieldCheck size={9} />{/if}
							Mint {token.audit.mintable ? 'On' : 'Off'}
						</span>
						<span class="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium {token.audit.freezable ? 'bg-red/10 text-red' : 'bg-grn/10 text-grn'}">
							<Snowflake size={9} />
							Freeze {token.audit.freezable ? 'On' : 'Off'}
						</span>
						{#if token.audit.lpLockedPct >= 50}
							<span class="flex items-center gap-0.5 rounded bg-grn/10 px-1 py-0.5 text-[9px] font-medium text-grn"><ShieldCheck size={9} /> LP {token.audit.lpLockedPct.toFixed(0)}%</span>
						{:else if token.audit.lpLockedPct >= 25}
							<span class="flex items-center gap-0.5 rounded bg-yel/10 px-1 py-0.5 text-[9px] font-medium text-yel"><ShieldAlert size={9} /> LP {token.audit.lpLockedPct.toFixed(0)}%</span>
						{:else}
							<span class="flex items-center gap-0.5 rounded bg-red/10 px-1 py-0.5 text-[9px] font-medium text-red"><ShieldAlert size={9} /> LP{token.audit.lpLockedPct > 0 ? ` ${token.audit.lpLockedPct.toFixed(0)}%` : ' 0%'}</span>
						{/if}
						{#if token.audit.dexScreenerPaid}
							<span class="flex items-center gap-0.5 rounded bg-yel/10 px-1 py-0.5 text-[9px] font-medium text-yel"><DexPaidIcon class="h-2.5 w-2.5 text-yel" /> Dex Paid</span>
						{/if}
						{#if isMayhem}
							<span class="flex items-center gap-0.5 rounded bg-org/10 px-1 py-0.5 text-[9px] font-medium text-org"><Flame size={9} /> Mayhem</span>
						{/if}
						{#if cashbackPct > 0}
							<span class="flex items-center gap-0.5 rounded bg-grn/10 px-1 py-0.5 text-[9px] font-medium text-grn"><Coins size={9} /> {cashbackPct}% Cashback</span>
						{/if}
					</div>
				</div>
			{/if}
			<!-- Desktop header -->
			<div class="hidden md:flex md:flex-row md:items-center gap-2 md:gap-6">
				<div class="shrink-0">
					<div class="flex items-center gap-3">
						<div
							class="group relative h-10 w-10 md:h-12 md:w-12 shrink-0 rounded-xl p-[3px]"
							style={isGraduated
								? 'background: var(--t-yel)'
								: migPct > 0
									? `background: conic-gradient(var(--t-grn) ${migPct * 3.6}deg, var(--t-bd2) ${migPct * 3.6}deg)`
									: 'background: var(--t-s5)'}
						>
								{#if token.tokenAddress}
								{@const tokenImageUrl = tokenImage(token.chain, token.tokenAddress)}
								<img src={tokenImageUrl} alt="" class="h-full w-full rounded-[9px] object-cover" />
								<div class="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden h-[200px] w-[200px] rounded-xl border border-bd bg-s4 p-1 shadow-2xl group-hover:block">
									<img src={tokenImageUrl} alt="" class="h-full w-full rounded-lg object-cover" />
								</div>
							{:else}
								<div class="flex h-full w-full items-center justify-center rounded-[9px] bg-s7">
									<span class="text-lg font-bold text-tx">{(token.tokenSymbol ?? '?').slice(0, 2)}</span>
								</div>
							{/if}
							{#if isGraduated}
								<span class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-md bg-s6 px-1.5 py-0.5 text-[10px] font-bold leading-none text-yel ring-1 ring-yel/20">GRAD</span>
							{:else if migPct > 0}
								<span class="absolute -bottom-1 -right-1 rounded-md bg-s6 px-1 py-0.5 text-[10px] font-bold leading-none text-grn ring-1 ring-bd">{migPct.toFixed(0)}%</span>
							{/if}
						</div>
							<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-1.5 md:gap-2">
								<span class="text-base md:text-xl font-bold text-tx">{token.tokenSymbol ?? '???'}</span>
								<span class="text-base text-g6">/</span>
								<span class="text-base text-g7">{token.quoteTokenSymbol ?? ''}</span>
								{#if pairs.length > 1}
									<div class="relative">
										<button
											onclick={() => (pairsOpen = !pairsOpen)}
											class="flex cursor-pointer items-center gap-1 rounded-md border border-bd bg-s4 px-2 py-0.5 text-xs text-g9 transition-colors hover:text-tx"
										>
											{#if selectedPairIdx !== null && pairs[selectedPairIdx]}
												{@const sp = pairs[selectedPairIdx]}
												{getRouterInfo(sp.platformType ?? '').name}
											{:else}
												{pairs.find(p => p.isBestPair) ? getRouterInfo(pairs.find(p => p.isBestPair)!.platformType ?? '').name : 'Best'}
											{/if}
											<ChevronDown class="h-3 w-3" strokeWidth={2} />
										</button>
										{#if pairsOpen}
											<button class="fixed inset-0 z-40" onclick={() => (pairsOpen = false)} aria-label="Close"></button>
											<div class="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-bd bg-s5 shadow-2xl">
												<div class="max-h-60 overflow-y-auto py-1">
													{#each pairs as pair, i (pair.pairAddress)}
														{@const ri = getRouterInfo(pair.platformType ?? '')}
														<div
															role="button"
															tabindex="0"
															onclick={() => selectPair(pair.isBestPair ? null : i)}
															onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPair(pair.isBestPair ? null : i); } }}
															class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-wh/5 {(selectedPairIdx === null && pair.isBestPair) || selectedPairIdx === i ? 'bg-wh/5' : ''}"
														>
															{#if ri.icon}
																<img src={ri.icon} alt={ri.name} class="h-4 w-4 rounded-full" />
															{/if}
															<div class="min-w-0 flex-1">
																<div class="flex items-center gap-1.5">
																	<span class="text-xs font-medium text-tx">{ri.name}</span>
																	{#if pair.isBestPair}
																		<span class="rounded bg-grn/10 px-1 py-px text-[9px] font-medium text-grn">Best</span>
																	{/if}
																	<button
																		onclick={(e) => { e.stopPropagation(); copyPairAddress(pair.pairAddress); }}
																		class="ml-auto shrink-0 cursor-pointer rounded px-1 py-px text-[10px] text-g5 transition-colors hover:bg-s7 hover:text-tx"
																		title="Copy pair address"
																	>{copiedPair === pair.pairAddress ? 'Copied!' : shortAddress(pair.pairAddress)}</button>
																</div>
																<div class="text-[10px] text-g5">Liq {formatMarketCap(pair.liquidityUsdStr)}</div>
																<div class="text-[10px] text-g5">Vol {formatMarketCap(pair.volume24hUsdStr)}</div>
															</div>
														</div>
													{/each}
												</div>
											</div>
										{/if}
									</div>
								{/if}
								{#if token.calls > 0}
									<button
										onclick={(e) => { callsPopoverOpen = !callsPopoverOpen; const r = e.currentTarget.getBoundingClientRect(); callsPopoverPos = { x: Math.min(r.left, window.innerWidth - 352), y: r.bottom }; }}
										class="flex cursor-pointer items-center rounded-lg bg-yel/10 px-2.5 py-0.5 text-lg font-bold text-yel ring-1 ring-yel/20 transition-all hover:bg-yel/20 hover:ring-yel/40"
									>
										{token.calls}
									</button>
								{/if}
								<span class="relative inline-flex items-center" title={chain}>
									<img src="/icons/{chain.toLowerCase()}.png" alt={chain} class="h-5 w-5 rounded-full" />
									{#if routerIconUrl}
										<img src={routerIconUrl} alt={displayRouter.name} class="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-s6 ring-1 ring-s6" title={displayRouter.name} />
									{/if}
									{#if migratedFromIcon}
										<img src={migratedFromIcon} alt="Migrated from" class="absolute -top-1 -left-2 h-3 w-3 rounded-full bg-s6 ring-1 ring-s6" title="Migrated from {(token.launchPad?.bondingCurve as any)?.migratedFromPlatformName ?? ''}" />
									{/if}
								</span>
							</div>
							<div class="text-sm text-g7">{#if token.tokenName}{token.tokenName}{/if}{#if holdersCount !== null}<span class="text-g5">{token.tokenName ? ' · ' : ''}{formatNumber(holdersCount)} holders</span>{/if}</div>
							<div class="mt-0.5 flex items-center gap-2">
								{#if socialLinks}
									{#if socialLinks.website}
										<a href={socialLinks.website} target="_blank" rel="noopener" class="flex h-7 w-7 items-center justify-center rounded-lg bg-s7 text-g7 transition-colors hover:text-grn" title="Website">
											<Globe class="h-4 w-4" />
										</a>
									{/if}
									{#if socialLinks.twitter}
										{#if hasCommunityInfo}
											<div class="group/x relative">
												<a href={socialLinks.twitter} target="_blank" rel="noopener" class="flex h-7 w-7 items-center justify-center rounded-lg bg-s7 text-g7 transition-colors hover:text-grn" title={socialLinks.twitterHandle ? `@${socialLinks.twitterHandle}` : 'Twitter'}>
													<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg>
												</a>
												<!-- pt-1.5 keeps a transparent hover bridge so the cursor can travel from the icon into the panel -->
												<div class="invisible absolute left-0 top-full z-50 w-80 max-w-[calc(100vw-2rem)] origin-top-left scale-95 pt-1.5 opacity-0 transition-all duration-150 group-hover/x:visible group-hover/x:scale-100 group-hover/x:opacity-100">
													<div class="space-y-2.5 rounded-lg border border-bd bg-s5 p-3 shadow-2xl">
													{#if twitterCommunity}
														<div>
															<div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-g5">
																<Users class="h-3 w-3" /> Twitter Community
															</div>
															<div class="flex items-start justify-between gap-2">
																<a href={`https://x.com/i/communities/${twitterCommunity.id}`} target="_blank" rel="noopener" class="min-w-0 truncate text-sm font-semibold text-tx transition-colors hover:text-grn">{twitterCommunity.name}</a>
																{#if twitterCommunity.memberCount != null}
																	<span class="shrink-0 tabular-nums text-xs text-g6">{formatCompactNumber(twitterCommunity.memberCount)} members</span>
																{/if}
															</div>
															{#if twitterCommunity.memberPreview?.length}
																<div class="mt-1.5 flex items-center gap-2">
																	<div class="flex -space-x-2">
																		{#each twitterCommunity.memberPreview.slice(0, 6) as m}
																			{#if m.profileImageUrl}
																				<img src={m.profileImageUrl} alt={m.name} title={`@${m.screenName}`} class="h-5 w-5 rounded-full object-cover ring-2 ring-s5" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
																			{:else}
																				<div class="flex h-5 w-5 items-center justify-center rounded-full bg-s7 text-[8px] font-bold text-g7 ring-2 ring-s5" title={`@${m.screenName}`}>{(m.name?.[0] ?? '?').toUpperCase()}</div>
																			{/if}
																		{/each}
																	</div>
																	{#if twitterCommunity.creator}
																		<a href={`https://x.com/${twitterCommunity.creator.screenName}`} target="_blank" rel="noopener" class="truncate text-[11px] text-g5 transition-colors hover:text-tx">by <span class="text-g7">@{twitterCommunity.creator.screenName}</span></a>
																	{/if}
																</div>
															{/if}
														</div>
													{/if}
													{#if communityTokens && communityTokens.count > 0}
														<div>
															<div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-g5">
																<Users class="h-3 w-3" /> Connected to
																<span class="rounded bg-s7 px-1 py-px text-[9px] font-bold text-g7">{communityTokens.count}</span>
															</div>
															<div class="flex flex-wrap gap-1">
																{#each communityTokens.tokens.slice(0, 8) as rt}
																	<a href={communityTokenHref(rt)} class="flex max-w-[130px] items-center gap-1 rounded-md border border-bd bg-s4 px-1.5 py-0.5 text-[11px] transition-colors hover:bg-s7">
																		<img src={tokenImage(chain, rt.tokenAddress)} alt="" class="h-3.5 w-3.5 shrink-0 rounded-full object-cover" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
																		<span class="truncate font-semibold text-tx">{rt.symbol || shortAddress(rt.tokenAddress)}</span>
																	</a>
																{/each}
															</div>
														</div>
													{/if}
													</div>
												</div>
											</div>
										{:else}
											<a href={socialLinks.twitter} target="_blank" rel="noopener" class="flex h-7 w-7 items-center justify-center rounded-lg bg-s7 text-g7 transition-colors hover:text-grn" title={socialLinks.twitterHandle ? `@${socialLinks.twitterHandle}` : 'Twitter'}>
												<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg>
											</a>
										{/if}
									{/if}
									{#if socialLinks.telegram}
										<a href={socialLinks.telegram} target="_blank" rel="noopener" class="flex h-7 w-7 items-center justify-center rounded-lg bg-s7 text-g7 transition-colors hover:text-grn" title="Telegram">
											<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d={siTelegram.path}/></svg>
										</a>
									{/if}
									{#if socialLinks.instagram}
										<a href={socialLinks.instagram} target="_blank" rel="noopener" class="flex h-7 w-7 items-center justify-center rounded-lg bg-s7 text-g7 transition-colors hover:text-grn" title="Instagram">
											<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d={siInstagram.path}/></svg>
										</a>
									{/if}
									{#if socialLinks.discord}
										<a href={socialLinks.discord} target="_blank" rel="noopener" class="flex h-7 w-7 items-center justify-center rounded-lg bg-s7 text-g7 transition-colors hover:text-grn" title="Discord">
											<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d={siDiscord.path}/></svg>
										</a>
									{/if}
							{/if}
							{#if aiNarrative}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="group/ai relative">
									<div class="flex h-7 w-7 cursor-help items-center justify-center rounded-lg bg-s7 text-g7 transition-colors hover:text-grn" aria-label="AI summary">
										<Sparkles class="h-4 w-4" />
									</div>
									<div class="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-2rem)] origin-top-left scale-95 rounded-lg border border-bd bg-s5 p-3 opacity-0 shadow-2xl transition-all duration-150 group-hover/ai:scale-100 group-hover/ai:opacity-100">
										<div class="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-g5">
											<Sparkles class="h-3 w-3" /> AI Summary
										</div>
										<p class="text-[13px] leading-relaxed text-g8">{aiNarrative}</p>
									</div>
								</div>
							{/if}
							{#if getIsLoggedIn()}
								<button
									onclick={toggleFavourite}
									disabled={favToggling}
									class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-s7 transition-colors {isFav ? 'text-pnk' : 'text-g7 hover:text-pnk'} disabled:opacity-50"
									aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
									title={isFav ? 'Remove from favourites' : 'Add to favourites'}
								>
									<Heart class="h-4 w-4" fill={isFav ? 'currentColor' : 'none'} />
								</button>
							{/if}
							<button
								onclick={copyAddress}
								class="rounded-lg px-2 py-0.5 text-sm text-g7 transition-colors hover:bg-s7 hover:text-tx"
								aria-label="Copy address"
							>
								{copied ? 'Copied!' : shortAddress(token.tokenAddress ?? address)}
							</button>
							<span class="text-sm text-g6">{liveAge(tokenBirth, getNow())}</span>
							</div>
						</div>
					</div>
				</div>

				<div class="grid min-w-0 flex-1 grid-cols-3 md:grid-cols-6 gap-1 mobile-scroll-x">
					<div class="rounded border border-bd/30 bg-s2 px-2 py-1 transition-colors hover:border-bd/60">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g7">Price</div>
						<CurrencyValue usd={token.quote.priceUsdStr} native={token.quote.priceNativeStr} chain={chain} mode="price" class="text-xs font-bold text-tx" iconClass="h-3 w-3 text-tx" />
					</div>
					<div class="rounded border border-bd/30 bg-s2 px-2 py-1 transition-colors hover:border-bd/60">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g7">Liquidity</div>
						<CurrencyValue usd={token.quote.liquidityUsdStr} native={token.quote.liquidityNativeStr} chain={chain} mode="value" class="text-xs font-bold text-tx" iconClass="h-3 w-3 text-tx" />
					</div>
					<div class="rounded border border-bd/30 bg-s2 px-2 py-1 transition-colors hover:border-bd/60">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g7">Vol 24h</div>
						<span class="inline-flex items-center gap-1 text-xs font-bold text-tx">{formatUsd(token.stats.total.volumeStr)}</span>
					</div>
					<div class="rounded border border-bd/30 bg-s2 px-2 py-1 transition-colors hover:border-bd/60">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g7">MCap</div>
						<span class="inline-flex items-center gap-1 text-xs font-bold text-tx">{formatUsd(token.quote.marketCapUsdStr)}</span>
					</div>
					<div class="rounded border border-bd/30 bg-s2 px-2 py-1 transition-colors hover:border-bd/60">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g7">ATH</div>
						<CurrencyValue usd={liveAthDisplay.usdStr} native={liveAthDisplay.nativeStr} chain={chain} mode="price" class="text-xs font-bold text-tx" iconClass="h-3 w-3 text-tx" />
					</div>
					<div class="rounded border border-bd/30 bg-s2 px-2 py-1 transition-colors hover:border-bd/60">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g7">Fees 24h</div>
						<CurrencyValue usd={token.stats.timeframes['24h'].fees.totalFeeUsdStr} native={token.stats.timeframes['24h'].fees.totalFeeNativeStr} chain={chain} mode="value" class="text-xs font-bold text-tx" iconClass="h-3 w-3 text-tx" />
					</div>
					<div class="col-span-4 flex items-center gap-1.5 pt-0.5">
						<span class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium {token.audit.mintable ? 'bg-red/10 text-red' : 'bg-grn/10 text-grn'}" title="Mint Authority">
							{#if token.audit.mintable}<ShieldAlert size={10} strokeWidth={2} />{:else}<ShieldCheck size={10} strokeWidth={2} />{/if}
							Mint {token.audit.mintable ? 'On' : 'Off'}
						</span>
						<span class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium {token.audit.freezable ? 'bg-red/10 text-red' : 'bg-grn/10 text-grn'}" title="Freeze Authority">
							<Snowflake size={10} strokeWidth={2} />
							Freeze {token.audit.freezable ? 'On' : 'Off'}
						</span>
						{#if token.audit.lpLockedPct >= 50}
							<span class="flex items-center gap-1 rounded bg-grn/10 px-1.5 py-0.5 text-[10px] font-medium text-grn" title="LP Locked {token.audit.lpLockedPct.toFixed(0)}%">
								<ShieldCheck size={10} strokeWidth={2} />
								LP {token.audit.lpLockedPct.toFixed(0)}%
							</span>
						{:else if token.audit.lpLockedPct >= 25}
							<span class="flex items-center gap-1 rounded bg-yel/10 px-1.5 py-0.5 text-[10px] font-medium text-yel" title="LP Locked {token.audit.lpLockedPct.toFixed(0)}%">
								<ShieldAlert size={10} strokeWidth={2} />
								LP {token.audit.lpLockedPct.toFixed(0)}%
							</span>
						{:else}
							<span class="flex items-center gap-1 rounded bg-red/10 px-1.5 py-0.5 text-[10px] font-medium text-red" title="LP{token.audit.lpLockedPct > 0 ? ` ${token.audit.lpLockedPct.toFixed(0)}%` : ' Unlocked'}">
								<ShieldAlert size={10} strokeWidth={2} />
								LP{token.audit.lpLockedPct > 0 ? ` ${token.audit.lpLockedPct.toFixed(0)}%` : ' Unlocked'}
							</span>
						{/if}
						{#if token.audit.dexScreenerPaid}
							<span class="flex items-center gap-1 rounded bg-yel/10 px-1.5 py-0.5 text-[10px] font-medium text-yel" title="DexScreener Paid">
								<DexPaidIcon class="h-2.5 w-2.5 text-yel" />
								Dex Paid
							</span>
						{/if}
						{#if isMayhem}
							<span class="flex items-center gap-1 rounded bg-org/10 px-1.5 py-0.5 text-[10px] font-medium text-org" title="Pump.fun Mayhem">
								<Flame size={10} strokeWidth={2} />
								Mayhem
							</span>
						{/if}
						{#if cashbackPct > 0}
							<span class="flex items-center gap-1 rounded bg-grn/10 px-1.5 py-0.5 text-[10px] font-medium text-grn" title="Cashback {cashbackPct}%">
								<Coins size={10} strokeWidth={2} />
								{cashbackPct}% Cashback
							</span>
						{/if}
					</div>
				</div>
			</div>
			{#if pairsOpen && pairs.length > 1}
				<div class="md:hidden" use:portal>
					<button class="fixed inset-0 z-[190] bg-s0/60" onclick={() => (pairsOpen = false)} aria-label="Close"></button>
					<div class="fixed left-2 right-2 bottom-[7.5rem] z-[191] max-h-60 overflow-y-auto rounded-xl border border-bd bg-s5 py-1 shadow-2xl">
						{#each pairs as pair, i (pair.pairAddress)}
							{@const ri = getRouterInfo(pair.platformType ?? '')}
							<div role="button" tabindex="0" onclick={() => selectPair(pair.isBestPair ? null : i)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPair(pair.isBestPair ? null : i); } }} class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-wh/5 {(selectedPairIdx === null && pair.isBestPair) || selectedPairIdx === i ? 'bg-wh/5' : ''}">
								{#if ri.icon}<img src={ri.icon} alt={ri.name} class="h-4 w-4 rounded-full" />{/if}
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span class="text-xs font-medium text-tx">{ri.name}</span>
										{#if pair.isBestPair}<span class="rounded bg-grn/10 px-1 py-px text-[9px] font-medium text-grn">Best</span>{/if}
										<button onclick={(e) => { e.stopPropagation(); copyPairAddress(pair.pairAddress); }} class="ml-auto shrink-0 cursor-pointer rounded px-1 py-px text-[10px] text-g5 transition-colors hover:bg-s7 hover:text-tx" title="Copy pair address">{copiedPair === pair.pairAddress ? 'Copied!' : shortAddress(pair.pairAddress)}</button>
									</div>
									<div class="text-[10px] text-g5">Liq {formatMarketCap(pair.liquidityUsdStr)}</div>
									<div class="text-[10px] text-g5">Vol {formatMarketCap(pair.volume24hUsdStr)}</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if !loading && token}
	<div class="shrink-0 px-2 md:px-4 py-2 md:py-3">
		<TokenChart {chain} address={resolvedAddress} {chartHeight} athPrice={token.athPriceUsdStr} athMcap={token.athMarketCapUsdStr} onopentrader={openTrader} tokenSymbol={token.tokenSymbol} {active} />
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="group/resize flex h-3 md:h-2 shrink-0 cursor-row-resize items-center justify-center border-t border-bd/40 transition-colors hover:bg-s7 touch-none {dragging ? 'bg-s7' : ''}"
		onmousedown={onDragStart}
		ontouchstart={onTouchDragStart}
		onkeydown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); chartHeight = Math.max(200, chartHeight - 20); } else if (e.key === 'ArrowDown') { e.preventDefault(); chartHeight = Math.min(800, chartHeight + 20); } }}
		role="separator"
		aria-orientation="horizontal"
		aria-valuenow={chartHeight}
		aria-valuemin={200}
		aria-valuemax={800}
		tabindex="0"
	>
		<div class="h-[2px] w-10 rounded-full bg-g1 transition-colors group-hover/resize:bg-grn {dragging ? '!bg-grn' : ''}"></div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col {dragging ? 'select-none' : ''}">
		<div class="flex shrink-0 items-center border-b border-bd/40 overflow-x-auto scrollbar-none">
			{#each detailTabs as tab}
				<button
					class="relative shrink-0 cursor-pointer px-3 md:px-4 py-2 text-xs md:text-sm font-medium transition-colors {activeTab === tab
						? 'text-tx'
						: 'text-g6 hover:text-g9'}"
					onclick={() => (activeTab = tab)}
				>
					{tab}
					{#if tab === 'Holders' && holders}
						<span class="ml-1 text-xs text-g6">({formatNumber(holders.holderCount)})</span>
					{/if}
					{#if activeTab === tab}
						<span class="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-grn"></span>
					{/if}
				</button>
			{/each}
			{#if activeTab === 'Trades'}
				<button onclick={() => (tradeFiltersOpen = !tradeFiltersOpen)} class="ml-auto mr-2 flex cursor-pointer items-center justify-center rounded-lg border transition-colors {tradeFiltersOpen || hasTradeFilters ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd bg-s4 text-g6 hover:text-tx'} h-6 w-6 shrink-0"><Filter class="h-3 w-3" /></button>
			{/if}
		</div>

		<div class="flex min-h-0 flex-1 flex-col p-2 md:p-4 {activeTab === 'Trades' ? 'overflow-hidden' : 'overflow-auto'}" onscroll={onDetailScroll}>
			{#if activeTab === 'Trades'}
			{#if tradeFiltersOpen}
				<div class="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-bd/50 bg-s4/40 px-2.5 py-1.5">
					<div class="flex gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
						{#each ['ALL', 'BUY', 'SELL'] as side}
							<button onclick={() => { tradeFilterSide = side as typeof tradeFilterSide; refetchTrades(); }} class="cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors {tradeFilterSide === side ? side === 'BUY' ? 'bg-grn/20 text-grn' : side === 'SELL' ? 'bg-red/20 text-red' : 'bg-wh/10 text-tx' : 'text-g5 hover:text-g9'}">{side === 'ALL' ? 'All' : side === 'BUY' ? 'Buys' : 'Sells'}</button>
						{/each}
					</div>
					<div class="flex items-center gap-1">
						<span class="text-[10px] text-g5">USD</span>
						<input type="text" placeholder="Min" bind:value={tradeFilterMinUsd} oninput={debouncedRefetchTrades} class="w-14 rounded border border-bd bg-s4 px-1.5 py-0.5 text-[10px] text-tx placeholder-g3 outline-none focus:border-grn/40" />
						<span class="text-[9px] text-g5">-</span>
						<input type="text" placeholder="Max" bind:value={tradeFilterMaxUsd} oninput={debouncedRefetchTrades} class="w-14 rounded border border-bd bg-s4 px-1.5 py-0.5 text-[10px] text-tx placeholder-g3 outline-none focus:border-grn/40" />
					</div>
					<div class="flex items-center gap-1">
						<span class="text-[10px] text-g5">Maker</span>
						<input type="text" placeholder="Address..." bind:value={tradeFilterMaker} oninput={debouncedRefetchTrades} class="w-28 rounded border border-bd bg-s4 px-1.5 py-0.5 text-[10px] text-tx placeholder-g3 outline-none focus:border-grn/40" />
					</div>
					{#if tradeFilterMaker && !tradeFiltersOpen}
						<span class="flex items-center gap-1 rounded-md bg-grn/10 px-1.5 py-0.5 text-[10px] text-grn">
							{shortAddress(tradeFilterMaker)}
							<button onclick={() => { tradeFilterMaker = ''; refetchTrades(); }} class="cursor-pointer hover:text-tx"><XIcon class="h-2.5 w-2.5" /></button>
						</span>
					{/if}
					{#if hasTradeFilters}
						<button onclick={clearTradeFilters} class="flex cursor-pointer items-center gap-1 text-[10px] text-g4 transition-colors hover:text-tx"><XIcon class="h-3 w-3" /> Clear</button>
						<span class="ml-auto text-[10px] text-g5">{tradeCount} results</span>
					{/if}
				</div>
			{/if}
			{#if tradesLoading}
				<div class="space-y-2">
						{#each Array(5) as _, i}
							<div class="skeleton h-8 rounded-md" style="animation-delay: {i * 60}ms"></div>
						{/each}
					</div>
				{:else if tradeCount === 0}
					<div class="py-6 text-center text-sm text-g7">No trades found</div>
				{:else}
					<div class="min-h-0 flex-1 text-sm">
						<VirtualSwapList {liveTrades} {historicalTrades} {tradeCount} {chain} filteredMaker={tradeFilterMaker} loadingMore={tradesLoadingMore} onLoadMore={loadMoreTrades} onOpenTrader={openTrader} onFilterMaker={filterByMaker} />
					</div>
				{/if}

			{:else if activeTab === 'Top Traders'}
				<!-- Top Traders fundingSource is server-enriched in one bounded batch. -->
				{#if tradersLoading}
					<div class="space-y-2">
						{#each Array(5) as _, i}
							<div class="skeleton h-8 rounded-md" style="animation-delay: {i * 60}ms"></div>
						{/each}
					</div>
				{:else if topTraders.length === 0}
					<div class="py-6 text-center text-sm text-g7">No top traders found</div>
				{:else}
					{#if !getIsDesktop()}
					<div class="space-y-0.5">
						{#each topTraders as trader (trader.walletAddress)}
							<div class="border-b border-bd/20 px-3 py-2">
								<div class="flex items-center gap-2">
									<span class="text-xs text-g5 w-5">#{trader.rank}</span>
									<button type="button" class="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-g7 transition-colors hover:text-tx" onclick={() => openTopTrader(trader)}>{(trader.labels ?? []).length > 0 ? trader.labels![0].label : shortAddress(trader.walletAddress)}</button>
									{#if (trader.labels ?? []).length > 0}<span class="shrink-0 rounded bg-s7 px-1.5 py-px font-mono text-[10px] font-medium text-g7">{shortAddress(trader.walletAddress)}</span>{/if}
									<a href={explorerAddressUrl(chain as string, trader.walletAddress)} target="_blank" rel="noopener" class="p-1 text-g4 transition-colors hover:text-tx" aria-label="Open wallet in explorer" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><ExternalLink class="h-3 w-3" /></a>
									<span class="text-sm font-bold {percentColor(trader.pnlUsd)}">{formatUsd(trader.pnlUsdStr)}</span>
								</div>
								{#if trader.pnlSparkline && trader.pnlSparkline.tokenPnlUsd && trader.pnlSparkline.tokenPnlUsd.length > 1}
									{@const mobileSpk = trader.pnlSparkline.tokenPnlUsd}
									{@const sMin = Math.min(...mobileSpk)}
									{@const sMax = Math.max(...mobileSpk)}
									{@const sRange = sMax - sMin || 1}
									{@const sColor = mobileSpk[mobileSpk.length - 1] >= 0 ? 'var(--t-grn)' : 'var(--t-red)'}
									<svg viewBox="0 0 100 20" class="mt-0.5 h-4 w-full" preserveAspectRatio="none">
										<polyline points={mobileSpk.map((v, i) => `${(i / (mobileSpk.length - 1)) * 100},${20 - ((v - sMin) / sRange) * 20}`).join(' ')} fill="none" stroke={sColor} stroke-width="1.5" stroke-linejoin="round" />
									</svg>
								{/if}
								<div class="mt-0.5 flex items-center gap-3 text-[11px]">
									<span class="text-g5">Inv <span class="text-g7">{formatUsd(trader.boughtUsdStr)}</span></span>
									<span class="text-g5">Sold <span class="text-g7">{formatUsd(trader.soldUsdStr)}</span></span>
									<span class="text-g5">Rem <span class="text-g7">{formatUsd(trader.remainingUsdStr)}</span></span>
									<span class="ml-auto text-grn">{trader.buys} buys</span>
									<span class="text-red">{trader.sells} sells</span>
								</div>
								<div class="mt-1 flex items-center text-[10px]">
									<FundingSourcePreview chain={chain} fundingSource={fundingSourceOf(trader)} compact />
								</div>
							</div>
						{/each}
					</div>
					{:else}
					<div>
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-bd text-g7">
									<th class="pb-2 text-left font-medium">#</th>
									<th class="pb-2 text-left font-medium">Address</th>
									<th class="pb-2 text-right font-medium">Invested</th>
									<th class="pb-2 text-right font-medium">Sold</th>
									<th class="pb-2 text-right font-medium">PnL</th>
									<th class="pb-2 font-medium w-20"></th>
									<th class="pb-2 text-right font-medium">Remaining</th>
									<th class="pb-2 text-right font-medium">Funding</th>
									<th class="pb-2 text-right font-medium">Buys</th>
									<th class="pb-2 text-right font-medium">Sells</th>
								</tr>
							</thead>
							<tbody>
								{#each topTraders as trader (trader.walletAddress)}
								<tr class="border-b border-bd/20 transition-colors hover:bg-wh/5">
										<td class="py-1.5 text-g6">{trader.rank}</td>
										<td class="py-1.5">
											<div class="flex items-center gap-1.5">
												<button type="button" class="cursor-pointer text-g7 transition-colors hover:text-tx" onclick={() => openTopTrader(trader)}>{(trader.labels ?? []).length > 0 ? trader.labels![0].label : shortAddress(trader.walletAddress)}</button>
												{#if (trader.labels ?? []).length > 0}<span class="shrink-0 rounded bg-s7 px-1.5 py-px font-mono text-[10px] font-medium text-g7">{shortAddress(trader.walletAddress)}</span>{/if}
												<a href={explorerAddressUrl(chain as string, trader.walletAddress)} target="_blank" rel="noopener" class="p-1 text-g4 transition-colors hover:text-tx" aria-label="Open wallet in explorer" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><ExternalLink class="h-3 w-3" /></a>
											</div>
										</td>
										<td class="py-1.5 text-right text-tx">{formatUsd(trader.boughtUsdStr)}</td>
										<td class="py-1.5 text-right text-tx">{formatUsd(trader.soldUsdStr)}</td>
										<td class="py-1.5 text-right {percentColor(trader.pnlUsd)}">{formatUsd(trader.pnlUsdStr)}</td>
										<td class="py-1.5 w-20">
											{#if trader.pnlSparkline && trader.pnlSparkline.tokenPnlUsd && trader.pnlSparkline.tokenPnlUsd.length > 1}
												{@const deskSpk = trader.pnlSparkline.tokenPnlUsd}
												{@const sMin = Math.min(...deskSpk)}
												{@const sMax = Math.max(...deskSpk)}
												{@const sRange = sMax - sMin || 1}
												{@const sColor = deskSpk[deskSpk.length - 1] >= 0 ? 'var(--t-grn)' : 'var(--t-red)'}
												<svg viewBox="0 0 80 16" class="h-4 w-full" preserveAspectRatio="none">
													<polyline points={deskSpk.map((v, i) => `${(i / (deskSpk.length - 1)) * 80},${16 - ((v - sMin) / sRange) * 16}`).join(' ')} fill="none" stroke={sColor} stroke-width="1.5" stroke-linejoin="round" />
												</svg>
											{/if}
										</td>
										<td class="py-1.5 text-right text-tx">{formatUsd(trader.remainingUsdStr)}</td>
										<td class="max-w-40 py-1.5 text-right"><FundingSourcePreview chain={chain} fundingSource={fundingSourceOf(trader)} /></td>
										<td class="py-1.5 text-right text-grn">{trader.buys}</td>
										<td class="py-1.5 text-right text-red">{trader.sells}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{/if}
				{/if}

			{:else if activeTab === 'Holders'}
				{#if holdersLoading}
					<div class="space-y-2">
						{#each Array(5) as _, i}
							<div class="skeleton h-8 rounded-md" style="animation-delay: {i * 60}ms"></div>
						{/each}
					</div>
				{:else if holders}
					{#if holders.distribution}
						<div class="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
							<div class="rounded-lg border border-bd/30 bg-s1 px-2 py-1.5 text-center">
								<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Top 10</div>
								<div class="text-sm font-bold {holders.distribution.top10Pct > 10 ? 'text-red' : 'text-tx'}">{holders.distribution.top10Pct.toFixed(1)}%</div>
							</div>
							<div class="rounded-lg border border-bd/30 bg-s1 px-2 py-1.5 text-center">
								<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Dev</div>
								<div class="text-sm font-bold {holders.distribution.devPct > 5 ? 'text-red' : 'text-tx'}">{holders.distribution.devPct.toFixed(1)}%</div>
							</div>
							<div class="rounded-lg border border-bd/30 bg-s1 px-2 py-1.5 text-center">
								<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Insiders</div>
								<div class="text-sm font-bold {holders.distribution.insiderPct > 5 ? 'text-red' : 'text-tx'}">{holders.distribution.insiderPct.toFixed(1)}%</div>
							</div>
							<div class="rounded-lg border border-bd/30 bg-s1 px-2 py-1.5 text-center">
								<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Bundlers</div>
								<div class="text-sm font-bold {holders.distribution.bundlerPct > 5 ? 'text-red' : 'text-tx'}">{holders.distribution.bundlerPct.toFixed(1)}%</div>
							</div>
							<div class="rounded-lg border border-bd/30 bg-s1 px-2 py-1.5 text-center">
								<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Snipers</div>
								<div class="text-sm font-bold text-red">{holders.distribution.sniperPct.toFixed(1)}%</div>
							</div>
						</div>
					{/if}
					{#if holders.holders && holders.holders.length > 0}
						{#if !getIsDesktop()}
						<div class="space-y-0.5">
							{#each holders.holders as holder (holder.walletAddress)}
								<div class="border-b border-bd/20 px-3 py-2">
									<div class="flex items-center gap-2">
										<button type="button" class="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-g7 transition-colors hover:text-tx" onclick={() => openTrader(holder.walletAddress ?? '')}>{(holder.labels ?? []).length > 0 ? holder.labels![0].label : shortAddress(holder.walletAddress ?? '')}</button>
										{#if (holder.labels ?? []).length > 0}<span class="shrink-0 rounded bg-s7 px-1.5 py-px font-mono text-[10px] font-medium text-g7">{shortAddress(holder.walletAddress ?? '')}</span>{/if}
										<a href={explorerAddressUrl(chain as string, holder.walletAddress ?? '')} target="_blank" rel="noopener" class="shrink-0 p-1 text-g4 transition-colors hover:text-tx" aria-label="Open wallet in explorer" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><ExternalLink class="h-3 w-3" /></a>
										<span class="text-sm font-bold text-tx">{holder.pct.toFixed(2)}%</span>
									</div>
									<div class="mt-0.5 flex items-center justify-between text-[11px]">
										<span class="text-g5">{formatNumber(holder.balanceTokenStr)} tokens</span>
										<span class="text-g7">{formatUsd(holder.balanceUsdStr)}</span>
									</div>
									<div class="mt-1 flex items-center text-[10px]">
										<FundingSourcePreview chain={chain} fundingSource={fundingSourceOf(holder)} compact />
									</div>
								</div>
							{/each}
						</div>
						{:else}
						<div>
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-bd text-g7">
										<th class="pb-2 text-left font-medium">Address</th>
										<th class="pb-2 text-right font-medium">Balance</th>
										<th class="pb-2 text-right font-medium">Value</th>
										<th class="pb-2 text-right font-medium">%</th>
										<th class="pb-2 text-right font-medium">Funding</th>
										<th class="pb-2 text-right font-medium">Label</th>
									</tr>
								</thead>
								<tbody>
									{#each holders.holders as holder (holder.walletAddress)}
										<tr class="border-b border-bd/20 transition-colors hover:bg-wh/5">
												<td class="py-1.5">
													<div class="flex items-center gap-1.5">
														<button type="button" class="cursor-pointer text-g7 transition-colors hover:text-tx" onclick={() => openTrader(holder.walletAddress ?? '')}>{shortAddress(holder.walletAddress ?? '')}</button>
														<a href={explorerAddressUrl(chain as string, holder.walletAddress ?? '')} target="_blank" rel="noopener" class="p-1 text-g4 transition-colors hover:text-tx" aria-label="Open wallet in explorer" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><ExternalLink class="h-3 w-3" /></a>
													</div>
											</td>
											<td class="py-1.5 text-right text-tx">{formatNumber(holder.balanceTokenStr)}</td>
											<td class="py-1.5 text-right text-tx">{formatUsd(holder.balanceUsdStr)}</td>
											<td class="py-1.5 text-right text-tx">{holder.pct.toFixed(2)}%</td>
											<td class="max-w-40 py-1.5 text-right"><FundingSourcePreview chain={chain} fundingSource={fundingSourceOf(holder)} /></td>
											<td class="py-1.5 text-right">
												{#if (holder.labels ?? []).length > 0}
													<span class="inline-flex flex-wrap justify-end gap-1">
														{#each holder.labels ?? [] as wl}
															<span class="rounded bg-s7 px-1 py-0.5 text-xs text-tx">{wl.label}</span>
														{/each}
													</span>
												{:else}
													<span class="text-g6">—</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						{/if}
						{#if holdersLoadingMore}
							<div class="flex items-center justify-center gap-2 py-3">
								<LoaderCircle class="h-4 w-4 animate-spin text-g7" />
								<span class="text-xs text-g6">Loading more...</span>
							</div>
						{/if}
					{:else if !holders.distribution}
						<div class="py-6 text-center text-sm text-g7">No holder data available</div>
					{/if}
				{:else}
					<div class="py-6 text-center text-sm text-g7">No holder data available</div>
				{/if}

			{:else if activeTab === 'Details'}
				{#if safetyLoading && devTokensLoading}
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							{#each Array(4) as _, i}
								<div class="skeleton h-8 rounded-md" style="animation-delay: {i * 60}ms"></div>
							{/each}
						</div>
						<div class="space-y-2">
							{#each Array(4) as _, i}
								<div class="skeleton h-8 rounded-md" style="animation-delay: {(i + 4) * 60}ms"></div>
							{/each}
						</div>
					</div>
				{:else}
					{#if hasSocialSection}
						<div class="mb-4 space-y-3">
							<!-- Twitter profile summary -->
							{#if twitterProfile}
								<div class="flex items-center gap-3 rounded-lg border border-bd bg-s2 px-3 py-2.5">
									{#if twitterProfile.profileImageUrl}
										<img src={twitterProfile.profileImageUrl} alt="" class="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-bd" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
									{:else}
										<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-s7 text-xs font-bold text-g7">{(twitterProfile.name?.[0] ?? '?').toUpperCase()}</div>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1">
											<span class="truncate text-sm font-semibold text-tx">{twitterProfile.name}</span>
											{#if twitterProfile.isBlueVerified}
												<BadgeCheck class="h-3.5 w-3.5 shrink-0 text-blu" />
											{/if}
										</div>
										<a href={`https://x.com/${twitterProfile.screenName}`} target="_blank" rel="noopener" class="text-xs text-g5 transition-colors hover:text-tx">@{twitterProfile.screenName}</a>
									</div>
									{#if twitterProfile.followersCount != null}
										<div class="shrink-0 text-right">
											<div class="text-sm font-bold tabular-nums text-tx">{formatCompactNumber(twitterProfile.followersCount)}</div>
											<div class="text-[10px] uppercase tracking-wider text-g5">followers</div>
										</div>
									{/if}
								</div>
							{/if}

							<!-- AI narrative -->
							{#if aiNarrative}
								<div class="rounded-lg border border-bd bg-s2 p-3">
									<div class="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-g5">
										<Sparkles class="h-3 w-3 text-grn" /> AI Summary
									</div>
									<p class="text-[13px] leading-relaxed text-g8">{aiNarrative}</p>
								</div>
							{/if}

							<!-- Twitter community -->
							{#if twitterCommunity}
								<div class="overflow-hidden rounded-lg border border-bd bg-s2">
									{#if twitterCommunity.bannerUrl}
										<div class="h-14 w-full bg-s4">
											<img src={twitterCommunity.bannerUrl} alt="" class="h-full w-full object-cover" onerror={(e: Event) => { const p = (e.currentTarget as HTMLImageElement).parentElement; if (p) p.style.display = 'none'; }} />
										</div>
									{/if}
									<div class="p-3">
										<div class="flex items-start justify-between gap-2">
											<div class="min-w-0">
												<div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-g5">
													<Users class="h-3 w-3" /> Twitter Community
												</div>
												<div class="mt-0.5 truncate text-sm font-semibold text-tx">{twitterCommunity.name}</div>
											</div>
											{#if twitterCommunity.memberCount != null}
												<div class="shrink-0 rounded-md bg-s7 px-2 py-1 text-center">
													<div class="text-xs font-bold tabular-nums text-tx">{formatCompactNumber(twitterCommunity.memberCount)}</div>
													<div class="text-[9px] uppercase tracking-wider text-g5">members</div>
												</div>
											{/if}
										</div>
										{#if twitterCommunity.description}
											<p class="mt-1.5 line-clamp-2 text-xs leading-snug text-g7">{twitterCommunity.description}</p>
										{/if}
										{#if twitterCommunity.memberPreview?.length}
											<div class="mt-2 flex items-center gap-2">
												<div class="flex -space-x-2">
													{#each twitterCommunity.memberPreview.slice(0, 6) as m}
														{#if m.profileImageUrl}
															<img src={m.profileImageUrl} alt={m.name} title={`@${m.screenName}`} class="h-6 w-6 rounded-full object-cover ring-2 ring-s2" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
														{:else}
															<div class="flex h-6 w-6 items-center justify-center rounded-full bg-s7 text-[9px] font-bold text-g7 ring-2 ring-s2" title={`@${m.screenName}`}>{(m.name?.[0] ?? '?').toUpperCase()}</div>
														{/if}
													{/each}
												</div>
												{#if twitterCommunity.creator}
													<span class="truncate text-[11px] text-g5">by <span class="text-g7">@{twitterCommunity.creator.screenName}</span></span>
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{/if}

							<!-- Tokens sharing this Twitter community -->
							{#if communityTokens && communityTokens.count > 0}
								<div class="rounded-lg border border-bd bg-s2 p-3">
									<div class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-g5">
										<Users class="h-3 w-3" /> Connected to
										<span class="rounded bg-s7 px-1 py-px text-[9px] font-bold text-g7">{communityTokens.count}</span>
									</div>
									<div class="flex flex-wrap gap-1.5">
										{#each communityTokens.tokens.slice(0, 12) as rt}
											<a href={communityTokenHref(rt)} class="flex max-w-[160px] items-center gap-1 rounded-md border border-bd bg-s4 px-1.5 py-1 text-[11px] transition-colors hover:bg-s7">
												<img src={tokenImage(chain, rt.tokenAddress)} alt="" class="h-4 w-4 shrink-0 rounded-full object-cover" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
												<span class="truncate font-semibold text-tx">{rt.symbol || shortAddress(rt.tokenAddress)}</span>
												{#if rt.name && rt.symbol}<span class="truncate text-g5">{rt.name}</span>{/if}
											</a>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							{#if safety?.loaded}
								<div class="mb-4">
									<div class="mb-2 text-sm font-semibold text-g7">Safety</div>
									<div class="grid grid-cols-2 gap-2">
										<div class="flex items-center gap-1.5 rounded border border-bd bg-s2 px-2 py-1.5">
											<span class="{safetyColor(!safety.audit.mintable)} text-sm">{safetyIcon(!safety.audit.mintable)}</span>
											<div class="text-xs">
												<div class="text-g7">Mint</div>
												<div class="{safetyColor(!safety.audit.mintable)} font-semibold">{!safety.audit.mintable ? 'Disabled' : 'Enabled'}</div>
											</div>
										</div>
										<div class="flex items-center gap-1.5 rounded border border-bd bg-s2 px-2 py-1.5">
											<span class="{safetyColor(!safety.audit.freezable)} text-sm">{safetyIcon(!safety.audit.freezable)}</span>
											<div class="text-xs">
												<div class="text-g7">Freeze</div>
												<div class="{safetyColor(!safety.audit.freezable)} font-semibold">{!safety.audit.freezable ? 'Disabled' : 'Enabled'}</div>
											</div>
										</div>
										<div class="flex items-center gap-1.5 rounded border border-bd bg-s2 px-2 py-1.5">
											<span class="{safetyColor(!safety.audit.honeypot)} text-sm">{safetyIcon(!safety.audit.honeypot)}</span>
											<div class="text-xs">
												<div class="text-g7">Honeypot</div>
												<div class="{safetyColor(!safety.audit.honeypot)} font-semibold">{!safety.audit.honeypot ? 'No' : 'Yes'}</div>
											</div>
										</div>
										<div class="flex items-center gap-1.5 rounded border border-bd bg-s2 px-2 py-1.5">
											<span class="{safetyColor(safety.audit.renounced)} text-sm">{safetyIcon(safety.audit.renounced)}</span>
											<div class="text-xs">
												<div class="text-g7">Renounced</div>
												<div class="{safetyColor(safety.audit.renounced)} font-semibold">{safety.audit.renounced ? 'Yes' : 'No'}</div>
											</div>
										</div>
										<div class="flex items-center gap-1.5 rounded border border-bd bg-s2 px-2 py-1.5">
											<span class="{safetyColor(safety.audit.lpLockedPct >= 50)} text-sm">{safetyIcon(safety.audit.lpLockedPct >= 50)}</span>
											<div class="text-xs">
												<div class="text-g7">LP Locked</div>
												<div class="{safetyColor(safety.audit.lpLockedPct >= 50)} font-semibold">{safety.audit.lpLockedPct >= 50 ? 'Yes' : 'No'}{safety.audit.lpLockedPct > 0 ? ` (${safety.audit.lpLockedPct.toFixed(1)}%)` : ''}</div>
											</div>
										</div>
										<div class="flex items-center gap-1.5 rounded border border-bd bg-s2 px-2 py-1.5">
											<span class="{safetyColor(safety.audit.contractVerified)} text-sm">{safetyIcon(safety.audit.contractVerified)}</span>
											<div class="text-xs">
												<div class="text-g7">Verified</div>
												<div class="{safetyColor(safety.audit.contractVerified)} font-semibold">{safety.audit.contractVerified ? 'Yes' : 'No'}</div>
											</div>
										</div>
										<div class="flex items-center gap-1.5 rounded border border-bd bg-s2 px-2 py-1.5">
											<span class="{safetyColor(safety.audit.dexScreenerPaid)} text-sm">{safetyIcon(safety.audit.dexScreenerPaid)}</span>
											<div class="text-xs">
												<div class="text-g7">Dex Paid</div>
												<div class="{safetyColor(safety.audit.dexScreenerPaid)} font-semibold">{safety.audit.dexScreenerPaid ? 'Yes' : 'No'}</div>
											</div>
										</div>
										<div class="rounded border border-bd bg-s2 px-2 py-1.5">
											<div class="text-xs text-g7">Burned</div>
											<div class="text-xs font-semibold text-tx">{safety.audit.supplyBurntPct.toFixed(2)}%</div>
										</div>
									</div>
									{#if safety.audit.taxBuy > 0 || safety.audit.taxSell > 0 || safety.audit.taxTransfer > 0}
										<div class="mt-2 grid grid-cols-3 gap-2">
											{#if safety.audit.taxBuy > 0}
												<div class="rounded border border-bd bg-s2 px-2 py-1.5">
													<div class="text-xs text-g7">Buy Fee</div>
													<div class="text-xs font-semibold text-tx">{safety.audit.taxBuy.toFixed(2)}%</div>
												</div>
											{/if}
											{#if safety.audit.taxSell > 0}
												<div class="rounded border border-bd bg-s2 px-2 py-1.5">
													<div class="text-xs text-g7">Sell Fee</div>
													<div class="text-xs font-semibold text-tx">{safety.audit.taxSell.toFixed(2)}%</div>
												</div>
											{/if}
											{#if safety.audit.taxTransfer > 0}
												<div class="rounded border border-bd bg-s2 px-2 py-1.5">
													<div class="text-xs text-g7">Transfer Fee</div>
													<div class="text-xs font-semibold text-tx">{safety.audit.taxTransfer.toFixed(2)}%</div>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/if}

							{#if token}
								<div class="mb-4">
									<div class="mb-2 text-sm font-semibold text-g7">Token Info</div>
									<div class="space-y-1.5 text-xs">
										<div class="flex items-center justify-between">
											<span class="text-g6">Token Address</span>
											<a
												href={explorerAddressUrl(chain as string, token.tokenAddress ?? '')}
												target="_blank"
												rel="noopener"
												class="text-g7 hover:text-g11"
											>{shortAddress(token.tokenAddress ?? '')}</a>
										</div>
										<div class="flex items-center justify-between">
											<span class="text-g6">Pair Address</span>
											<a
												href={explorerAddressUrl(chain as string, token.pairAddress ?? '')}
												target="_blank"
												rel="noopener"
												class="text-g7 hover:text-g11"
											>{shortAddress(token.pairAddress ?? '')}</a>
										</div>
										<div class="flex items-center justify-between">
											<span class="text-g6">Router</span>
											<span class="flex items-center gap-1.5 text-tx">
												{#if routerIconUrl}<img src={routerIconUrl} alt="" class="h-3.5 w-3.5" />{/if}
												{displayRouter.name}
											</span>
										</div>
										{#if tokenBirth || token.createdAtTimestamp}
											<div class="flex items-center justify-between">
												<span class="text-g6">Age</span>
												<span class="text-tx">{liveAge(tokenBirth ?? (token.createdAtTimestamp ? new Date(token.createdAtTimestamp).toISOString() : null), getNow())} <span class="text-g4">({tokenBirth ? new Date(tokenBirth).toLocaleDateString() : token.createdAtTimestamp ? new Date(token.createdAtTimestamp).toLocaleDateString() : '—'})</span></span>
											</div>
										{/if}
										{#if token.quote.totalSupply > 0}
											<div class="flex items-center justify-between">
												<span class="text-g6">Total Supply</span>
												<span class="text-tx">{formatNumber(token.quote.totalSupplyStr)}</span>
											</div>
										{/if}
										{#if token.quote.pooledToken > 0}
											<div class="flex items-center justify-between">
												<span class="text-g6">Pooled Token</span>
												<span class="text-tx">{formatNumber(token.quote.pooledTokenStr)}</span>
											</div>
										{/if}
										{#if token.quote.pooledQuoteToken > 0}
											<div class="flex items-center justify-between">
												<span class="text-g6">Pooled {token.quoteTokenSymbol ?? 'Native'}</span>
												<span class="text-tx">{formatNumber(token.quote.pooledQuoteTokenStr)}</span>
											</div>
										{/if}
										{#if token.quote.marketCapInitialUsd > 0}
											<div class="flex items-center justify-between">
												<span class="text-g6">Initial MCap</span>
												<span class="text-tx">{formatUsd(token.quote.marketCapInitialUsdStr)}</span>
											</div>
										{/if}
										{#if token.quote.liquidityInitialUsd > 0}
											<div class="flex items-center justify-between">
												<span class="text-g6">Initial Liquidity</span>
												<span class="text-tx">{formatUsd(token.quote.liquidityInitialUsdStr)}</span>
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>

						<div>
							{#if devTokensLoading}
								<div class="mb-4">
									<div class="mb-2 text-sm font-semibold text-g7">Dev Tokens</div>
									<div class="space-y-2">
										{#each Array(3) as _, i}
											<div class="skeleton h-10 rounded-md" style="animation-delay: {(i + 5) * 80}ms"></div>
										{/each}
									</div>
								</div>
							{:else if devTokens && devTokens.tokens.length > 0}
								<div class="mb-4">
									<div class="mb-2 flex items-center justify-between">
										<div class="flex items-center gap-2">
											<span class="text-sm font-semibold text-g7">Dev Tokens</span>
											<span class="rounded bg-s7 px-1.5 py-0.5 text-[10px] text-g6">{devTokens.stats.total}</span>
										</div>
										{#if devTokens.devAddress}
											<a
												href={explorerAddressUrl(chain as string, devTokens.devAddress)}
												target="_blank"
												rel="noopener"
												class="text-xs text-g5 transition-colors hover:text-g9"
											>{shortAddress(devTokens.devAddress)}</a>
										{/if}
									</div>

									<div class="mb-3 grid grid-cols-3 gap-2">
										<div class="rounded border border-bd bg-s2 px-2 py-1.5">
											<div class="text-[10px] text-g5">Migrated</div>
											<div class="text-xs font-semibold text-grn">{devTokens.stats.migrated}</div>
										</div>
										<div class="rounded border border-bd bg-s2 px-2 py-1.5">
											<div class="text-[10px] text-g5">Not Migrated</div>
											<div class="text-xs font-semibold text-red">{devTokens.stats.notMigrated}</div>
										</div>
										<div class="rounded border border-bd bg-s2 px-2 py-1.5">
											<div class="text-[10px] text-g5">Highest MC</div>
											<div class="text-xs font-semibold text-tx">{formatMarketCap(devTokens.stats.highestMarketCapUsdStr)}</div>
											<div class="truncate text-[10px] text-g4">{devTokens.stats.highestMarketCapTokenSymbol}</div>
										</div>
									</div>

									<div class="max-h-80 space-y-1 overflow-y-auto" onscroll={onDevTokensScroll}>
										{#each devTokens.tokens as dt}
											{@const mPct = dt.migrationPct}
											<a
												href="/?chain={dt.chain}&token={dt.tokenAddress}"
												class="flex items-center gap-2.5 rounded-lg border border-bd bg-s1 px-2.5 py-2 transition-all hover:border-bd3 hover:bg-wh/5"
											>
												<div
													class="relative h-7 w-7 shrink-0 rounded-lg p-[2px]"
													style={dt.migrated
														? 'background: var(--t-yel)'
														: mPct > 0
															? `background: conic-gradient(var(--t-grn) ${mPct * 3.6}deg, var(--t-bd2) ${mPct * 3.6}deg)`
															: 'background: var(--t-s5)'}
												>
													<img src={tokenImage(dt.chain, dt.tokenAddress)} alt="" class="h-full w-full rounded-[6px] object-cover" onerror={(e: Event) => { const el = e.currentTarget as HTMLElement; el.style.display = 'none'; if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'flex'; }} />
													<div class="hidden h-full w-full items-center justify-center rounded-[6px] bg-s7 text-[10px] font-bold text-g6">{dt.tokenSymbol.slice(0, 2)}</div>
												</div>
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-1.5">
														<span class="text-xs font-bold text-tx">{dt.tokenSymbol}</span>
														<ChainIcon chain={dt.chain} class="h-3 w-3 text-g6" />
														{#if dt.migrated}
															<span class="rounded bg-yel/10 px-1 py-px text-[9px] font-medium text-yel">GRAD</span>
														{:else if mPct > 0}
															<span class="rounded bg-grn/10 px-1 py-px text-[9px] font-medium text-grn">{mPct.toFixed(0)}%</span>
														{/if}
													</div>
													<div class="mt-0.5 flex items-center gap-2 text-[10px]">
														<span class="text-g6">MC {formatMarketCap(dt.marketCapUsdStr)}</span>
														<span class="text-g4">ATH {formatMarketCap(dt.athMarketCapUsdStr)}</span>
														<span class="text-g6">{@html formatPrice(dt.priceUsdStr)}</span>
													</div>
												</div>
												<div class="text-[10px] text-g4 cursor-help" title={fullDateTime(dt.createdAtTimestamp)}>{timeAgo(dt.createdAtTimestamp, getNow())}</div>
											</a>
										{/each}
										{#if devTokensLoadingMore}
											<div class="flex items-center justify-center gap-2 rounded-lg border border-bd bg-s2 px-2.5 py-2 text-[10px] text-g5">
												<LoaderCircle class="h-3 w-3 animate-spin" />
												<span>Loading</span>
											</div>
										{/if}
									</div>
								</div>
							{:else if !devTokensLoading}
								<div class="text-sm text-g4">No dev tokens found</div>
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>
	{/if}
</div>

{#if callsPopoverOpen && calls.length > 0}
	<div use:portal>
	<button class="fixed inset-0 z-40 bg-s0/60 backdrop-blur-[2px] md:bg-transparent md:backdrop-blur-none" onclick={() => (callsPopoverOpen = false)} aria-label="Close"></button>
	<div class="fixed z-50 rounded-xl border border-bd bg-s5 shadow-2xl backdrop-blur-md inset-x-2 bottom-[7.5rem] md:inset-auto md:bottom-auto md:w-[340px] md:left-[var(--pop-x)] md:top-[var(--pop-y)]" style="--pop-x:{callsPopoverPos.x}px; --pop-y:{callsPopoverPos.y + 8}px;">
		<div class="max-h-[50vh] md:max-h-[400px] overflow-y-auto" onscroll={handleCallsScroll}>
			{#each calls as call}
				{@const athMult = call.callDetails.athMultiplier ?? 0}
				{@const curMult = call.callDetails.currentMultiplier ?? 0}
				{@const callerName = 'name' in call.caller ? call.caller.name : 'Unknown'}
				{@const callerPhotoId = 'photoId' in call.caller ? call.caller.photoId : undefined}
				{@const detailWalletAddr = getWalletAddress(call.caller as Record<string, unknown>)}
				<div class="border-b border-bd/40 px-4 py-3 last:border-0">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<div class="flex items-center gap-1.5">
								{#if avatarUrl(callerPhotoId)}
									<img src={avatarUrl(callerPhotoId)} alt="" class="h-5 w-5 shrink-0 rounded-full object-cover" />
								{:else if detailWalletAddr}
									<img src={getWalletIconUrl(detailWalletAddr)} alt="" class="h-5 w-5 shrink-0 rounded-full" />
								{:else}
									<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-s7 text-[9px] font-bold text-g11">{callerName?.[0]?.toUpperCase() ?? '?'}</div>
								{/if}
								<span
									class="cursor-pointer truncate text-sm font-bold text-tx hover:underline"
									onclick={(e) => { e.stopPropagation(); openCallerView(call); }}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCallerView(call); } }}
									role="link"
									tabindex="0"
								>{callerName}</span>
								<span class="shrink-0 rounded bg-wh/10 px-1 py-px text-[9px] font-medium text-g6">{call.caller.type}</span>
								{#if call.callDetails.rugged}<span class="shrink-0 rounded bg-red/20 px-1 py-px text-[9px] font-bold text-red">RUGGED</span>{/if}
							</div>
							<div class="mt-1 text-xs text-g5">
								Called at <span class="text-g9">{formatUsd(call.callDetails.marketCapAtCallUsdStr)}</span>
								<span class="text-g3 mx-1">&middot;</span>
								MCap <span class="text-g9">{formatMarketCap(token?.quote?.marketCapUsdStr)}</span>
								<span class="text-g3 mx-1">&middot;</span>
								ATH <span class="text-g9">{formatMarketCap(call.callDetails.athMarketCapUsdStr)}</span>
							</div>
							<div class="mt-0.5 text-[11px] text-g5 cursor-help" title={fullDateTime(call.callDetails.calledAtTimestampStr)}>{timeAgo(call.callDetails.calledAtTimestampStr)}</div>
						</div>
						<div class="flex shrink-0 flex-col items-end">
							<span class="text-base font-bold {athMult >= 1 ? 'text-grn' : 'text-red'}">{formatMultiplier(String(athMult))}</span>
							{#if curMult > 0}
								<span class="text-[11px] {curMult >= 1 ? 'text-grn' : 'text-red'}">Now {formatMultiplier(String(curMult))}</span>
							{/if}
						</div>
					</div>
				</div>
			{/each}
			{#if callsLoadingMore}
				<div class="flex justify-center py-3">
					<div class="h-4 w-4 animate-spin rounded-full border-2 border-g4 border-t-grn"></div>
				</div>
			{/if}
		</div>
	</div>
	</div>
{/if}
