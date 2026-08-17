<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { ScannerItem, Chain, TimeFrame, ScannerTokensRequest, components } from '$lib/api/types';
	import { api } from '$lib/api/client';
	import TokenTable from '$lib/components/TokenTable.svelte';
	import MobileTokenCard from '$lib/components/MobileTokenCard.svelte';
	import { isCursorRecoveryReason, subscribe, unsubscribe } from '$lib/ws/client';
	import { applyScannerWsEvent, type RowFlashType } from '$lib/utils/scanner-ws';
	import { createCoalescer } from '$lib/utils/coalesce';
	import { formatMarketCap } from '$lib/utils/format';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';
	import { liveAccumulatedParams, type CursorTriplet } from '$lib/utils/livecursor';
	import Filter from 'lucide-svelte/icons/funnel';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import { getRouterInfo } from '$lib/utils/routers';

	let { routeActive = true }: { routeActive?: boolean } = $props();

	const chains: Array<'All' | Chain> = ['All', 'SOL', 'ETH', 'BASE', 'BSC'];
	const timeFrames: TimeFrame[] = ['5M', '1H', '6H', '24H'];
	const allPlatforms = [
		'PUMPFUN', 'PUMPSWAP', 'RAYDIUM', 'RAYDIUM_CP', 'RAYDIUM_CLMM', 'RAYDIUM_LAUNCH',
		'METEORA_BONDING_CURVE', 'METEORA_DYN', 'METEORA_DYN_V2', 'METEORA_DLMM',
		'MOONSHOT', 'HEAVEN', 'FOURMEME_V2',
		'BELIEVE', 'LETS_BONK', 'BAGS', 'PRINTR',
		'UNISWAP_V2', 'UNISWAP_V3', 'AERODROME_V2',
	] as const;
	const scannerViews = [
		{ value: 'new', label: 'New' },
		{ value: 'trending', label: 'Trending' },
		{ value: 'topVolume', label: 'Top Volume' },
		{ value: 'topGainers', label: 'Top Gainers' }
	] as const satisfies ReadonlyArray<{ value: NonNullable<ScannerTokensRequest['view']>; label: string }>;
	const rankByOptions = [
		{ value: 'volume', label: 'Volume' },
		{ value: 'mcap', label: 'MCap' },
		{ value: 'liquidity', label: 'Liquidity' },
		{ value: 'txns', label: 'Txns' },
		{ value: 'buys', label: 'Buys' },
		{ value: 'sells', label: 'Sells' },
		{ value: 'age', label: 'Age' },
		{ value: 'migration', label: 'Migration' }
	] as const satisfies ReadonlyArray<{ value: NonNullable<ScannerTokensRequest['rankBy']>; label: string }>;
	const rankByValues = [
		'price5M', 'price1H', 'price6H', 'price24H', 'volume', 'txns', 'buys', 'sells',
		'trending', 'age', 'liquidity', 'mcap', 'migration'
	] as const satisfies ReadonlyArray<NonNullable<ScannerTokensRequest['rankBy']>>;
	const tfSuffix: Record<string, string> = { '5M': '5m', '1H': '1h', '6H': '6h', '24H': '24h' };

	type ScannerView = NonNullable<ScannerTokensRequest['view']>;
	type ScannerRankBy = NonNullable<ScannerTokensRequest['rankBy']>;

	function scannerViewRankBy(view: ScannerView, timeFrame: TimeFrame): ScannerRankBy {
		if (view === 'new') return 'age';
		if (view === 'trending') return 'trending';
		if (view === 'topVolume') return 'volume';
		return `price${timeFrame}` as ScannerRankBy;
	}

	type Filters = Record<string, string>;
	let filters: Filters = $state({});
	let platforms: Set<string> = $state(new Set());
	let chain: 'All' | Chain = $state('All');
	let timeFrame: TimeFrame = $state('1H');
	let view: ScannerView = $state('trending');
	let customRankBy: ScannerRankBy | null = $state(null);
	let rankBy = $derived(customRankBy ?? scannerViewRankBy(view, timeFrame));
	let orderBy: NonNullable<ScannerTokensRequest['orderBy']> = $state('desc');
	let tokens: ScannerItem[] = $state([]);
	let feedStats = $state<components['schemas']['ScannerFeedStats'] | null>(null);
	let loading: boolean = $state(false);
	let loadingMore: boolean = $state(false);
	let hasMore: boolean = $state(false);
	let filtersOpen: boolean = $state(false);
	let scannerWsKey: string | null = null;
	let rowFlashes: Map<string, RowFlashType> = $state(new Map());
	let flashTimer: ReturnType<typeof setTimeout> | null = null;
	let openSections: Set<string> = $state(new Set(['market']));
	let filterTimeFrame: TimeFrame = $state('1H');
	let initialized = false;
	let prevChain: string = 'All';
	let prevTf: string = '1H';
	let prevView: ScannerView = 'trending';
	let tailCursor: CursorTriplet | null = $state(null);
	let loadedCursors = new Set<string>();
	let cursorShapeKey = '';
	let fetchSeq = 0;
	let scrollEl: HTMLDivElement | null = $state(null);
	let mobileScrollEl: HTMLDivElement | null = $state(null);
	let wsMsgHistory: number[] = [];
	let wsMsgBucket = 0;
	let wsMsgPerSec: number = $state(0);
	let wsMsgInterval: ReturnType<typeof setInterval> | null = null;
	const WS_AVG_WINDOW = 5;

	function startWsCounter() {
		if (wsMsgInterval) clearInterval(wsMsgInterval);
		wsMsgHistory = [];
		wsMsgBucket = 0;
		wsMsgPerSec = 0;
		wsMsgInterval = setInterval(() => {
			wsMsgHistory.push(wsMsgBucket);
			if (wsMsgHistory.length > WS_AVG_WINDOW) wsMsgHistory.shift();
			wsMsgPerSec = Math.round(wsMsgHistory.reduce((a, b) => a + b, 0) / wsMsgHistory.length);
			wsMsgBucket = 0;
		}, 1000);
	}

	function f(key: string): string { return filters[key] ?? ''; }
	function fs(key: string, val: string) { filters = { ...filters, [key]: val }; }

	const boolKeys = [
		'notHoneypot', 'lpLocked', 'isRenounced', 'isVerified', 'freezeAuthorityDisabled',
		'mintAuthorityDisabled', 'dexPaid',
		'notProxy', 'hasWebsite', 'hasTwitter', 'hasTelegram', 'hasDiscord', 'hasAnySocial'
	];
	const coreKeys = ['chain', 'timeFrame', 'view', 'rankBy', 'orderBy'];

	function loadFromUrl() {
		const sp = new URL(window.location.href).searchParams;
		chain = (sp.get('chain') ?? 'All') as typeof chain;
		timeFrame = (sp.get('timeFrame') as TimeFrame) || '1H';
		const requestedView = sp.get('view');
		view = scannerViews.some((option) => option.value === requestedView)
			? requestedView as ScannerView
			: 'trending';
		const requestedRankBy = sp.get('rankBy');
		const defaultRankBy = scannerViewRankBy(view, timeFrame);
		customRankBy = rankByValues.some((value) => value === requestedRankBy)
			&& (requestedRankBy !== defaultRankBy || sp.get('orderBy') === 'asc')
			? requestedRankBy as ScannerRankBy
			: null;
		orderBy = sp.get('orderBy') === 'asc' ? 'asc' : 'desc';
		platforms = new Set(sp.getAll('platforms'));
		const nf: Filters = {};
		sp.forEach((v, k) => { if (!coreKeys.includes(k) && k !== 'platforms' && v) nf[k] = v; });
		filters = nf;
	}

	function buildUrlParams(): URLSearchParams {
		const sp = new URLSearchParams();
		if (chain !== 'All') sp.set('chain', chain);
		if (timeFrame !== '1H') sp.set('timeFrame', timeFrame);
		if (view !== 'trending') sp.set('view', view);
		if (customRankBy) sp.set('rankBy', customRankBy);
		if (orderBy !== 'desc') sp.set('orderBy', orderBy);
		for (const p of platforms) sp.append('platforms', p);
		for (const [k, v] of Object.entries(filters)) { if (v) sp.set(k, v); }
		return sp;
	}

	function syncToUrl() {
		const qs = buildUrlParams().toString();
		history.replaceState(history.state, '', qs ? `?${qs}` : window.location.pathname);
	}

	function applyAndPush() {
		const qs = buildUrlParams().toString();
		goto(qs ? `/scanner?${qs}` : '/scanner', { replaceState: false, keepFocus: true, noScroll: true });
	}

	function range(minKey: string, maxKey: string): { min?: number; max?: number } | null {
		const mn = filters[minKey] ? Number(filters[minKey]) : undefined;
		const mx = filters[maxKey] ? Number(filters[maxKey]) : undefined;
		if (mn === undefined && mx === undefined) return null;
		const r: { min?: number; max?: number } = {};
		if (mn !== undefined && !isNaN(mn)) r.min = mn;
		if (mx !== undefined && !isNaN(mx)) r.max = mx;
		return Object.keys(r).length > 0 ? r : null;
	}

	function maxOnly(key: string): { max?: number } | null {
		const v = filters[key] ? Number(filters[key]) : undefined;
		if (v === undefined || isNaN(v)) return null;
		return { max: v };
	}

	function buildTokenFilter(): Record<string, unknown> | null {
		const tf: Record<string, unknown> = {};

		const scope: Record<string, unknown> = {};
		if (chain !== 'All') scope.chain = [chain];
		if (platforms.size > 0) scope.platforms = [...platforms];
		if (filters['hideBondingCurve'] === 'true') scope.graduation = 'onlyGraduated';
		else if (filters['hideBondingCurveGraduated'] === 'true') scope.graduation = 'ignoreGraduated';
		if (Object.keys(scope).length > 0) tf.scope = scope;

		const market: Record<string, unknown> = {};
		const mcap = range('minMarketCap', 'maxMarketCap');
		if (mcap) market.marketCapUsd = mcap;
		const liq = range('minLiquidity', 'maxLiquidity');
		if (liq) market.liquidityUsd = liq;
		const age = range('minAgeHours', 'maxAgeHours');
		if (age) market.ageHours = age;
		if (Object.keys(market).length > 0) tf.market = market;

		const cc = range('minCallCount', 'maxCallCount');
		if (cc) tf.callCount = cc;

		const tax: Record<string, unknown> = {};
		const bt = maxOnly('maxBuyTax'); if (bt) tax.buyTaxPct = bt;
		const st = maxOnly('maxSellTax'); if (st) tax.sellTaxPct = st;
		const tt = maxOnly('maxTransferTax'); if (tt) tax.transferTaxPct = tt;
		if (Object.keys(tax).length > 0) tf.tax = tax;

		const tfSuffixToKey: Record<string, string> = { '5m': 'fiveMin', '1h': 'oneHour', '6h': 'sixHours', '24h': 'twentyFourHours' };
		const activity: Record<string, unknown> = {};
		for (const [s, key] of Object.entries(tfSuffixToKey)) {
			const win: Record<string, unknown> = {};
			const vol = range(`minVolume${s}`, `maxVolume${s}`); if (vol) win.volumeUsd = vol;
			const buys = range(`minBuys${s}`, `maxBuys${s}`); if (buys) win.buys = buys;
			const sells = range(`minSells${s}`, `maxSells${s}`); if (sells) win.sells = sells;
			const txns = range(`minTxns${s}`, `maxTxns${s}`); if (txns) win.transactions = txns;
			const fees = range(`minFees${s}`, `maxFees${s}`); if (fees) win.totalFeesUsd = fees;
			const pc = range(`minPriceChange${s}`, `maxPriceChange${s}`); if (pc) win.priceChangePct = pc;
			if (Object.keys(win).length > 0) activity[key] = win;
		}
		if (Object.keys(activity).length > 0) tf.activity = activity;

		const security: Record<string, unknown> = {};
		if (filters['notHoneypot'] === 'true') security.honeypot = false;
		if (filters['lpLocked'] === 'true') security.lpLocked = true;
		if (filters['isRenounced'] === 'true') security.renounced = true;
		if (filters['isVerified'] === 'true') security.contractVerified = true;
		if (filters['freezeAuthorityDisabled'] === 'true') security.freezable = false;
		if (filters['mintAuthorityDisabled'] === 'true') security.mintable = false;
		if (filters['notProxy'] === 'true') security.proxy = false;
		if (Object.keys(security).length > 0) tf.security = security;

		const holders: Record<string, unknown> = {};
		const dp = maxOnly('maxDevWalletPercent'); if (dp) holders.devPct = dp;
		const t10 = maxOnly('maxTop10HoldingPct'); if (t10) holders.top10Pct = t10;
		const sn = range('minSnipers', 'maxSnipers'); if (sn) holders.snipers = sn;
		const bn = range('minBundlers', 'maxBundlers'); if (bn) holders.bundlers = bn;
		const ins = range('minInsiders', 'maxInsiders'); if (ins) holders.insiders = ins;
		const sp = maxOnly('maxSniperHoldingPct'); if (sp) holders.sniperPct = sp;
		const bp = maxOnly('maxBundlerHoldingPct'); if (bp) holders.bundlerPct = bp;
		const ip = maxOnly('maxInsiderHoldingPct'); if (ip) holders.insiderPct = ip;
		const tp = maxOnly('maxTraderHoldingPct'); if (tp) holders.traderPct = tp;
		const tr = range('minTraders', 'maxTraders'); if (tr) holders.traders = tr;
		if (Object.keys(holders).length > 0) tf.holders = holders;

		const socials: Record<string, unknown> = {};
		if (filters['hasAnySocial'] === 'true') socials.hasAnySocial = true;
		if (filters['hasWebsite'] === 'true') socials.hasWebsite = true;
		if (filters['hasTwitter'] === 'true') socials.hasTwitter = true;
		if (filters['hasTelegram'] === 'true') socials.hasTelegram = true;
		if (filters['hasDiscord'] === 'true') socials.hasDiscord = true;
		if (filters['dexPaid'] === 'true') socials.dexScreenerPaid = true;
		if (Object.keys(socials).length > 0) tf.socials = socials;

		return Object.keys(tf).length > 0 ? tf : null;
	}

	function cleanupWs() { if (scannerWsKey) { unsubscribe(scannerWsKey); scannerWsKey = null; } }

	function resetCursors() {
		tailCursor = null;
		hasMore = false;
		loadedCursors = new Set();
	}

	function scannerCursorShape(tokenFilter: Record<string, unknown> | null): string {
		return JSON.stringify({
			view,
			chain,
			timeFrame,
			rankBy,
			orderBy,
			tokenFilter
		});
	}

	const scannerFrameCoalescer = createCoalescer<{ event: string; data: any }>((batch) => {
		let working = tokens;
		const affected = new Map<string, RowFlashType>();
		let sawSnapshot = false;
		let lastSnapshotHasMore = hasMore;
		for (const { event, data } of batch) {
			const result = applyScannerWsEvent(event, data, working);
			working = result.tokens;
			for (const [k, v] of result.affected) affected.set(k, v);
			if (event === 'SCANNER_TOKENS') {
				sawSnapshot = true;
				lastSnapshotHasMore = !!data?.nextCursor;
				if (data?.stats) feedStats = data.stats;
			}
		}
		tokens = working;
		if (sawSnapshot) hasMore = lastSnapshotHasMore;
		if (affected.size > 0) {
			rowFlashes = new Map(affected);
			if (flashTimer) clearTimeout(flashTimer);
			flashTimer = setTimeout(() => { rowFlashes = new Map(); }, 1500);
		}
	}, { maxBatch: 40 });

	function setupWs() {
		cleanupWs();
		scannerFrameCoalescer.clear();
		const params: Record<string, unknown> = { view, timeFrame, rankBy, orderBy };
		const liveParams = liveAccumulatedParams(tailCursor);
		if (!liveParams) return;
		Object.assign(params, liveParams);
		const tokenFilter = buildTokenFilter();
		if (tokenFilter) Object.assign(params, tokenFilter);
		scannerWsKey = subscribe('scanner:tokens', (event, data) => {
			wsMsgBucket++;
			scannerFrameCoalescer.push({ event, data });
		}, params, {
			recovery: 'refetch',
			onReconnect: () => { void fetchAndSubscribe({ soft: true }); },
			onError: (error) => {
				if (isCursorRecoveryReason(error.reason)) {
					fetchAndSubscribe({ soft: true });
				}
			}
		});
	}

	async function postScannerView(
		requestedView: ScannerView,
		requestedTimeFrame: TimeFrame,
		body: ScannerTokensRequest
	) {
		switch (requestedView) {
			case 'new':
				return api.POST('/v2/scanner/tokens/new', { body });
			case 'trending':
				return api.POST('/v2/scanner/tokens/trending/{timeframe}', {
					params: { path: { timeframe: requestedTimeFrame } },
					body
				});
			case 'topVolume':
				return api.POST('/v2/scanner/tokens/top-volume/{timeframe}', {
					params: { path: { timeframe: requestedTimeFrame } },
					body
				});
			case 'topGainers':
				return api.POST('/v2/scanner/tokens/top-gainers/{timeframe}', {
					params: { path: { timeframe: requestedTimeFrame } },
					body
				});
		}
	}

	// Guard against duplicate pairAddress rows (the `{#each}` keys on pairAddress);
	// the backend can occasionally return the same pair twice.
	function dedupByPair(list: ScannerItem[]): ScannerItem[] {
		const seen = new Set<string>();
		const out: ScannerItem[] = [];
		for (const t of list) {
			if (!t?.pairAddress || seen.has(t.pairAddress)) continue;
			seen.add(t.pairAddress);
			out.push(t);
		}
		return out;
	}

	async function fetchTokens(opts?: { soft?: boolean }): Promise<boolean> {
		const seq = ++fetchSeq;
		const requestedView = view;
		const requestedTimeFrame = timeFrame;
		const requestedRankBy = rankBy;
		const requestedOrderBy = orderBy;
		const keepVisible = !!(opts?.soft && tokens.length > 0);
		if (!keepVisible) loading = true;
		const tokenFilter = buildTokenFilter();
		cursorShapeKey = scannerCursorShape(tokenFilter);
		resetCursors();
		try {
			const body: ScannerTokensRequest = {
				view: requestedView,
				timeFrame: requestedTimeFrame,
				orderBy: requestedOrderBy,
				rankBy: requestedRankBy,
				tokenFilter: tokenFilter as ScannerTokensRequest['tokenFilter']
			};
			const { data: res } = await postScannerView(requestedView, requestedTimeFrame, body);
			if (seq !== fetchSeq) return false;
			tokens = dedupByPair(res?.tokens ?? []);
			feedStats = res?.stats ?? null;
			hasMore = !!res?.nextCursor;
			tailCursor = res?.cursor ? { cursor: res.cursor, prevCursor: res.prevCursor, nextCursor: res.nextCursor } : null;
			return true;
		} catch {
			if (seq !== fetchSeq) return false;
			if (!keepVisible) tokens = [];
			hasMore = false;
			tailCursor = null;
			return false; // genuine fetch failure — signal caller to retry, don't try to subscribe
		} finally {
			if (seq === fetchSeq) loading = false;
		}
	}

	async function loadMore() {
		const cursor = tailCursor?.nextCursor;
		if (loadingMore || loading || !hasMore || !cursor || loadedCursors.has(cursor)) return;
		loadingMore = true;
		loadedCursors.add(cursor);
		const seq = fetchSeq;
		const tokenFilter = buildTokenFilter();
		try {
			const body: ScannerTokensRequest = {
				view, timeFrame, orderBy, rankBy,
				tokenFilter: tokenFilter as ScannerTokensRequest['tokenFilter'],
				cursor
			};
			const { data: res } = await postScannerView(view, timeFrame, body);
			if (seq !== fetchSeq) return;
			hasMore = !!res?.nextCursor;
			if (res?.cursor) {
				tailCursor = { cursor: res.cursor, prevCursor: res.prevCursor, nextCursor: res.nextCursor };
				setupWs();
			}
			autoFillIfNeeded();
		} catch {
			loadedCursors.delete(cursor);
		} finally {
			if (seq === fetchSeq) loadingMore = false;
		}
	}

	function onScroll(e: Event) {
		if (loadingMore || !hasMore) return;
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) loadMore();
	}

	function autoFillIfNeeded() {
		if (!hasMore || loadingMore) return;
		requestAnimationFrame(() => {
			const el = getIsDesktop() ? scrollEl : mobileScrollEl;
			if (el && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight) loadMore();
		});
	}

	let resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
	function clearResubscribeTimer() { if (resubscribeTimer) { clearTimeout(resubscribeTimer); resubscribeTimer = null; } }

	async function fetchAndSubscribe(opts?: { soft?: boolean }) {
		clearResubscribeTimer();
		cleanupWs();
		const ok = await fetchTokens(opts);
		// fetchTokens returns false on a genuine failure (network/error). Retry so a
		// transient failure on tab-return (which would otherwise leave the WS dead
		// with no reactive retrigger) recovers instead of getting stuck.
		if (!ok) {
			if (routeActive) resubscribeTimer = setTimeout(() => { void fetchAndSubscribe(opts); }, 2000);
			return;
		}
		setupWs();
		autoFillIfNeeded();
	}

	function refresh() {
		resetCursors();
		applyAndPush();
		fetchAndSubscribe({ soft: true });
	}


	function handleSort(nextRankBy: string, nextOrderBy: string) {
		customRankBy = nextRankBy as ScannerRankBy;
		orderBy = nextOrderBy === 'asc' ? 'asc' : 'desc';
		resetCursors();
		syncToUrl();
		fetchAndSubscribe();
	}

	function selectView(nextView: ScannerView) {
		if (nextView === view) return;
		view = nextView;
		customRankBy = null;
		orderBy = 'desc';
		filters = {};
		platforms = new Set();
		chain = 'All';
		timeFrame = '1H';
		filterTimeFrame = '1H';
		resetCursors();
	}

	function toggleSection(key: string) {
		const next = new Set(openSections);
		if (next.has(key)) next.delete(key); else next.add(key);
		openSections = next;
	}

	function clearFilters() {
		filters = {};
		platforms = new Set();
		chain = 'All';
		timeFrame = '1H';
		refresh();
	}

	let activeFilterCount = $derived(Object.values(filters).filter(v => !!v).length + (platforms.size > 0 ? 1 : 0));

	function tfHasFilters(tf: TimeFrame): boolean {
		const s = tfSuffix[tf];
		return Object.keys(filters).some(k => !!filters[k] && k.endsWith(s));
	}

	function countSectionFilters(section: string): number {
		const keys = Object.keys(filters).filter(k => !!filters[k]);
		if (section === 'platform') return platforms.size > 0 ? platforms.size : 0;
		if (section === 'market') return keys.filter(k => /MarketCap|Liquidity|AgeHours|CallCount|BuyTax|SellTax|TransferTax|TxPercent/i.test(k)).length;
		if (section === 'activity') return keys.filter(k => /Volume|Fees|Buys\d|Sells\d|Txns|PriceChange|Traders/i.test(k)).length;
		if (section === 'safety') return keys.filter(k => ['notHoneypot','lpLocked','isRenounced','isVerified','freezeAuthorityDisabled','mintAuthorityDisabled','hideBondingCurve','hideBondingCurveGraduated','dexPaid','notProxy'].includes(k)).length;
		if (section === 'holders') return keys.filter(k => /DevWallet|WalletPercent|Top10|Sniper|Bundler|Insider|TraderHolding/i.test(k)).length;
		if (section === 'social') return keys.filter(k => /has(Website|Twitter|Telegram|Discord|AnySocial)/.test(k)).length;
		return 0;
	}

	onMount(() => {
		startWsCounter();
		loadFromUrl();
		prevChain = chain;
		prevTf = timeFrame;
		prevView = view;
		initialized = true;
		// The $effect below owns the initial fetch+subscribe (it runs right after
		// mount). Doing it here too would double the REST call on first visit.
	});

	$effect(() => {
		if (!routeActive) {
			clearResubscribeTimer();
			cleanupWs();
			return;
		}
		if (!initialized) return;
		const cc = chain !== prevChain;
		const tc = timeFrame !== prevTf;
		const vc = view !== prevView;
		prevChain = chain;
		prevTf = timeFrame;
		prevView = view;
		if (cc || tc || vc) {
			resetCursors();
			syncToUrl();
			fetchAndSubscribe();
		} else if (!scannerWsKey) {
			fetchAndSubscribe();
		}
	});

	const handlePopstate = () => {
		if (!routeActive) return;
		loadFromUrl();
		fetchAndSubscribe();
	};
	if (typeof window !== 'undefined') window.addEventListener('popstate', handlePopstate);
	onDestroy(() => { clearResubscribeTimer(); cleanupWs(); scannerFrameCoalescer.dispose(); if (wsMsgInterval) clearInterval(wsMsgInterval); if (typeof window !== 'undefined') window.removeEventListener('popstate', handlePopstate); });
