<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api/client';
	import type { Chain, ScannerItem, TimeFrame, TrenchesPhase, ScannerTokensRequest, components } from '$lib/api/types';
	import { isCursorRecoveryReason, subscribe, unsubscribe } from '$lib/ws/client';
	import { applyScannerWsEvent, type RowFlashType } from '$lib/utils/scanner-ws';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';
	import MemescopeCard from '$lib/components/MemescopeCard.svelte';
	import { formatMarketCap } from '$lib/utils/format';
	import { getRouterInfo } from '$lib/utils/routers';
	import Inbox from 'lucide-svelte/icons/inbox';
	import TrendingUp from 'lucide-svelte/icons/trending-up';
	import BadgeCheck from 'lucide-svelte/icons/badge-check';
	import Filter from 'lucide-svelte/icons/funnel';
	import X from 'lucide-svelte/icons/x';

	let { routeActive = true }: { routeActive?: boolean } = $props();

	const chains: Array<'All' | Chain> = ['All', 'SOL', 'ETH', 'BASE', 'BSC'];
	const timeFrames: TimeFrame[] = ['5M', '1H', '6H', '24H'];
	const tfSuffix: Record<TimeFrame, string> = { '5M': '5m', '1H': '1h', '6H': '6h', '24H': '24h' };
	const memePlatforms = [
		'PUMPFUN', 'PUMPSWAP', 'RAYDIUM_LAUNCH', 'METEORA_BONDING_CURVE',
		'MOONSHOT', 'HEAVEN', 'FOURMEME_V2', 'BELIEVE', 'LETS_BONK', 'BAGS', 'PRINTR',
	] as const;
	const dexPlatforms = [
		'RAYDIUM', 'RAYDIUM_CP', 'RAYDIUM_CLMM', 'METEORA_DYN', 'METEORA_DYN_V2',
		'METEORA_DLMM', 'UNISWAP_V2', 'UNISWAP_V3', 'AERODROME_V2',
	] as const;
	const platformsByPhase: Record<TrenchesPhase, readonly string[]> = {
		new: memePlatforms,
		graduating: memePlatforms,
		graduated: dexPlatforms,
	};

	type PhaseFilters = Record<string, string>;

	let newTokens = $state<ScannerItem[]>([]);
	let aboutToGrad = $state<ScannerItem[]>([]);
	let graduated = $state<ScannerItem[]>([]);
	type FeedStats = components['schemas']['ScannerFeedStats'];
	let statsNew = $state<FeedStats | null>(null);
	let statsGraduating = $state<FeedStats | null>(null);
	let statsGraduated = $state<FeedStats | null>(null);
	function setPhaseStats(phase: TrenchesPhase, s: FeedStats | null) {
		if (!s) return;
		if (phase === 'new') statsNew = s;
		else if (phase === 'graduating') statsGraduating = s;
		else statsGraduated = s;
	}
	function phaseStats(phase: TrenchesPhase): FeedStats | null {
		return phase === 'new' ? statsNew : phase === 'graduating' ? statsGraduating : statsGraduated;
	}

	let loadingNew = $state(true);
	let loadingAbout = $state(true);
	let loadingGrad = $state(true);
	let wsKeyNew: string | null = null;
	let wsKeyGraduating: string | null = null;
	let wsKeyGraduated: string | null = null;

	const WS_AVG_WINDOW = 5;
	let wsMsgBuckets: Record<TrenchesPhase, number> = { new: 0, graduating: 0, graduated: 0 };
	let wsMsgHistories: Record<TrenchesPhase, number[]> = { new: [], graduating: [], graduated: [] };
	let wsMsgPerSec: Record<TrenchesPhase, number> = $state({ new: 0, graduating: 0, graduated: 0 });
	let wsMsgInterval: ReturnType<typeof setInterval> | null = null;

	function startWsCounters() {
		if (wsMsgInterval) clearInterval(wsMsgInterval);
		wsMsgBuckets = { new: 0, graduating: 0, graduated: 0 };
		wsMsgHistories = { new: [], graduating: [], graduated: [] };
		wsMsgPerSec = { new: 0, graduating: 0, graduated: 0 };
		wsMsgInterval = setInterval(() => {
			for (const p of ['new', 'graduating', 'graduated'] as TrenchesPhase[]) {
				wsMsgHistories[p].push(wsMsgBuckets[p]);
				if (wsMsgHistories[p].length > WS_AVG_WINDOW) wsMsgHistories[p].shift();
				wsMsgPerSec[p] = Math.round(wsMsgHistories[p].reduce((a, b) => a + b, 0) / wsMsgHistories[p].length);
				wsMsgBuckets[p] = 0;
			}
		}, 1000);
	}
	let rowFlashesNew = $state<Map<string, RowFlashType>>(new Map());
	let rowFlashesGraduating = $state<Map<string, RowFlashType>>(new Map());
	let rowFlashesGraduated = $state<Map<string, RowFlashType>>(new Map());
	let flashTimers: Record<TrenchesPhase, ReturnType<typeof setTimeout> | null> = { new: null, graduating: null, graduated: null };

	let filterOpenPhase = $state<TrenchesPhase | null>(null);
	let mobilePhase = $state<TrenchesPhase>('new');

	let filtersNew = $state<PhaseFilters>({});
	let filtersGraduating = $state<PhaseFilters>({});
	let filtersGraduated = $state<PhaseFilters>({});
	let chainNew = $state<'All' | Chain>('All');
	let chainGraduating = $state<'All' | Chain>('All');
	let chainGraduated = $state<'All' | Chain>('All');

	let platformsNew = $state<Set<string>>(new Set());
	let platformsGraduating = $state<Set<string>>(new Set());
	let platformsGraduated = $state<Set<string>>(new Set());

	let draftFilters = $state<PhaseFilters>({});
	let draftPlatforms = $state<Set<string>>(new Set());
	let draftChain = $state<'All' | Chain>('All');
	let filterTimeFrame = $state<TimeFrame>('1H');

	function getFilters(phase: TrenchesPhase): PhaseFilters {
		if (phase === 'new') return filtersNew;
		if (phase === 'graduating') return filtersGraduating;
		return filtersGraduated;
	}

	function setFilters(phase: TrenchesPhase, f: PhaseFilters) {
		if (phase === 'new') filtersNew = f;
		else if (phase === 'graduating') filtersGraduating = f;
		else filtersGraduated = f;
	}

	function getChain(phase: TrenchesPhase): 'All' | Chain {
		if (phase === 'new') return chainNew;
		if (phase === 'graduating') return chainGraduating;
		return chainGraduated;
	}

	function setChain(phase: TrenchesPhase, chain: 'All' | Chain) {
		if (phase === 'new') chainNew = chain;
		else if (phase === 'graduating') chainGraduating = chain;
		else chainGraduated = chain;
	}

	function getPlatformsForPhase(phase: TrenchesPhase): readonly string[] {
		return platformsByPhase[phase];
	}

	function getPlatforms(phase: TrenchesPhase): Set<string> {
		if (phase === 'new') return platformsNew;
		if (phase === 'graduating') return platformsGraduating;
		return platformsGraduated;
	}

	function setPlatforms(phase: TrenchesPhase, p: Set<string>) {
		if (phase === 'new') platformsNew = p;
		else if (phase === 'graduating') platformsGraduating = p;
		else platformsGraduated = p;
	}

	function hasActiveFilters(phase: TrenchesPhase): boolean {
		const f = getFilters(phase);
		const p = getPlatforms(phase);
		return getChain(phase) !== 'All' || p.size > 0 || Object.values(f).some(v => !!v);
	}

	function activeFilterCount(phase: TrenchesPhase): number {
		const f = getFilters(phase);
		const p = getPlatforms(phase);
		return Object.values(f).filter(v => !!v).length + (p.size > 0 ? 1 : 0) + (getChain(phase) !== 'All' ? 1 : 0);
	}

	function phaseDefaults(phase: TrenchesPhase): PhaseFilters {
		if (phase === 'graduating') return { maxAgeHours: '24', minTxns1h: '1', minBuys1h: '1', minVolume1h: '10' };
		if (phase === 'graduated') return { maxAgeHours: '24' };
		return {};
	}

	function openFilters(phase: TrenchesPhase) {
		const saved = getFilters(phase);
		const defaults = phaseDefaults(phase);
		draftFilters = { ...defaults, ...saved };
		draftPlatforms = new Set(getPlatforms(phase));
		draftChain = getChain(phase);
		filterOpenPhase = phase;
	}

	function closeFilters() {
		filterOpenPhase = null;
	}

	function clearDraftFilters() {
		draftFilters = filterOpenPhase ? { ...phaseDefaults(filterOpenPhase) } : {};
		draftPlatforms = new Set();
		draftChain = 'All';
	}

	function applyFilters() {
		if (!filterOpenPhase) return;
		const phase = filterOpenPhase;
		setFilters(phase, { ...draftFilters });
		setPlatforms(phase, new Set(draftPlatforms));
		setChain(phase, draftChain);
		filterOpenPhase = null;
		fetchAndSubscribePhase(phase);
	}

	function resetPhaseFilters(phase: TrenchesPhase) {
		setFilters(phase, {});
		setPlatforms(phase, new Set());
		setChain(phase, 'All');
		fetchAndSubscribePhase(phase);
	}

	function df(key: string): string { return draftFilters[key] ?? ''; }
	function dfs(key: string, val: string) { draftFilters = { ...draftFilters, [key]: val }; }

	function dedup(tokens: ScannerItem[]): ScannerItem[] {
		const seen = new Set<string>();
		return tokens.filter((t) => {
			if (seen.has(t.pairAddress)) return false;
			seen.add(t.pairAddress);
			return true;
		});
	}

	function cleanupWs() {
		if (wsKeyNew) { unsubscribe(wsKeyNew); wsKeyNew = null; }
		if (wsKeyGraduating) { unsubscribe(wsKeyGraduating); wsKeyGraduating = null; }
		if (wsKeyGraduated) { unsubscribe(wsKeyGraduated); wsKeyGraduated = null; }
	}

	function phaseRange(f: PhaseFilters, minKey: string, maxKey: string): { min?: number; max?: number } | null {
		const mn = f[minKey] ? Number(f[minKey]) : undefined;
		const mx = f[maxKey] ? Number(f[maxKey]) : undefined;
		if (mn === undefined && mx === undefined) return null;
		const r: { min?: number; max?: number } = {};
		if (mn !== undefined && !isNaN(mn)) r.min = mn;
		if (mx !== undefined && !isNaN(mx)) r.max = mx;
		return Object.keys(r).length > 0 ? r : null;
	}

	function phaseMaxOnly(f: PhaseFilters, key: string): { max?: number } | null {
		const v = f[key] ? Number(f[key]) : undefined;
		if (v === undefined || isNaN(v)) return null;
		return { max: v };
	}

	function buildPhaseTokenFilter(phase: TrenchesPhase): Record<string, unknown> | null {
		const f = getFilters(phase);
		const p = getPlatforms(phase);
		const chain = getChain(phase);
		const tf: Record<string, unknown> = {};

		const scope: Record<string, unknown> = {};
		if (chain !== 'All') scope.chain = [chain];
		if (p.size > 0) scope.platforms = [...p];
		if (Object.keys(scope).length > 0) tf.scope = scope;

		const market: Record<string, unknown> = {};
		const mcap = phaseRange(f, 'minMarketCap', 'maxMarketCap'); if (mcap) market.marketCapUsd = mcap;
		const liq = phaseRange(f, 'minLiquidity', 'maxLiquidity'); if (liq) market.liquidityUsd = liq;
		const age = phaseRange(f, 'minAgeHours', 'maxAgeHours'); if (age) market.ageHours = age;
		if (Object.keys(market).length > 0) tf.market = market;

		const callCount = phaseRange(f, 'minCallCount', 'maxCallCount');
		if (callCount) tf.callCount = callCount;

		const tax: Record<string, unknown> = {};
		const buyTax = phaseMaxOnly(f, 'maxBuyTax'); if (buyTax) tax.buyTaxPct = buyTax;
		const sellTax = phaseMaxOnly(f, 'maxSellTax'); if (sellTax) tax.sellTaxPct = sellTax;
		const transferTax = phaseMaxOnly(f, 'maxTransferTax'); if (transferTax) tax.transferTaxPct = transferTax;
		if (Object.keys(tax).length > 0) tf.tax = tax;

		const tfSuffixToKey: Record<string, string> = { '5m': 'fiveMin', '1h': 'oneHour', '6h': 'sixHours', '24h': 'twentyFourHours' };
		const activity: Record<string, unknown> = {};
		for (const [suffix, key] of Object.entries(tfSuffixToKey)) {
			const win: Record<string, unknown> = {};
			const vol = phaseRange(f, `minVolume${suffix}`, `maxVolume${suffix}`); if (vol) win.volumeUsd = vol;
			const buys = phaseRange(f, `minBuys${suffix}`, `maxBuys${suffix}`); if (buys) win.buys = buys;
			const sells = phaseRange(f, `minSells${suffix}`, `maxSells${suffix}`); if (sells) win.sells = sells;
			const txns = phaseRange(f, `minTxns${suffix}`, `maxTxns${suffix}`); if (txns) win.transactions = txns;
			const fees = phaseRange(f, `minFees${suffix}`, `maxFees${suffix}`); if (fees) win.totalFeesUsd = fees;
			const priceChange = phaseRange(f, `minPriceChange${suffix}`, `maxPriceChange${suffix}`); if (priceChange) win.priceChangePct = priceChange;
			if (Object.keys(win).length > 0) activity[key] = win;
		}
		if (Object.keys(activity).length > 0) tf.activity = activity;

		const holders: Record<string, unknown> = {};
		const t10 = phaseRange(f, 'minTop10HoldingPct', 'maxTop10HoldingPct'); if (t10) holders.top10Pct = t10;
		const dp = phaseRange(f, 'minDevHoldingPct', 'maxDevHoldingPct'); if (dp) holders.devPct = dp;
		const sn = phaseRange(f, 'minSnipers', 'maxSnipers'); if (sn) holders.snipers = sn;
		const bn = phaseRange(f, 'minBundlers', 'maxBundlers'); if (bn) holders.bundlers = bn;
		const ins = phaseRange(f, 'minInsiders', 'maxInsiders'); if (ins) holders.insiders = ins;
		const tr = phaseRange(f, 'minTraders', 'maxTraders'); if (tr) holders.traders = tr;
		const sniperPct = phaseMaxOnly(f, 'maxSniperHoldingPct'); if (sniperPct) holders.sniperPct = sniperPct;
		const bundlerPct = phaseMaxOnly(f, 'maxBundlerHoldingPct'); if (bundlerPct) holders.bundlerPct = bundlerPct;
		const insiderPct = phaseMaxOnly(f, 'maxInsiderHoldingPct'); if (insiderPct) holders.insiderPct = insiderPct;
		const traderPct = phaseMaxOnly(f, 'maxTraderHoldingPct'); if (traderPct) holders.traderPct = traderPct;
		if (Object.keys(holders).length > 0) tf.holders = holders;

		const security: Record<string, unknown> = {};
		if (f['notHoneypot'] === 'true') security.honeypot = false;
		if (f['lpLocked'] === 'true') security.lpLocked = true;
		if (f['isRenounced'] === 'true') security.renounced = true;
		if (f['isVerified'] === 'true') security.contractVerified = true;
		if (f['freezeAuthorityDisabled'] === 'true') security.freezable = false;
		if (f['mintAuthorityDisabled'] === 'true') security.mintable = false;
		if (f['notProxy'] === 'true') security.proxy = false;
		if (Object.keys(security).length > 0) tf.security = security;

		const socials: Record<string, unknown> = {};
		if (f['dexPaid'] === 'true') socials.dexScreenerPaid = true;
		if (f['hasAnySocial'] === 'true') socials.hasAnySocial = true;
		if (f['hasWebsite'] === 'true') socials.hasWebsite = true;
		if (f['hasTwitter'] === 'true') socials.hasTwitter = true;
		if (f['hasTelegram'] === 'true') socials.hasTelegram = true;
		if (f['hasDiscord'] === 'true') socials.hasDiscord = true;
		if (Object.keys(socials).length > 0) tf.socials = socials;

		return Object.keys(tf).length > 0 ? tf : null;
	}

	function buildWsParams(phase: TrenchesPhase): Record<string, unknown> {
		const params: Record<string, unknown> = { phase };
		const tokenFilter = buildPhaseTokenFilter(phase);
		if (tokenFilter) Object.assign(params, tokenFilter);
		return params;
	}

	function setRowFlashes(phase: TrenchesPhase, affected: Map<string, RowFlashType>) {
		if (affected.size === 0) return;
		if (phase === 'new') rowFlashesNew = new Map(affected);
		else if (phase === 'graduating') rowFlashesGraduating = new Map(affected);
		else rowFlashesGraduated = new Map(affected);
		if (flashTimers[phase]) clearTimeout(flashTimers[phase]!);
		flashTimers[phase] = setTimeout(() => {
			if (phase === 'new') rowFlashesNew = new Map();
			else if (phase === 'graduating') rowFlashesGraduating = new Map();
			else rowFlashesGraduated = new Map();
		}, 1500);
	}

	function applyPhaseWsEvent(phase: TrenchesPhase, event: string, data: Parameters<typeof applyScannerWsEvent>[1], current: ScannerItem[]): ScannerItem[] {
		const result = applyScannerWsEvent(event, data, current);
		setRowFlashes(phase, result.affected);
		if (event === 'SCANNER_TOKENS' && (data as { stats?: FeedStats })?.stats) {
			setPhaseStats(phase, (data as { stats?: FeedStats }).stats ?? null);
		}
		return result.tokens;
	}

	function reconnectPhaseWs(phase: TrenchesPhase) {
		if (phase === 'new') {
			if (wsKeyNew) { unsubscribe(wsKeyNew); wsKeyNew = null; }
			wsKeyNew = subscribe('scanner:trenches', (event, data) => {
				wsMsgBuckets.new++;
				newTokens = applyPhaseWsEvent('new', event, data, newTokens);
			}, buildWsParams('new'), {
				onError: (error) => {
					if (isCursorRecoveryReason(error.reason)) fetchAndSubscribePhase('new');
				}
			});
		} else if (phase === 'graduating') {
			if (wsKeyGraduating) { unsubscribe(wsKeyGraduating); wsKeyGraduating = null; }
			wsKeyGraduating = subscribe('scanner:trenches', (event, data) => {
				wsMsgBuckets.graduating++;
				aboutToGrad = applyPhaseWsEvent('graduating', event, data, aboutToGrad);
			}, buildWsParams('graduating'), {
				onError: (error) => {
					if (isCursorRecoveryReason(error.reason)) fetchAndSubscribePhase('graduating');
				}
			});
		} else {
			if (wsKeyGraduated) { unsubscribe(wsKeyGraduated); wsKeyGraduated = null; }
			wsKeyGraduated = subscribe('scanner:trenches', (event, data) => {
				wsMsgBuckets.graduated++;
				graduated = applyPhaseWsEvent('graduated', event, data, graduated);
			}, buildWsParams('graduated'), {
				onError: (error) => {
					if (isCursorRecoveryReason(error.reason)) fetchAndSubscribePhase('graduated');
				}
			});
		}
	}

	function reconnectAllWs() {
		reconnectPhaseWs('new');
		reconnectPhaseWs('graduating');
		reconnectPhaseWs('graduated');
	}

	async function fetchPhase(phase: TrenchesPhase): Promise<ScannerItem[]> {
		const endpoint = phase === 'new' ? '/v2/scanner/trenches/new' as const
			: phase === 'graduating' ? '/v2/scanner/trenches/graduating' as const
			: '/v2/scanner/trenches/graduated' as const;
		const body: ScannerTokensRequest = {
			tokenFilter: buildPhaseTokenFilter(phase) as ScannerTokensRequest['tokenFilter'],
		};
		const { data } = await api.POST(endpoint, { body });
		setPhaseStats(phase, (data as { stats?: FeedStats })?.stats ?? null);
		return dedup(data?.tokens ?? []);
	}

	async function fetchNew() {
		loadingNew = true;
		try { newTokens = await fetchPhase('new'); } catch { newTokens = []; }
		loadingNew = false;
	}

	async function fetchAboutToGrad() {
		loadingAbout = true;
		try { aboutToGrad = await fetchPhase('graduating'); } catch { aboutToGrad = []; }
		loadingAbout = false;
	}

	async function fetchGraduated() {
		loadingGrad = true;
		try { graduated = await fetchPhase('graduated'); } catch { graduated = []; }
		loadingGrad = false;
	}

	async function fetchAndSubscribePhase(phase: TrenchesPhase) {
		if (phase === 'new') await fetchNew();
		else if (phase === 'graduating') await fetchAboutToGrad();
		else await fetchGraduated();
		reconnectPhaseWs(phase);
	}

	function fetchAndSubscribeAll() {
		fetchAndSubscribePhase('new');
		fetchAndSubscribePhase('graduating');
		fetchAndSubscribePhase('graduated');
	}

	onMount(() => {
		startWsCounters();
		return () => { cleanupWs(); if (wsMsgInterval) clearInterval(wsMsgInterval); };
	});

	$effect(() => {
		if (!routeActive) {
			cleanupWs();
			return;
		}
		fetchAndSubscribeAll();
	});

	function toggleDraftPlatform(p: string) {
		const availablePlatforms = filterOpenPhase ? getPlatformsForPhase(filterOpenPhase) : memePlatforms;
		const next = new Set(draftPlatforms);
		if (draftPlatforms.size === 0) {
			next.add(p);
			draftPlatforms = next;
		} else if (next.has(p)) {
			next.delete(p);
			draftPlatforms = next.size === 0 ? new Set() : next;
		} else {
			next.add(p);
			draftPlatforms = next.size === availablePlatforms.length ? new Set() : next;
		}
	}
</script>

<div class="flex flex-col pb-24 md:pb-0 h-[calc(100dvh-48px)] md:h-[calc(100dvh-48px-28px)]">
	{#if getIsDesktop()}
	<div class="grid flex-1 grid-cols-3 gap-0 overflow-hidden">
		{@render column('new', 'New', 'var(--t-g11)', newTokens, loadingNew, Inbox)}
		{@render column('graduating', 'Graduating', 'var(--t-yel)', aboutToGrad, loadingAbout, TrendingUp)}
		{@render column('graduated', 'Graduated', 'var(--t-grn)', graduated, loadingGrad, BadgeCheck)}
	</div>
	{:else}
	<div class="flex flex-1 flex-col overflow-hidden">
		<div class="flex shrink-0 border-b border-bd bg-s0">
			<button
				class="relative flex-1 cursor-pointer py-2.5 text-[12px] font-bold transition-all {mobilePhase === 'new' ? 'text-g11' : 'text-g4'}"
				onclick={() => (mobilePhase = 'new')}
			>
				New
				{#if mobilePhase === 'new'}
					<div class="absolute bottom-0 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-g11"></div>
				{/if}
			</button>
			<button
				class="relative flex-1 cursor-pointer py-2.5 text-[12px] font-bold transition-all {mobilePhase === 'graduating' ? 'text-yel' : 'text-g4'}"
				onclick={() => (mobilePhase = 'graduating')}
			>
				Graduating
				{#if mobilePhase === 'graduating'}
					<div class="absolute bottom-0 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-yel"></div>
				{/if}
			</button>
			<button
				class="relative flex-1 cursor-pointer py-2.5 text-[12px] font-bold transition-all {mobilePhase === 'graduated' ? 'text-grn' : 'text-g4'}"
				onclick={() => (mobilePhase = 'graduated')}
			>
				Graduated
				{#if mobilePhase === 'graduated'}
					<div class="absolute bottom-0 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-grn"></div>
				{/if}
			</button>
		</div>

		{#if phaseStats(mobilePhase)}
			{@const st = phaseStats(mobilePhase)!}
			<div class="flex shrink-0 items-center gap-4 border-b border-bd bg-s0 px-4 py-1.5 text-[11px]">
				<span class="text-g5">Vol <span class="font-semibold text-g8">{formatMarketCap(st.volumeStr)}</span></span>
				<span class="text-g5">Fees <span class="font-semibold text-g8">{formatMarketCap(st.fees.totalFeeUsdStr)}</span></span>
			</div>
		{/if}

		{#if mobilePhase === 'new'}
			{@render column('new', 'New', 'var(--t-g11)', newTokens, loadingNew, Inbox)}
		{:else if mobilePhase === 'graduating'}
			{@render column('graduating', 'Graduating', 'var(--t-yel)', aboutToGrad, loadingAbout, TrendingUp)}
		{:else}
			{@render column('graduated', 'Graduated', 'var(--t-grn)', graduated, loadingGrad, BadgeCheck)}
		{/if}
	</div>
	{/if}
</div>

{#snippet column(phase: TrenchesPhase, title: string, color: string, tokens: ScannerItem[], loading: boolean, EmptyIcon: typeof Inbox)}
	<div class="relative flex flex-col overflow-hidden {phase !== 'graduated' ? 'md:border-r border-bd' : ''}">
		<div class="hidden md:flex items-center gap-2.5 border-b border-bd bg-s0 px-4 py-2.5">
			<div class="h-2 w-2 rounded-full" style="background: {color}; animation: pulse-dot 2s ease-in-out infinite"></div>
			<span class="text-sm font-semibold" style="color: {color}">{title}</span>
			{#if phaseStats(phase)}
				{@const st = phaseStats(phase)!}
				<span class="text-[10px] text-g5">Vol <span class="font-semibold text-g8">{formatMarketCap(st.volumeStr)}</span></span>
				<span class="text-[10px] text-g5">Fees <span class="font-semibold text-g8">{formatMarketCap(st.fees.totalFeeUsdStr)}</span></span>
			{/if}
			<div class="ml-auto flex items-center gap-1.5">
				{#if hasActiveFilters(phase)}
					<button
						onclick={() => resetPhaseFilters(phase)}
						class="cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-medium text-red hover:text-red-light transition-colors"
					>Reset</button>
				{/if}
				<button
					onclick={() => filterOpenPhase === phase ? closeFilters() : openFilters(phase)}
					class="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors {filterOpenPhase === phase ? 'bg-tx/20 text-tx' : hasActiveFilters(phase) ? 'bg-grn/10 text-grn' : 'bg-s7 text-g7 hover:bg-s6 hover:text-tx'}"
					aria-label="Filter {title}"
				>
					<Filter class="h-3.5 w-3.5" strokeWidth={2} />
					{#if activeFilterCount(phase) > 0}
						<span class="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-grn px-0.5 text-[8px] font-bold text-s0">{activeFilterCount(phase)}</span>
					{/if}
				</button>
				<span class="flex items-center gap-1">
					<span class="inline-block h-1.5 w-1.5 rounded-full {wsMsgPerSec[phase] > 0 ? 'bg-grn animate-pulse' : 'bg-g1'}"></span>
					<span class="text-[10px] text-g4">{wsMsgPerSec[phase]} msg/s</span>
				</span>
			</div>
		</div>

		{#if filterOpenPhase === phase}
			<div class="absolute inset-0 top-0 md:top-[45px] z-10 flex flex-col bg-s5">
				<div class="flex items-center justify-between border-b border-bd px-4 py-2">
					<span class="text-xs font-bold text-tx">Filters</span>
					<div class="flex items-center gap-2">
						{#if Object.values(draftFilters).some(v => !!v) || draftPlatforms.size > 0 || draftChain !== 'All'}
							<button onclick={clearDraftFilters} class="cursor-pointer text-[10px] text-red hover:text-red-light">Clear</button>
						{/if}
						<button onclick={closeFilters} class="cursor-pointer rounded p-0.5 text-g5 hover:text-tx">
							<X class="h-3.5 w-3.5" strokeWidth={2} />
						</button>
					</div>
				</div>

				<div class="flex-1 overflow-y-auto px-3 py-3 space-y-4">
					<div>
						<span class="text-[10px] font-bold uppercase tracking-widest text-g7">Chain</span>
						<div class="mt-2 flex flex-wrap gap-1">
							{#each chains as chain}
								<button
									class="cursor-pointer rounded-md px-2.5 py-1 text-[10px] font-semibold transition-all {draftChain === chain
										? 'bg-grn/10 text-grn ring-1 ring-grn/20'
										: 'bg-s7 text-g5 ring-1 ring-bd hover:text-g8'}"
									onclick={() => (draftChain = chain)}
								>
									{chain}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[10px] font-bold uppercase tracking-widest text-g7">Platform</span>
							{#if draftPlatforms.size > 0}
								<button onclick={() => { draftPlatforms = new Set(); }} class="cursor-pointer text-[9px] text-g5 hover:text-g9">All</button>
							{/if}
						</div>
						<div class="flex flex-wrap gap-1">
							{#each getPlatformsForPhase(phase) as p}
								{@const active = draftPlatforms.size === 0 || draftPlatforms.has(p)}
								{@const info = getRouterInfo(p)}
								<button
									class="cursor-pointer flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all {active
										? 'bg-grn/10 text-grn ring-1 ring-grn/20'
										: 'bg-s7 text-g3 ring-1 ring-bd'}"
									onclick={() => toggleDraftPlatform(p)}
								>
									{#if info.icon}<img src={info.icon} alt="" class="h-3 w-3 rounded" />{/if}
									{info.name}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<span class="text-[10px] font-bold uppercase tracking-widest text-g7">Market</span>
						<div class="mt-2 space-y-2">
							{@render filterRange('MCap', 'minMarketCap', 'maxMarketCap', '$')}
							{@render filterRange('Liquidity', 'minLiquidity', 'maxLiquidity', '$')}
							{@render filterRange('Age', 'minAgeHours', 'maxAgeHours', 'h')}
							{@render filterRange('Callers', 'minCallCount', 'maxCallCount')}
							{@render filterSlider('Buy Tax', 'maxBuyTax')}
							{@render filterSlider('Sell Tax', 'maxSellTax')}
							{@render filterSlider('Transfer Tax', 'maxTransferTax')}
						</div>
					</div>

					<div>
						<span class="text-[10px] font-bold uppercase tracking-widest text-g7">Activity</span>
						<div class="mt-2 rounded bg-s4 p-0.5 flex gap-0.5 ring-1 ring-bd">
							{#each timeFrames as tf}
								<button
									class="relative flex-1 cursor-pointer rounded py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all {filterTimeFrame === tf ? 'bg-bd text-tx' : 'text-g4 hover:text-g7'}"
									onclick={() => (filterTimeFrame = tf)}
								>
									{tf}
									{#if Object.keys(draftFilters).some((key) => key.endsWith(tfSuffix[tf]) && !!draftFilters[key])}<span class="absolute bottom-0 left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full bg-grn"></span>{/if}
								</button>
							{/each}
						</div>
						<div class="mt-2 space-y-2">
							{@render filterRange('Volume', `minVolume${tfSuffix[filterTimeFrame]}`, `maxVolume${tfSuffix[filterTimeFrame]}`, '$')}
							{@render filterRange('Fees', `minFees${tfSuffix[filterTimeFrame]}`, `maxFees${tfSuffix[filterTimeFrame]}`, '$')}
							{@render filterRange('Buys', `minBuys${tfSuffix[filterTimeFrame]}`, `maxBuys${tfSuffix[filterTimeFrame]}`)}
							{@render filterRange('Sells', `minSells${tfSuffix[filterTimeFrame]}`, `maxSells${tfSuffix[filterTimeFrame]}`)}
							{@render filterRange('Txns', `minTxns${tfSuffix[filterTimeFrame]}`, `maxTxns${tfSuffix[filterTimeFrame]}`)}
							{@render filterRange('Price Chg %', `minPriceChange${tfSuffix[filterTimeFrame]}`, `maxPriceChange${tfSuffix[filterTimeFrame]}`)}
							{@render filterRange('Traders', 'minTraders', 'maxTraders')}
						</div>
					</div>

					<div>
						<span class="text-[10px] font-bold uppercase tracking-widest text-g7">Holders</span>
						<div class="mt-2 space-y-2">
							{@render filterRange('Top 10', 'minTop10HoldingPct', 'maxTop10HoldingPct', '%')}
							{@render filterRange('Dev', 'minDevHoldingPct', 'maxDevHoldingPct', '%')}
							{@render filterRange('Snipers', 'minSnipers', 'maxSnipers')}
							{@render filterRange('Bundlers', 'minBundlers', 'maxBundlers')}
							{@render filterRange('Insiders', 'minInsiders', 'maxInsiders')}
							{@render filterSlider('Sniper', 'maxSniperHoldingPct')}
							{@render filterSlider('Bundler', 'maxBundlerHoldingPct')}
							{@render filterSlider('Insider', 'maxInsiderHoldingPct')}
							{@render filterSlider('Trader', 'maxTraderHoldingPct')}
						</div>
					</div>

					<div>
						<span class="text-[10px] font-bold uppercase tracking-widest text-g7">Safety</span>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{@render filterChip('Not HP', 'notHoneypot')}
							{@render filterChip('LP Lock', 'lpLocked')}
							{@render filterChip('Renounced', 'isRenounced')}
							{@render filterChip('Verified', 'isVerified')}
							{@render filterChip('Freeze Off', 'freezeAuthorityDisabled')}
							{@render filterChip('Mint Off', 'mintAuthorityDisabled')}
							{@render filterChip('Not Proxy', 'notProxy')}
							{@render filterChip('DEX Paid', 'dexPaid')}
						</div>
					</div>

					<div>
						<span class="text-[10px] font-bold uppercase tracking-widest text-g7">Social</span>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{@render filterChip('Any', 'hasAnySocial')}
							{@render filterChip('Website', 'hasWebsite')}
							{@render filterChip('Twitter', 'hasTwitter')}
							{@render filterChip('Telegram', 'hasTelegram')}
							{@render filterChip('Discord', 'hasDiscord')}
						</div>
					</div>
				</div>

				<div class="border-t border-bd p-3">
					<button
						onclick={applyFilters}
						class="w-full cursor-pointer rounded-lg bg-grn py-2 text-xs font-bold text-s0 uppercase tracking-wider transition-all hover:bg-grn-dim active:scale-[0.98]"
					>
						Apply
					</button>
				</div>
			</div>
		{/if}

		<div class="flex md:hidden items-center justify-between px-3 py-2 border-b border-bd">
			<span class="flex items-center gap-1">
				<span class="inline-block h-1.5 w-1.5 rounded-full {wsMsgPerSec[phase] > 0 ? 'bg-grn animate-pulse' : 'bg-g1'}"></span>
				<span class="text-[10px] text-g4">{wsMsgPerSec[phase]} msg/s</span>
			</span>
			<button
				onclick={() => filterOpenPhase === phase ? closeFilters() : openFilters(phase)}
				class="relative cursor-pointer flex items-center gap-1.5 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-g7 active:bg-s7"
			>
				<Filter class="h-3 w-3" strokeWidth={2} />
				Filter
				{#if activeFilterCount(phase) > 0}
					<span class="rounded-full bg-grn/20 px-1.5 text-[10px] font-bold text-grn">{activeFilterCount(phase)}</span>
				{/if}
			</button>
		</div>
		<div class="flex-1 space-y-1.5 overflow-y-auto p-2">
			{#if loading}
				{#each Array(6) as _}
					<div class="skeleton h-[180px] rounded-xl"></div>
				{/each}
			{:else if tokens.length === 0}
				<div class="flex h-40 flex-col items-center justify-center gap-2">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-s4 ring-1 ring-bd">
						<EmptyIcon class="h-5 w-5 text-g5" strokeWidth={1.5} />
					</div>
					<span class="text-xs text-g5">No tokens</span>
				</div>
			{:else}
				{#each tokens as token (token.pairAddress)}
					<MemescopeCard {token} {phase} rowFlash={(phase === 'new' ? rowFlashesNew : phase === 'graduating' ? rowFlashesGraduating : rowFlashesGraduated).get(token.pairAddress)} />
				{/each}
			{/if}
		</div>
	</div>
{/snippet}

{#snippet filterRange(label: string, minKey: string, maxKey: string, unit?: string)}
	<div class="flex items-center gap-1.5">
		<span class="w-16 shrink-0 text-[10px] text-g6">{label}</span>
		<div class="relative w-full min-w-0">
			{#if unit}<span class="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] text-g4">{unit}</span>{/if}
			<input type="number" placeholder="min" value={df(minKey)} oninput={(e) => dfs(minKey, e.currentTarget.value)}
				class="w-full rounded border border-bd bg-s4 py-1 text-[11px] text-tx placeholder-g1 outline-none focus:border-grn/40 {unit ? 'pl-4 pr-2' : 'px-2'}" />
		</div>
		<span class="text-[9px] text-g1">-</span>
		<div class="relative w-full min-w-0">
			{#if unit}<span class="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] text-g4">{unit}</span>{/if}
			<input type="number" placeholder="max" value={df(maxKey)} oninput={(e) => dfs(maxKey, e.currentTarget.value)}
				class="w-full rounded border border-bd bg-s4 py-1 text-[11px] text-tx placeholder-g1 outline-none focus:border-grn/40 {unit ? 'pl-4 pr-2' : 'px-2'}" />
		</div>
	</div>
{/snippet}

{#snippet filterSlider(label: string, key: string)}
	{@const value = df(key) ? Number(df(key)) : 100}
	<div>
		<div class="mb-1 flex items-center justify-between">
			<span class="text-[10px] text-g6">{label}</span>
			<span class="text-[10px] font-medium {value < 100 ? 'text-grn' : 'text-g4'}">{value < 100 ? `≤${value}%` : 'Any'}</span>
		</div>
		<input
			type="range"
			min="0"
			max="100"
			step="1"
			value={value}
			oninput={(e) => {
				const next = Number(e.currentTarget.value);
				dfs(key, next >= 100 ? '' : String(next));
			}}
			class="slider-input h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bd2 accent-grn outline-none"
		/>
	</div>
{/snippet}

{#snippet filterChip(label: string, key: string)}
	{@const active = df(key) === 'true'}
	<button
		class="cursor-pointer rounded-md px-2 py-1 text-[10px] font-semibold transition-all {active
			? 'bg-grn/10 text-grn ring-1 ring-grn/20'
			: 'bg-s7 text-g5 ring-1 ring-bd hover:text-g8'}"
		onclick={() => dfs(key, active ? '' : 'true')}
	>
		{label}
	</button>
{/snippet}