</script>

<div class="flex h-[calc(100dvh-48px-env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-48px-28px)]">
	<div class="relative flex flex-1 flex-col overflow-hidden p-2 md:p-4 pb-24 md:pb-4">

		<div class="mb-2 md:mb-3 flex flex-wrap items-center gap-1.5 md:gap-2.5">
			<div class="relative">
				<button
					class="flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors {activeFilterCount > 0 ? 'border-grn/40 bg-grn/10 text-grn' : filtersOpen ? 'border-g1 bg-s4 text-tx' : 'border-bd bg-s4 text-g7 hover:border-g1 hover:text-tx'}"
					onclick={() => (filtersOpen = !filtersOpen)}
				>
					<Filter class="h-3.5 w-3.5" strokeWidth={1.5} />
					{#if activeFilterCount > 0}
						<span class="rounded-full bg-grn/10 px-1.5 text-[10px] font-bold text-grn">{activeFilterCount}</span>
					{/if}
				</button>
				{#if filtersOpen}
					<!-- Outside-click catcher (desktop). Mobile uses the full-screen panel's ✕. -->
					<button class="fixed inset-0 z-40 hidden md:block cursor-default" onclick={() => (filtersOpen = false)} aria-label="Close filters"></button>
					<div class="fixed md:absolute inset-0 md:inset-auto md:left-0 md:top-full z-50 md:mt-1 md:w-80 rounded-none md:rounded-xl border-0 md:border border-bd bg-s5 shadow-2xl">
						<div class="flex items-center justify-between px-5 py-3 border-b border-bd pt-[env(safe-area-inset-top,12px)] md:pt-3">
							<div class="flex items-center gap-2.5">
								<Filter class="h-4 w-4 text-grn" strokeWidth={1.5} />
								<span class="text-sm font-bold text-tx">Filters</span>
								{#if activeFilterCount > 0}
									<span class="rounded-full bg-grn/10 px-2 py-0.5 text-[10px] font-bold text-grn">{activeFilterCount}</span>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								{#if activeFilterCount > 0}
									<button onclick={clearFilters} class="cursor-pointer text-[11px] font-medium text-red hover:text-red-light transition-colors">Reset</button>
								{/if}
								<button onclick={() => (filtersOpen = false)} class="md:hidden cursor-pointer rounded-lg p-1 text-g5 hover:text-tx">✕</button>
							</div>
						</div>
						<div class="max-h-[70vh] md:max-h-[70vh] flex-1 overflow-y-auto">
							{@render accordionSection('platform', 'Platform')}
							{@render accordionSection('market', 'Market')}
							{@render accordionSection('activity', 'Activity')}
							{@render accordionSection('safety', 'Safety')}
							{@render accordionSection('holders', 'Holders')}
							{@render accordionSection('social', 'Social')}
							<div class="p-4">
								<button
									class="btn-primary w-full py-2.5 text-sm uppercase tracking-wider active:scale-[0.98]"
									onclick={() => { refresh(); filtersOpen = false; }}
								>
									Apply Filters
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<div class="flex w-fit shrink-0 gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
				{#each scannerViews as option}
					<button
						class="cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all md:px-4 md:text-xs {view === option.value ? 'bg-wh/10 text-tx' : 'text-g5 hover:text-g9'}"
						aria-pressed={view === option.value}
						onclick={() => selectView(option.value)}
					>
						{option.label}
					</button>
				{/each}
			</div>

			<div class="flex gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
				{#each chains as c}
					<button
						class="rounded-lg px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-medium transition-all cursor-pointer {chain === c ? 'bg-wh/10 text-tx' : 'text-g5 hover:text-g9'}"
						onclick={() => (chain = c)}
					>
						{c === 'All' ? 'All' : c}
					</button>
				{/each}
			</div>

			<div class="flex gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
				{#each timeFrames as tf}
					<button
						class="rounded-lg px-2 md:px-3 py-1.5 text-[11px] md:text-xs font-medium transition-all cursor-pointer {timeFrame === tf ? 'bg-wh/10 text-tx' : 'text-g5 hover:text-g9'}"
						onclick={() => (timeFrame = tf)}
					>
						{tf}
					</button>
				{/each}
			</div>

			{#if feedStats}
				<div class="ml-auto flex items-center gap-2 rounded-xl border border-bd bg-s4 px-3 py-1.5 text-xs">
					<span class="text-g6">Vol <span class="font-semibold text-tx">{formatMarketCap(feedStats.volumeStr)}</span></span>
					<span class="h-3 w-px bg-bd"></span>
					<span class="text-g6">Fees <span class="font-semibold text-tx">{formatMarketCap(feedStats.fees.totalFeeUsdStr)}</span></span>
				</div>
			{/if}

			<div class="{feedStats ? '' : 'ml-auto'} flex items-center gap-1.5">
				<select
					class="appearance-none rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none cursor-pointer hover:border-g1 transition-colors"
					value={rankByOptions.some((option) => option.value === customRankBy) ? customRankBy : ''}
					onchange={(e) => handleSort(e.currentTarget.value, orderBy)}
				>
					<option value="" disabled>Sort by</option>
					{#each rankByOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
				<button
					class="rounded-lg border border-bd bg-s4 px-2 py-1.5 text-xs text-g7 transition-all hover:border-g1 hover:text-tx cursor-pointer"
					aria-label={orderBy === 'desc' ? 'Sort ascending' : 'Sort descending'}
					onclick={() => handleSort(rankBy, orderBy === 'desc' ? 'asc' : 'desc')}
				>
					{#if orderBy === 'desc'}
						<ChevronDown class="h-3.5 w-3.5" strokeWidth={2} />
					{:else}
						<ChevronUp class="h-3.5 w-3.5" strokeWidth={2} />
					{/if}
				</button>
			</div>

		</div>

		{#if getIsDesktop()}
			<div class="flex-1 overflow-auto" bind:this={scrollEl} onscroll={onScroll}>
				<TokenTable {tokens} {loading} {rankBy} {orderBy} rankOffset={0} {rowFlashes} onsort={handleSort} />
				{#if loadingMore}
					<div class="flex items-center justify-center py-3 text-[11px] text-g5">Loading more…</div>
				{/if}
			</div>
		{:else}
			<div class="flex-1 overflow-auto" bind:this={mobileScrollEl} onscroll={onScroll}>
				{#if loading}
					<div class="space-y-2 p-1">
						{#each Array(6) as _, i}
							<div class="skeleton h-28 rounded-xl" style="animation-delay: {i * 60}ms"></div>
						{/each}
					</div>
				{:else if tokens.length === 0}
					<div class="flex h-40 flex-col items-center justify-center gap-2">
						<span class="text-sm text-g6">No tokens found</span>
					</div>
				{:else}
					<div class="space-y-2 p-1">
						{#each tokens as token (token.pairAddress)}
							<MobileTokenCard {token} />
						{/each}
					</div>
					{#if loadingMore}
						<div class="flex items-center justify-center py-3 text-[11px] text-g5">Loading more…</div>
					{/if}
				{/if}
			</div>
		{/if}

		<div class="mt-2 md:mt-2.5 flex items-center gap-3 border-t border-bd pt-2 pb-3 md:pt-2.5 md:pb-0">
			<div class="flex items-center gap-1.5">
				<span class="inline-block h-1.5 w-1.5 rounded-full {wsMsgPerSec > 0 ? 'bg-grn animate-pulse' : 'bg-g1'}"></span>
				<span class="text-[10px] text-g4">{wsMsgPerSec} msg/s</span>
			</div>
			<span class="ml-auto text-[10px] text-g4">{tokens.length} tokens</span>
		</div>
	</div>
</div>

{#snippet accordionSection(key: string, label: string)}
	{@const isOpen = openSections.has(key)}
	{@const sectionFilterCount = countSectionFilters(key)}
	<div class="border-b border-s7">
		<button
			class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-wh/5 group"
			onclick={() => toggleSection(key)}
		>
			<div class="flex items-center gap-2">
				<div class="flex h-5 w-5 items-center justify-center rounded-md {isOpen ? 'bg-grn/10' : 'bg-s7'} transition-colors">
					<ChevronDown class="h-2.5 w-2.5 {isOpen ? 'text-grn' : 'text-g4'} transition-transform duration-200 {isOpen ? 'rotate-180' : ''}" strokeWidth={2.5} />
				</div>
				<span class="text-[11px] font-bold uppercase tracking-widest {isOpen ? 'text-tx' : 'text-g7'} group-hover:text-tx transition-colors">{label}</span>
				{#if sectionFilterCount > 0}
					<span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-grn/20 px-1 text-[9px] font-bold text-grn">{sectionFilterCount}</span>
				{/if}
			</div>
		</button>
		{#if isOpen}
			<div class="px-4 pb-4 space-y-3">
				{#if key === 'platform'}
					{#if platforms.size > 0}
						<button onclick={() => { platforms = new Set(); }} class="cursor-pointer text-[10px] font-medium text-red hover:text-red-light transition-colors">Show All</button>
					{/if}
					<div class="flex flex-wrap gap-1.5">
						{#each allPlatforms as p}
							{@const active = platforms.size === 0 || platforms.has(p)}
							{@const info = getRouterInfo(p)}
							<button
								class="cursor-pointer flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all {active
									? 'bg-grn/10 text-grn ring-1 ring-grn/20'
									: 'bg-s7 text-g3 ring-1 ring-bd hover:text-g6 hover:ring-bd3'}"
								onclick={() => {
									const next = new Set(platforms);
									if (platforms.size === 0) {
										allPlatforms.forEach(pp => { if (pp !== p) next.add(pp); });
										next.delete(p);
										const inverse = new Set<string>();
										inverse.add(p);
										platforms = inverse;
									} else if (next.has(p)) {
										next.delete(p);
										if (next.size === 0) platforms = new Set();
										else platforms = next;
									} else {
										next.add(p);
										if (next.size === allPlatforms.length) platforms = new Set();
										else platforms = next;
									}
								}}
							>
								{#if info.icon}<img src={info.icon} alt="" class="h-3.5 w-3.5 rounded" />{/if}
								{info.name}
							</button>
						{/each}
					</div>

				{:else if key === 'market'}
					{@render rangeWithPresets('Market Cap', 'minMarketCap', 'maxMarketCap', [
						{ label: '1K+', min: '1000', max: '' }, { label: '10K+', min: '10000', max: '' },
						{ label: '100K+', min: '100000', max: '' }, { label: '1M+', min: '1000000', max: '' },
						{ label: '<1M', min: '', max: '1000000' }, { label: '<10M', min: '', max: '10000000' }
					])}
					{@render rangeWithPresets('Liquidity', 'minLiquidity', 'maxLiquidity', [
						{ label: '1K+', min: '1000', max: '' }, { label: '10K+', min: '10000', max: '' },
						{ label: '50K+', min: '50000', max: '' }, { label: '100K+', min: '100000', max: '' }
					])}
					{@render rangeWithPresets('Age', 'minAgeHours', 'maxAgeHours', [
						{ label: '30m+', min: '0.5', max: '' }, { label: '1h+', min: '1', max: '' },
						{ label: '6h+', min: '6', max: '' }, { label: '<12h', min: '', max: '12' },
						{ label: '<24h', min: '', max: '24' }, { label: '<48h', min: '', max: '48' },
						{ label: '<7d', min: '', max: '168' }
					])}
					{@render inlineRange('Callers', 'minCallCount', 'maxCallCount')}
					<div class="h-px bg-bd my-1"></div>
					<div class="grid grid-cols-2 gap-3">
						{@render slider('Buy Tax', 'maxBuyTax', 100)}
						{@render slider('Sell Tax', 'maxSellTax', 100)}
						{@render slider('Transfer Tax', 'maxTransferTax', 100)}
						{@render slider('Max Tx', 'maxTxPercent', 100)}
					</div>

			{:else if key === 'activity'}
				<div class="rounded-lg bg-s4 p-0.5 flex gap-0.5 mb-2 ring-1 ring-bd">
					{#each timeFrames as tf}
						<button
							class="relative flex-1 rounded-md py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer {filterTimeFrame === tf ? 'bg-bd text-tx' : 'text-g4 hover:text-g7'}"
							onclick={() => (filterTimeFrame = tf)}
						>
							{tf}
							{#if tfHasFilters(tf)}
								<span class="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-3 rounded-full bg-grn"></span>
							{/if}
						</button>
					{/each}
				</div>
				{@const s = tfSuffix[filterTimeFrame]}
					{@render rangeWithPresets('Volume', `minVolume${s}`, `maxVolume${s}`, [
						{ label: '$1K+', min: '1000', max: '' }, { label: '$10K+', min: '10000', max: '' },
						{ label: '$50K+', min: '50000', max: '' }, { label: '$100K+', min: '100000', max: '' }
					])}
					{@render rangeWithPresets('Fees', `minFees${s}`, `maxFees${s}`, [
						{ label: '$100+', min: '100', max: '' }, { label: '$500+', min: '500', max: '' },
						{ label: '$1K+', min: '1000', max: '' }, { label: '$5K+', min: '5000', max: '' }
					])}
					{@render inlineRange('Buys', `minBuys${s}`, `maxBuys${s}`)}
					{@render inlineRange('Sells', `minSells${s}`, `maxSells${s}`)}
					{@render inlineRange('Txns', `minTxns${s}`, `maxTxns${s}`)}
					{@render inlineRange('Price Chg %', `minPriceChange${s}`, `maxPriceChange${s}`)}
					{@render inlineRange('Traders', 'minTraders', 'maxTraders')}

				{:else if key === 'safety'}
					<div class="flex flex-wrap gap-2">
						{@render chip('Not Honeypot', 'notHoneypot')}
						{@render chip('LP Locked', 'lpLocked')}
						{@render chip('Renounced', 'isRenounced')}
						{@render chip('Verified', 'isVerified')}
						{@render chip('Freeze Off', 'freezeAuthorityDisabled')}
						{@render chip('Mint Off', 'mintAuthorityDisabled')}
						{@render chip('Not Proxy', 'notProxy')}
						{@render chip('DEX Paid', 'dexPaid')}
					</div>
					<div class="h-px bg-bd my-1.5"></div>
					<div class="flex flex-wrap gap-2">
						{@render chip('Hide Bonding Curve', 'hideBondingCurve')}
						{@render chip('Hide Graduated', 'hideBondingCurveGraduated')}
					</div>

				{:else if key === 'holders'}
					<div class="grid grid-cols-3 gap-3">
						{@render slider('Dev %', 'maxDevWalletPercent', 100)}
						{@render slider('Max Wallet %', 'maxWalletPercent', 100)}
						{@render slider('Top 10 %', 'maxTop10HoldingPct', 100)}
					</div>
					<div class="h-px bg-bd my-1"></div>
					{@render inlineRange('Snipers', 'minSnipers', 'maxSnipers')}
					{@render inlineRange('Bundlers', 'minBundlers', 'maxBundlers')}
					{@render inlineRange('Insiders', 'minInsiders', 'maxInsiders')}
					<div class="h-px bg-bd my-1"></div>
					<div class="text-[11px] font-medium text-g6 mb-1">Holding %</div>
					<div class="grid grid-cols-2 gap-3">
						{@render slider('Sniper', 'maxSniperHoldingPct', 100)}
						{@render slider('Bundler', 'maxBundlerHoldingPct', 100)}
						{@render slider('Insider', 'maxInsiderHoldingPct', 100)}
						{@render slider('Trader', 'maxTraderHoldingPct', 100)}
					</div>

				{:else if key === 'social'}
					<div class="flex flex-wrap gap-2">
						{@render chip('Any', 'hasAnySocial')}
						{@render chip('Website', 'hasWebsite')}
						{@render chip('Twitter', 'hasTwitter')}
						{@render chip('Telegram', 'hasTelegram')}
						{@render chip('Discord', 'hasDiscord')}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet rangeWithPresets(label: string, minKey: string, maxKey: string, presets: { label: string; min: string; max: string }[])}
	<div>
		<div class="flex items-center justify-between mb-1.5">
			<span class="text-xs font-medium text-g8">{label}</span>
			{#if f(minKey) || f(maxKey)}
				<button onclick={() => { fs(minKey, ''); fs(maxKey, ''); }} class="cursor-pointer text-[10px] text-g5 hover:text-red transition-colors">clear</button>
			{/if}
		</div>
		<div class="flex gap-1.5 mb-2 flex-wrap">
			{#each presets as p}
				{@const active = (p.min && f(minKey) === p.min) || (p.max && f(maxKey) === p.max)}
				<button
					class="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all {active
						? 'bg-grn/10 text-grn ring-1 ring-grn/20'
						: 'bg-s7 text-g5 hover:text-g9 ring-1 ring-bd hover:ring-bd3'}"
					onclick={() => { if (p.min) fs(minKey, active ? '' : p.min); if (p.max) fs(maxKey, active ? '' : p.max); }}
				>{p.label}</button>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<input type="number" placeholder="Min" value={f(minKey)} oninput={(e) => fs(minKey, e.currentTarget.value)}
				class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
			<span class="text-[10px] text-g1 shrink-0">to</span>
			<input type="number" placeholder="Max" value={f(maxKey)} oninput={(e) => fs(maxKey, e.currentTarget.value)}
				class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
		</div>
	</div>
{/snippet}

{#snippet inlineRange(label: string, minKey: string, maxKey: string)}
	<div class="flex items-center gap-2">
		<span class="w-18 shrink-0 text-[11px] text-g7">{label}</span>
		<input type="number" placeholder="min" value={f(minKey)} oninput={(e) => fs(minKey, e.currentTarget.value)}
			class="w-full min-w-0 rounded-lg border border-bd bg-s4 px-2 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
		<span class="text-[10px] text-g1 shrink-0">-</span>
		<input type="number" placeholder="max" value={f(maxKey)} oninput={(e) => fs(maxKey, e.currentTarget.value)}
			class="w-full min-w-0 rounded-lg border border-bd bg-s4 px-2 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
	</div>
{/snippet}

{#snippet inlineMax(label: string, key: string, suffix?: string)}
	<div>
		<div class="mb-1 text-[11px] text-g7">{label}</div>
		<input type="number" placeholder={suffix ?? 'max'} value={f(key)} oninput={(e) => fs(key, e.currentTarget.value)}
			class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx text-right placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
	</div>
{/snippet}

{#snippet slider(label: string, key: string, max: number)}
	{@const val = f(key) ? parseFloat(f(key)) : max}
	<div>
		<div class="mb-1 flex items-center justify-between">
			<span class="text-[11px] text-g7">{label}</span>
			<span class="text-[11px] font-medium {val < max ? 'text-grn' : 'text-g4'}">{val < max ? `≤${val}%` : 'Any'}</span>
		</div>
		<input type="range" min="0" max={max} step="1" value={val}
			oninput={(e) => {
				const v = parseFloat(e.currentTarget.value);
				fs(key, v >= max ? '' : String(v));
			}}
			class="slider-input w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bd2 accent-grn outline-none" />
	</div>
{/snippet}

{#snippet chip(label: string, key: string)}
	{@const active = f(key) === 'true'}
	<button
		class="cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all {active
			? 'bg-grn/10 text-grn ring-1 ring-grn/20'
			: 'bg-s7 text-g6 ring-1 ring-bd hover:text-g10 hover:ring-bd3 hover:bg-s6'}"
		onclick={() => fs(key, active ? '' : 'true')}
	>
		{label}
	</button>
{/snippet}
