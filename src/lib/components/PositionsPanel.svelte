<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import Lock from 'lucide-svelte/icons/lock';
	import Box from 'lucide-svelte/icons/box';
	import Clock from 'lucide-svelte/icons/clock';
	import ClipboardList from 'lucide-svelte/icons/clipboard-list';
	import X from 'lucide-svelte/icons/x';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import BotIcon from 'lucide-svelte/icons/bot';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Wallet from 'lucide-svelte/icons/wallet';
	import ListIcon from 'lucide-svelte/icons/list';
	import Megaphone from 'lucide-svelte/icons/megaphone';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Share2 from 'lucide-svelte/icons/share-2';
	import TargetCard from './TargetCard.svelte';
	import ChainIcon from './ChainIcon.svelte';
	import CurrencyValue from './CurrencyValue.svelte';
	import type { SellTargetRow, SellTargetKind } from '$lib/stores/trade.svelte';
	import { onDestroy } from 'svelte';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { portal } from '$lib/actions/portal';
	import {
		getActivePositions, getPendingTrades, getCompletedTrades, getActivePositionsTotal, getPendingTradesTotal, getCompletedTotalCount, getCompletedFetched,
		getActiveLoading, getCompletedLoading, getActiveHasMore, getCompletedHasMore,
		getActiveCursor, getCompletedCursor, getActiveCursorTriplet, getCompletedCursorTriplet,
		fetchActiveTrades, fetchCompletedTrades, fetchMoreActive, fetchMoreCompleted,
		executeSell, abortTrade, dismissTrade, getSellLoading, setSellPercent,
		handleTradeUpdate, handleBalanceUpdate, handleTradesSnapshot, type PositionTab
	} from '$lib/stores/trade.svelte';
	import { formatUsd, formatNumber, formatMarketCap, formatPriceText, shortAddress, timeAgo, fullDateTime, explorerTxUrl } from '$lib/utils/format';
	import { getNow } from '$lib/stores/tick.svelte';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api/client';
	import type { ActiveTrade, CompletedTrade, TradeTarget, TradeMetTarget, ExecutedTradeSwapRow, TradeSettings, Chain, TradeTargetConfig, TradeTargetTrigger, GasPreset, Bot } from '$lib/api/types';
	import { positivePercentTargetTrigger } from '$lib/utils/trade-targets';
	import { completedTradeTimestamp } from '$lib/utils/completed-trades';
	import { getExpandPositions } from '$lib/stores/feSettings.svelte';
	import { liveAccumulatedParams } from '$lib/utils/livecursor';

	type BotInfo = { sourceType: string; sourceName: string };
	let PnlShareCard = $state<any>(null);

	function tradeSources(trade: ActiveTrade | CompletedTrade): BotInfo[] {
		if (!trade.automation?.hasBot || !trade.automation.bots?.length) return [];
		return trade.automation.bots.map((b) => ({ sourceType: b.source.type, sourceName: b.source.name }));
	}

	let { selectedChain = '', selectedAddress = '', onnavigate = () => {} }: { selectedChain?: string; selectedAddress?: string; onnavigate?: () => void } = $props();

	type TradeResponse = ActiveTrade | CompletedTrade;
	type TargetKind = TradeTarget['kind'];

	let selectedTrade = $state<TradeResponse | null>(null);
	let shareTrade = $state<CompletedTrade | null>(null);
	let showShareCard = $state(false);
	let editingTrade = $state<ActiveTrade | null>(null);
	let editTargets = $state<{ id?: string; type: string; trigger: string; sellPct: string; targetKind: 'TAKE_PROFIT' | 'STOP_LOSS'; mode: 'NORMAL' | 'TRAILING' }[]>([]);
	let editStopLoss = $state<{ enabled: boolean; mode: string; type: string; trigger: string; sellPct: string }>({ enabled: false, mode: 'NORMAL', type: 'PERCENTAGE', trigger: '50', sellPct: '100' });
	let editSellSlippage = $state('');
	let editSellGasPriceType = $state('AUTO');
	let editSaving = $state(false);
	let editError = $state<string | null>(null);
	let dismissConfirmTrade = $state<ActiveTrade | null>(null);
	let dismissing = $state(false);
	let sellModalTrade = $state<ActiveTrade | null>(null);
	let copiedTradeId = $state<number | null>(null);
	let expandedTradeIds = $state<Set<number>>(new Set());

	function toggleExpand(tradeId: number, e: Event) {
		e.stopPropagation();
		const next = new Set(expandedTradeIds);
		if (next.has(tradeId)) next.delete(tradeId);
		else next.add(tradeId);
		expandedTradeIds = next;
	}

	function navigateToTrade(trade: ActiveTrade | CompletedTrade) {
		const next = new Set(expandedTradeIds);
		next.add(trade.id);
		expandedTradeIds = next;
		onnavigate();
		goto(`/?chain=${trade.chain}&token=${trade.tokenAddress}`, { replaceState: false, noScroll: true });
	}
	let sellPct = $state(100);
	let sellExecuting = $state(false);

	function triggerValue(trigger: TradeTargetTrigger): string {
		switch (trigger.type) {
			case 'MULTIPLIER': return String(trigger.multiplier);
			case 'PERCENT': return String(trigger.changePct);
			case 'MARKET_CAP_USD': return String(trigger.marketCapUsd);
			case 'PRICE': return String(trigger.priceUsd);
		}
	}

	function triggerTypeToEditType(trigger: TradeTargetTrigger): string {
		switch (trigger.type) {
			case 'MULTIPLIER': return 'MULTIPLE';
			case 'PERCENT': return 'PERCENTAGE';
			case 'MARKET_CAP_USD': return 'MARKETCAP';
			case 'PRICE': return 'USD';
		}
	}

	function isActiveTrade(trade: TradeResponse): trade is ActiveTrade {
		return 'activeTargets' in trade;
	}

	function liveTargets(trade: TradeResponse, kind: TargetKind): TradeTarget[] {
		return isActiveTrade(trade)
			? trade.activeTargets.filter((t: TradeTarget) => t.status === 'LIVE' && t.kind === kind)
			: [];
	}

	function metTargets(trade: TradeResponse, kind: TargetKind): TradeMetTarget[] {
		return trade.metTargets?.filter((t: TradeMetTarget) => t.kind === kind) ?? [];
	}

	function targetTriggerLabel(target: TradeTarget | TradeMetTarget): string {
		switch (target.trigger.type) {
			case 'MULTIPLIER': return `${Number(target.trigger.multiplier).toFixed(target.kind === 'STOP_LOSS' ? 2 : 1)}x`;
			case 'PERCENT': {
				const sign = target.kind === 'STOP_LOSS' ? '-' : '+';
				return `${sign}${Math.abs(Number(target.trigger.changePct)).toFixed(0)}%`;
			}
			case 'MARKET_CAP_USD': return formatMarketCap(target.trigger.marketCapUsd);
			case 'PRICE': return formatUsd(String(target.trigger.priceUsd));
		}
	}

	function openEditModal(trade: ActiveTrade) {
		editingTrade = trade;
		editError = null;
		const settings = trade.settings;
		editSellSlippage = settings.sellSlippagePct === 'AUTO' ? '' : String(settings.sellSlippagePct);
		editSellGasPriceType = typeof settings.sellGas === 'string' ? settings.sellGas : 'AUTO';
		editTargets = trade.activeTargets
			.filter((t: TradeTarget) => t.status === 'LIVE')
			.map((t: TradeTarget) => ({
				id: t.id,
				type: triggerTypeToEditType(t.trigger),
				trigger: triggerValue(t.trigger),
				sellPct: String(t.sellPct),
				targetKind: t.kind as 'TAKE_PROFIT' | 'STOP_LOSS',
				mode: (t.mode ?? 'NORMAL') as 'NORMAL' | 'TRAILING'
			}));
		editStopLoss = { enabled: false, mode: 'NORMAL', type: 'PERCENTAGE', trigger: '50', sellPct: '100' };
	}

	function addEditTarget(kind: 'TAKE_PROFIT' | 'STOP_LOSS' = 'TAKE_PROFIT', mode: 'NORMAL' | 'TRAILING' = 'NORMAL') {
		const trailing = mode === 'TRAILING';
		editTargets = [...editTargets, { type: trailing ? 'PERCENTAGE' : 'MULTIPLE', trigger: kind === 'TAKE_PROFIT' ? '2' : trailing ? '20' : '50', sellPct: kind === 'TAKE_PROFIT' ? '50' : '100', targetKind: trailing ? 'STOP_LOSS' : kind, mode: trailing ? 'TRAILING' : 'NORMAL' }];
	}

	function removeEditTarget(idx: number) {
		editTargets = editTargets.filter((_, i) => i !== idx);
	}

	function buildTargetPayload(t: { type: string; trigger: string; sellPct: string; targetKind: 'TAKE_PROFIT' | 'STOP_LOSS'; mode: 'NORMAL' | 'TRAILING' }): TradeTargetConfig | null {
		const sellPct = parseFloat(t.sellPct || '0');
		let trigger: TradeTargetTrigger;
		switch (t.type) {
			case 'MULTIPLE': trigger = { type: 'MULTIPLIER', multiplier: parseFloat(t.trigger) }; break;
			case 'PERCENTAGE': trigger = positivePercentTargetTrigger(parseFloat(t.trigger)); break;
			case 'MARKETCAP': trigger = { type: 'MARKET_CAP_USD', marketCapUsd: parseFloat(t.trigger) }; break;
			case 'USD': trigger = { type: 'PRICE', priceUsd: parseFloat(t.trigger) }; break;
			default: return null;
		}
		if (t.targetKind === 'STOP_LOSS') {
			return { kind: 'STOP_LOSS', sellPct, trigger, mode: t.mode };
		}
		return { kind: 'TAKE_PROFIT', sellPct, trigger };
	}

	async function savePositionEdit() {
		if (!editingTrade) return;
		editSaving = true;
		editError = null;
		const trade = editingTrade;
		const chain = trade.chain;
		const token = trade.tokenAddress;
		try {
			const existingIds = new Set(
				trade.activeTargets
					.filter((t: TradeTarget) => t.status === 'LIVE')
					.map((t: TradeTarget) => t.id)
			);
			const keptIds = new Set(editTargets.filter(t => t.id).map(t => t.id));
			for (const id of existingIds) {
				if (!keptIds.has(id)) {
					await api.DELETE('/v2/trade/{chain}/{token}/targets/remove/{id}', { params: { path: { chain, token, id } } });
				}
			}
			for (const t of editTargets) {
				const payload = buildTargetPayload(t);
				if (!payload) continue;
				if (t.id && existingIds.has(t.id)) {
					await api.POST('/v2/trade/{chain}/{token}/targets/update/{id}', { params: { path: { chain, token, id: t.id } }, body: payload });
				} else {
					await api.POST('/v2/trade/{chain}/{token}/targets/add', { params: { path: { chain, token } }, body: payload });
				}
			}
			const sellSlippagePct = editSellSlippage && parseFloat(editSellSlippage) > 0 ? parseFloat(editSellSlippage) : 'AUTO' as const;
			const { targets: _, ...restSettings } = trade.settings;
			const settings = {
				...restSettings,
				sellGas: editSellGasPriceType as GasPreset,
				sellSlippagePct,
			};
			await api.POST('/v2/trade/{chain}/{token}/settings', { params: { path: { chain, token } }, body: settings as never });
			await fetchActiveTrades();
			editingTrade = null;
		} catch (e: unknown) {
			editError = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			editSaving = false;
		}
	}

	let activeTab = $state<PositionTab>('active');
	let sellingTradeId = $state<number | null>(null);
	let tradeWsKey: string | null = null;
	let activeTradesWsKey: string | null = null;
	let completedTradesWsKey: string | null = null;

	function cleanupActiveTradesWs() {
		if (activeTradesWsKey) {
			unsubscribe(activeTradesWsKey);
			activeTradesWsKey = null;
		}
	}

	function cleanupCompletedTradesWs() {
		if (completedTradesWsKey) {
			unsubscribe(completedTradesWsKey);
			completedTradesWsKey = null;
		}
	}

	function handleTradesUpdate(data: unknown, meta?: Record<string, unknown>) {
		const removedTradeIds = meta?.removedTradeIds;
		handleTradeUpdate(
			'USER_TRADE_UPDATE',
			{},
			Array.isArray(removedTradeIds) ? { removedTradeIds } : undefined
		);
		const trades = (data as { trades?: unknown[] } | null)?.trades;
		if (!Array.isArray(trades)) return;
		for (const trade of trades) {
			handleTradeUpdate('USER_TRADE_UPDATE', { trade });
		}
	}

	function setupActiveTradesWs() {
		cleanupActiveTradesWs();
		const params = liveAccumulatedParams(getActiveCursorTriplet());
		if (!params) return;
		activeTradesWsKey = subscribe('trades:active', (event, data, topic, meta) => {
			if (event === 'USER_TRADES') handleTradesSnapshot(topic, data, meta);
			if (event === 'USER_TRADES_UPDATE') handleTradesUpdate(data, meta);
		}, params, {
			recovery: 'refetch',
			onReconnect: () => { void fetchActiveTrades().then(setupActiveTradesWs); }
		});
	}

	function setupCompletedTradesWs() {
		cleanupCompletedTradesWs();
		const params = liveAccumulatedParams(getCompletedCursorTriplet());
		if (!params) return;
		completedTradesWsKey = subscribe('trades:completed', (event, data, topic, meta) => {
			if (event === 'USER_TRADES') handleTradesSnapshot(topic, data, meta);
			if (event === 'USER_TRADES_UPDATE') handleTradesUpdate(data, meta);
		}, params, {
			recovery: 'refetch',
			onReconnect: () => { void fetchCompletedTrades().then(setupCompletedTradesWs); }
		});
	}

	function setupTradeWs() {
		if (tradeWsKey) unsubscribe(tradeWsKey);
		tradeWsKey = subscribe('user', (event, data, _topic, meta) => {
			if (event === 'USER_TRADE_UPDATE' || event === 'USER_TRADE_UPDATE_ERROR') handleTradeUpdate(event, data, meta);
			if (event === 'USER_BALANCE') handleBalanceUpdate(data);
		});
	}

	$effect(() => {
		let cancelled = false;
		if (getIsLoggedIn()) {
			fetchActiveTrades().then(() => { if (!cancelled) setupActiveTradesWs(); });
			setupTradeWs();
		}
		return () => {
			cancelled = true;
			if (tradeWsKey) {
				unsubscribe(tradeWsKey);
				tradeWsKey = null;
			}
			cleanupActiveTradesWs();
			cleanupCompletedTradesWs();
		};
	});

	$effect(() => {
		let cancelled = false;
		// Fetch the first history page the first time History is opened. Gate on
		// "never fetched" (not "list is empty") — a sold trade may have been seeded
		// into the list by a WS update before history was ever loaded, which would
		// otherwise suppress the initial fetch and leave pagination broken.
		if (activeTab === 'history' && getIsLoggedIn() && !getCompletedFetched()) {
			fetchCompletedTrades().then(() => { if (!cancelled) setupCompletedTradesWs(); });
		}
		return () => { cancelled = true; };
	});

	onDestroy(() => {
		if (tradeWsKey) {
			unsubscribe(tradeWsKey);
			tradeWsKey = null;
		}
		cleanupActiveTradesWs();
		cleanupCompletedTradesWs();
	});

	// API pnl is GROSS (fees excluded). Subtract cumulative trade fees so the UI
	// reflects true net profit/loss. USD/native pnl are plain numbers; fees carry
	// exact string + number — we use the numbers for display arithmetic.
	function netPnlUsd(trade: TradeResponse): number {
		return trade.pnl.usd - (trade.totalFees?.usd ?? 0);
	}
	function netPnlNative(trade: TradeResponse): number {
		return trade.pnl.native - (trade.totalFees?.native ?? 0);
	}
	function netPnlPct(trade: TradeResponse): number {
		const basis = trade.totalBought?.usd ?? 0;
		if (basis <= 0) return trade.pnl.pct;
		return (netPnlUsd(trade) / basis) * 100;
	}
	function netPnlMultiplier(trade: TradeResponse): number {
		const basis = trade.totalBought?.usd ?? 0;
		if (basis <= 0) return trade.pnl.multiplier;
		const mult = (basis + netPnlUsd(trade)) / basis;
		return mult > 0 ? mult : 0;
	}
	function pnlColor(trade: TradeResponse): string {
		return netPnlUsd(trade) < 0 ? 'text-red' : 'text-grn';
	}

	const pegSymbol: Record<string, string> = { SOL: 'SOL', ETH: 'ETH', BASE: 'ETH', BSC: 'BNB', SEPOLIA: 'ETH' };

	function formatPeg(value: string, chain: string): string {
		const sym = pegSymbol[chain] ?? chain;
		return `${parseFloat(value).toFixed(4)} ${sym}`;
	}

	function statusBadge(status: string): string {
		switch (status) {
			case 'ACTIVE': return 'bg-grn/20 text-grn';
			case 'PENDING': return 'bg-yel/20 text-yel';
			case 'COMPLETED': return 'bg-g4/20 text-g5';
			default: return 'bg-g4/20 text-g5';
		}
	}

	function openSellModal(trade: ActiveTrade) {
		sellModalTrade = trade;
		sellPct = 100;
		sellExecuting = false;
	}

	async function confirmSell() {
		if (!sellModalTrade) return;
		sellExecuting = true;
		sellingTradeId = sellModalTrade.id;
		try {
			setSellPercent(sellPct);
			await executeSell(sellModalTrade.chain, sellModalTrade.tokenAddress, sellModalTrade.id);
			sellModalTrade = null;
		} catch {} finally {
			sellExecuting = false;
			sellingTradeId = null;
		}
	}

	async function sellAll(trade: ActiveTrade) {
		if (sellingTradeId !== null) return;
		sellingTradeId = trade.id;
		try {
			setSellPercent(100);
			await executeSell(trade.chain, trade.tokenAddress, trade.id);
			selectedTrade = null;
		} catch {} finally {
			sellingTradeId = null;
		}
	}

	function isViewing(trade: TradeResponse): boolean {
		return trade.chain === selectedChain && trade.tokenAddress === selectedAddress;
	}

	const tabs: { label: string; value: PositionTab }[] = [
		{ label: 'Positions', value: 'active' },
		{ label: 'Pending', value: 'pending' },
		{ label: 'History', value: 'history' }
	];

	function currentTrades(): (ActiveTrade | CompletedTrade)[] {
		switch (activeTab) {
			case 'active': return getActivePositions();
			case 'pending': return getPendingTrades();
			case 'history': return getCompletedTrades();
		}
	}

	function displayedTradeTimestamp(trade: ActiveTrade | CompletedTrade): number {
		return trade.status === 'COMPLETED'
			? completedTradeTimestamp(trade)
			: trade.createdAtTimestamp;
	}

	function isLoading(): boolean {
		return activeTab === 'history' ? getCompletedLoading() : getActiveLoading();
	}

	function hasMore(): boolean {
		return activeTab === 'history' ? getCompletedHasMore() : getActiveHasMore();
	}

	async function loadMore() {
		if (activeTab === 'history') {
			const before = getCompletedCursor();
			await fetchMoreCompleted();
			const after = getCompletedCursor();
			if (after && after !== before) setupCompletedTradesWs();
		} else {
			const before = getActiveCursor();
			await fetchMoreActive();
			const after = getActiveCursor();
			if (after && after !== before) setupActiveTradesWs();
		}
	}
</script>

<div class="flex h-full flex-col border-t border-bd bg-transparent">
	<div class="flex border-b border-bd">
		{#each tabs as tab}
			{@const count = tab.value === 'active' ? getActivePositionsTotal() : tab.value === 'pending' ? getPendingTradesTotal() : getCompletedTotalCount()}
			<button
				class="relative flex-1 px-2 py-2 text-xs font-semibold transition-all duration-200 {activeTab === tab.value
					? 'text-tx'
					: 'text-g6 hover:text-g9'}"
				onclick={() => (activeTab = tab.value)}
			>
				{tab.label}
				{#if count > 0}
					<span class="ml-1 rounded-full bg-s7 px-1.5 py-0.5 text-[10px] font-medium text-g5">{count}</span>
				{/if}
				{#if activeTab === tab.value}
					<div class="absolute bottom-0 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-grn"></div>
				{/if}
			</button>
		{/each}
	</div>

	{#if !getIsLoggedIn()}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-4">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-s4 ring-1 ring-bd">
				<Lock class="h-5 w-5 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-xs text-g5">Connect wallet to view positions</span>
		</div>
	{:else if isLoading() && currentTrades().length === 0}
		<div class="space-y-1.5 p-2">
			{#each Array(3) as _, i}
				<div class="skeleton h-14 rounded-lg" style="animation-delay: {i * 80}ms"></div>
			{/each}
		</div>
	{:else if currentTrades().length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-4">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-s4 ring-1 ring-bd">
				{#if activeTab === 'active'}
					<Box class="h-5 w-5 text-g5" strokeWidth={1.5} />
				{:else if activeTab === 'pending'}
					<Clock class="h-5 w-5 text-g5" strokeWidth={1.5} />
				{:else}
					<ClipboardList class="h-5 w-5 text-g5" strokeWidth={1.5} />
				{/if}
			</div>
			<span class="text-xs text-g5">
				{activeTab === 'active' ? 'No active positions' : activeTab === 'pending' ? 'No pending orders' : 'No trade history'}
			</span>
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto p-2.5">
			<div class="space-y-1.5">
				{#each currentTrades() as trade (trade.id)}
					{@const isExpanded = getExpandPositions() || expandedTradeIds.has(trade.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="group cursor-pointer rounded-xl border transition-all {isViewing(trade) ? 'border-grn/40 bg-s1' : 'border-bd bg-s1 hover:border-bd3'}"
						onclick={() => navigateToTrade(trade)}
				>
					<div
						class="flex cursor-pointer items-center gap-2 p-2.5"
					>
						<img
							src={tokenImage(trade.chain, trade.tokenAddress)}
							alt=""
							class="h-7 w-7 shrink-0 rounded-lg ring-1 ring-bd"
							onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<span class="truncate text-sm font-bold text-tx">{trade.tokenSymbol}</span>
								<span
									class="shrink-0 cursor-pointer rounded bg-s7 px-1 py-0.5 text-[10px] transition-colors {copiedTradeId === trade.id ? 'text-grn' : 'text-g4 hover:text-g9'}"
									onclick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(String(trade.id)); copiedTradeId = trade.id; setTimeout(() => { if (copiedTradeId === trade.id) copiedTradeId = null; }, 1500); }}
									title="Copy trade ID"
								>{copiedTradeId === trade.id ? 'Copied!' : `#${trade.id}`}</span>
							</div>
							<div class="flex items-center gap-1.5 text-[10px] text-g5">
								<ChainIcon chain={trade.chain} class="h-3 w-3 text-g5" />
								<span>·</span>
								<span class="cursor-help" title={fullDateTime(displayedTradeTimestamp(trade))}>{timeAgo(displayedTradeTimestamp(trade), getNow())}</span>
							</div>
						</div>
						<div class="shrink-0 text-right">
							<CurrencyValue usd={String(netPnlUsd(trade))} native={String(netPnlNative(trade))} chain={trade.chain} mode="value" class="{pnlColor(trade)} text-sm font-bold" iconClass="h-3.5 w-3.5" />
							<div class="{pnlColor(trade)} text-[11px]">{netPnlPct(trade).toFixed(1)}%</div>
						</div>
						{#if activeTab === 'history'}
							<button
								class="shrink-0 cursor-pointer rounded-md p-1 text-g4 transition-colors hover:text-grn"
								onclick={(e) => {
									e.stopPropagation();
									shareTrade = trade as CompletedTrade;
									showShareCard = true;
									if (!PnlShareCard) {
										import('./PnlShareCard.svelte').then((m) => { PnlShareCard = m.default; });
									}
								}}
								title="Share PnL"
							>
								<Share2 class="h-3.5 w-3.5" />
							</button>
						{/if}
						<button
							class="shrink-0 cursor-pointer rounded-md p-0.5 text-g4 transition-all hover:text-g9"
							onclick={(e) => toggleExpand(trade.id, e)}
							title={isExpanded ? 'Collapse' : 'Expand'}
						>
							<ChevronDown class="h-4 w-4 transition-transform {isExpanded ? 'rotate-180' : ''}" strokeWidth={2} />
						</button>
					</div>

					{#if trade.automation?.hasBot}
						<div class="px-2.5 pb-1.5">
							{@render tradeBadge(trade)}
						</div>
					{/if}

					{#if isExpanded}
					<div class="px-2.5 pb-2.5">
					{#if trade.swaps?.length > 0}
						<div class="mt-1 space-y-px">
							{#each trade.swaps as swap}
								<div class="flex items-center gap-1.5 px-1 py-0.5 text-[10px]">
									<span class="w-7 shrink-0 font-bold {swap.side === 'BUY' ? 'text-grn' : 'text-red'}">{swap.side === 'BUY' ? 'BUY' : 'SELL'}</span>
									<CurrencyValue usd={String(swap.value.amount.usd)} native={String(swap.value.amount.native)} chain={trade.chain} mode="value" class="text-tx" iconClass="h-3 w-3" />
									{#if swap.value.amountToken}
										<span class="text-g4">{formatNumber(String(swap.value.amountToken))}</span>
									{/if}
									{#if swap.target}
										<span class="rounded bg-{swap.target.kind === 'TAKE_PROFIT' ? 'grn' : 'red'}/10 px-1 py-px text-[9px] font-medium text-{swap.target.kind === 'TAKE_PROFIT' ? 'grn' : 'red'}">{swap.target.kind === 'TAKE_PROFIT' ? 'TP' : 'SL'}</span>
									{/if}
									<span class="ml-auto text-g4 cursor-help" title={fullDateTime(swap.timestamp)}>{timeAgo(swap.timestamp, getNow())}</span>
									{#if !swap.txHash}
										<span class="h-1.5 w-1.5 rounded-full bg-yel animate-pulse"></span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					<div class="mt-1 rounded-lg border border-bd/30 bg-s2 p-2 space-y-1 text-[10px]">
						<div class="flex items-center justify-between">
							<span class="text-g4">Bought</span>
							<span class="font-semibold text-tx"><CurrencyValue usd={String(trade.totalBought.usd)} native={String(trade.totalBought.native)} chain={trade.chain} mode="value" iconClass="h-3 w-3" /> <span class="text-g4">({formatNumber(String(trade.totalBought.tokens))})</span></span>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-g4">Sold</span>
							<span class="font-semibold text-tx"><CurrencyValue usd={String(trade.totalSold.usd)} native={String(trade.totalSold.native)} chain={trade.chain} mode="value" iconClass="h-3 w-3" /> <span class="text-g4">({formatNumber(String(trade.totalSold.tokens))})</span></span>
						</div>
						{#if 'currentValue' in trade && trade.currentValue}
							<div class="flex items-center justify-between">
								<span class="text-g4">Value</span>
								<span class="font-semibold text-tx"><CurrencyValue usd={String(trade.currentValue.usd)} native={String(trade.currentValue.native)} chain={trade.chain} mode="value" iconClass="h-3 w-3" /> {#if trade.pnl.multiplier}<span class="text-yel">{netPnlMultiplier(trade).toFixed(2)}x</span>{/if}</span>
							</div>
						{:else if trade.pnl}
							<div class="flex items-center justify-between">
								<span class="text-g4">PnL</span>
								<span class="font-semibold {pnlColor(trade)}"><CurrencyValue usd={String(netPnlUsd(trade))} native={String(netPnlNative(trade))} chain={trade.chain} mode="value" iconClass="h-3 w-3" /> {#if trade.pnl.multiplier}<span>{netPnlMultiplier(trade).toFixed(2)}x</span>{/if}</span>
							</div>
						{/if}
					</div>

					{#if activeTab === 'active' || activeTab === 'pending'}
						{@const activeTrade = trade as ActiveTrade}
						{@const entryMc = trade.avgEntryMcap.usd}
						{@const currentMc = activeTrade.currentMcap?.usd ?? 0}

						<div class="mt-1 rounded-lg border border-bd/30 bg-s2 p-2 space-y-1 text-[10px]">
							{#if trade.avgEntryPrice.usd}
								<div class="flex items-center justify-between">
									<span class="text-g4">Entry</span>
									<span class="font-semibold text-tx">{#if entryMc}{formatMarketCap(entryMc)}{/if} <span class="text-g4">(<CurrencyValue usd={String(trade.avgEntryPrice.usd)} native={String(trade.avgEntryPrice.native)} chain={trade.chain} mode="price" iconClass="h-3 w-3" />)</span></span>
								</div>
							{/if}
							{#if 'currentPrice' in activeTrade && activeTrade.currentPrice?.usd}
								<div class="flex items-center justify-between">
									<span class="text-g4">Now</span>
									<span class="font-semibold text-tx">{#if currentMc}{formatMarketCap(currentMc)}{/if} <span class="text-g4">(<CurrencyValue usd={String(activeTrade.currentPrice.usd)} native={String(activeTrade.currentPrice.native)} chain={trade.chain} mode="price" iconClass="h-3 w-3" />)</span></span>
								</div>
							{/if}
							{#if trade.tokensRemaining > 0}
								<div class="flex items-center justify-between">
									<span class="text-g4">Holding</span>
								<span class="font-semibold text-tx">{formatNumber(String(trade.tokensRemaining))} {trade.tokenSymbol}</span>
							</div>
						{/if}
						{#if trade.totalFees.usd > 0}
							<div class="flex items-center justify-between">
								<span class="text-g4">Fees</span>
								<CurrencyValue usd={trade.totalFees.usdStr} native={trade.totalFees.nativeStr} chain={trade.chain} mode="value" class="font-semibold text-g6" iconClass="h-3 w-3" />
								</div>
							{/if}
						</div>
						{#if activeTrade.pendingSwaps?.length > 0}
							<div class="mt-1.5 flex items-center gap-1.5 rounded-md bg-yel/10 px-2 py-1">
								<div class="h-1.5 w-1.5 rounded-full bg-yel animate-pulse"></div>
								<span class="text-[10px] font-medium text-yel">{activeTrade.pendingSwaps.length} pending {activeTrade.pendingSwaps.length === 1 ? 'swap' : 'swaps'}</span>
							</div>
						{/if}

						{@const metTakeProfitTargets = metTargets(trade, 'TAKE_PROFIT')}
						{@const metStopLossTargets = metTargets(trade, 'STOP_LOSS')}
						{@const liveTakeProfitTargets = liveTargets(activeTrade, 'TAKE_PROFIT')}
						{@const liveStopLossTargets = liveTargets(activeTrade, 'STOP_LOSS')}
						{@const hasContent = metTakeProfitTargets.length > 0 || metStopLossTargets.length > 0 || liveTakeProfitTargets.length > 0 || liveStopLossTargets.length > 0 || (activeTab === 'pending' && activeTrade.pendingSwaps?.length > 0)}
							{#if hasContent}
								<div class="mt-2 flex flex-wrap gap-1.5">
								{#if metTakeProfitTargets.length > 0}
									{#each metTakeProfitTargets as met, idx}
										{@const pctSell = Math.round(met.sellPct)}
										<div class="flex items-center gap-1.5 rounded-lg bg-org/10 px-2.5 py-1.5">
											<span class="rounded bg-org/20 px-1 py-px text-[9px] font-bold uppercase text-org">filled</span>
											<span class="text-[11px] font-bold text-org">TP{idx + 1}</span>
											<span class="text-[13px] font-bold text-org line-through decoration-org/30">{targetTriggerLabel(met)}</span>
											<span class="text-[11px] text-org/50">sold {pctSell}%</span>
										</div>
									{/each}
								{/if}
								{#if metStopLossTargets.length > 0}
									{#each metStopLossTargets as met, idx}
										{@const pctSell = Math.round(met.sellPct)}
										<div class="flex items-center gap-1.5 rounded-lg bg-red/10 px-2.5 py-1.5">
											<span class="rounded bg-red/20 px-1 py-px text-[9px] font-bold uppercase text-red">filled</span>
											<span class="text-[11px] font-bold text-red">SL{idx + 1}</span>
											<span class="text-[13px] font-bold text-red line-through decoration-red/30">{targetTriggerLabel(met)}</span>
											<span class="text-[11px] text-red/50">sold {pctSell}%</span>
										</div>
									{/each}
								{/if}
								{#each liveTakeProfitTargets as target, idx}
									{@const mult = target.trigger.type === 'MULTIPLIER' ? Number(target.trigger.multiplier) : 0}
									{@const pctSell = Math.round(target.sellPct)}
									{@const targetMcVal = entryMc && target.trigger.type === 'MULTIPLIER' ? entryMc * mult : null}
									<div class="flex items-center gap-1.5 rounded-lg bg-grn/10 px-2.5 py-1.5">
										<span class="text-[11px] font-bold text-grn">TP{metTakeProfitTargets.length + idx + 1}</span>
										<span class="text-[13px] font-bold text-grn">
											{targetTriggerLabel(target)}
										</span>
										{#if targetMcVal}
											<span class="text-[10px] text-grn/40">{formatMarketCap(targetMcVal)}</span>
										{/if}
										<span class="text-[11px] text-grn/50">sell {pctSell}%</span>
									</div>
								{/each}
								{#each liveStopLossTargets as sl, idx}
									{@const slPctSell = Math.round(sl.sellPct)}
									<div class="flex items-center gap-1.5 rounded-lg bg-red/10 px-2.5 py-1.5">
										<span class="text-[11px] font-bold text-red">SL{metStopLossTargets.length + idx + 1}</span>
										<span class="text-[13px] font-bold text-red">
											{targetTriggerLabel(sl)}
										</span>
										{#if sl.mode === 'TRAILING'}<span class="text-[11px] text-red/50">trail</span>{/if}
										<span class="text-[11px] text-red/50">sell {slPctSell}%</span>
									</div>
								{/each}
								{#if activeTab === 'pending' && activeTrade.pendingSwaps?.length > 0}
									{@const pendingBuy = activeTrade.pendingSwaps.find(s => s.side === 'BUY')}
									{#if pendingBuy}
										<div class="flex items-center gap-1.5 rounded-lg bg-blu-light/8 px-2.5 py-1.5">
											<span class="text-[11px] font-bold text-blu-light">BUY</span>
											<span class="text-[13px] font-bold text-blu-light">
												{#if pendingBuy.side === 'BUY' && 'strategy' in pendingBuy && pendingBuy.strategy.type === 'DIP'}
													{pendingBuy.strategy.dipPct.toFixed(1)}% dip
												{:else if pendingBuy.side === 'BUY' && 'strategy' in pendingBuy && pendingBuy.strategy.type === 'LIMIT'}
													{formatUsd(String(pendingBuy.strategy.priceUsd))}
												{:else}
													Market
												{/if}
											</span>
										</div>
									{/if}
								{/if}
								</div>
							{/if}
					{:else if activeTab === 'history'}
						{@const completedTrade = trade as CompletedTrade}
						{@const entryMc = trade.avgEntryMcap.usd}
						{@const closeMc = completedTrade.avgClosingMcap?.usd ?? 0}

						<div class="mt-1 rounded-lg border border-bd/30 bg-s2 p-2 space-y-1 text-[10px]">
							{#if trade.avgEntryPrice.usd}
								<div class="flex items-center justify-between">
									<span class="text-g4">Entry</span>
									<span class="font-semibold text-tx">{#if entryMc}{formatMarketCap(entryMc)}{/if} <span class="text-g4">(<CurrencyValue usd={String(trade.avgEntryPrice.usd)} native={String(trade.avgEntryPrice.native)} chain={trade.chain} mode="price" iconClass="h-3 w-3" />)</span></span>
								</div>
							{/if}
							{#if completedTrade.avgClosingPrice?.usd}
								<div class="flex items-center justify-between">
									<span class="text-g4">Exit</span>
									<span class="font-semibold text-tx">{#if closeMc}{formatMarketCap(closeMc)}{/if} <span class="text-g4">(<CurrencyValue usd={String(completedTrade.avgClosingPrice.usd)} native={String(completedTrade.avgClosingPrice.native)} chain={trade.chain} mode="price" iconClass="h-3 w-3" />)</span></span>
								</div>
							{/if}
							{#if trade.totalFees.usd > 0}
								<div class="flex items-center justify-between">
									<span class="text-g4">Fees</span>
									<CurrencyValue usd={trade.totalFees.usdStr} native={trade.totalFees.nativeStr} chain={trade.chain} mode="value" class="font-semibold text-g6" iconClass="h-3 w-3" />
								</div>
							{/if}
						</div>

						{@const metTP = metTargets(trade, 'TAKE_PROFIT')}
						{@const metSL = metTargets(trade, 'STOP_LOSS')}
						{#if metTP.length > 0 || metSL.length > 0}
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each metTP as met, idx}
									<div class="flex items-center gap-1.5 rounded-lg bg-org/10 px-2.5 py-1.5">
										<span class="rounded bg-org/20 px-1 py-px text-[9px] font-bold uppercase text-org">filled</span>
										<span class="text-[11px] font-bold text-org">TP{idx + 1}</span>
										<span class="text-[13px] font-bold text-org line-through decoration-org/30">{targetTriggerLabel(met)}</span>
										<span class="text-[11px] text-org/50">sold {Math.round(met.sellPct)}%</span>
									</div>
								{/each}
								{#each metSL as met, idx}
									<div class="flex items-center gap-1.5 rounded-lg bg-red/10 px-2.5 py-1.5">
										<span class="rounded bg-red/20 px-1 py-px text-[9px] font-bold uppercase text-red">filled</span>
										<span class="text-[11px] font-bold text-red">SL{idx + 1}</span>
										<span class="text-[13px] font-bold text-red line-through decoration-red/30">{targetTriggerLabel(met)}</span>
										<span class="text-[11px] text-red/50">sold {Math.round(met.sellPct)}%</span>
									</div>
								{/each}
							</div>
						{/if}
					{/if}

						<div class="mt-2 flex items-center justify-end gap-1.5" onclick={(e) => e.stopPropagation()}>
							{#if activeTab === 'active'}
							<button onclick={() => (selectedTrade = trade)} class="btn-secondary px-3 py-1.5 text-xs">Details</button>
						<button onclick={() => openEditModal(trade as ActiveTrade)} class="btn-secondary px-3 py-1.5 text-xs">Edit</button>
							<button onclick={() => (dismissConfirmTrade = trade as ActiveTrade)} class="btn-danger-outline px-3 py-1.5 text-xs">Dismiss</button>
							<button onclick={() => openSellModal(trade as ActiveTrade)} class="btn-danger-outline px-3 py-1.5 text-xs">Sell</button>
							{:else if activeTab === 'pending'}
								<button onclick={() => (selectedTrade = trade)} class="btn-secondary px-3 py-1.5 text-xs">Details</button>
								<button
									onclick={() => abortTrade(trade.id)}
									class="cursor-pointer rounded-lg border border-yel/40 bg-yel/10 px-3 py-1.5 text-xs font-medium text-yel transition-all hover:bg-yel/20"
								>
									Cancel
								</button>
							{:else}
								<button onclick={() => (selectedTrade = trade)} class="btn-secondary px-3 py-1.5 text-xs">
									View
								</button>
							{/if}
						</div>
					</div>
					{/if}
					</div>
				{/each}
			</div>

			{#if hasMore()}
				<div class="mt-2 text-center">
					<button
						onclick={loadMore}
						disabled={isLoading()}
						class="cursor-pointer rounded-lg border border-bd bg-s4 px-4 py-1.5 text-xs text-g5 transition-all hover:border-bd3 hover:text-tx disabled:opacity-50"
					>
						{isLoading() ? 'Loading...' : 'Load More'}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if selectedTrade}
		{@const trade = selectedTrade}
		{@const detailLiveTakeProfitTargets = liveTargets(trade, 'TAKE_PROFIT')}
		{@const detailLiveStopLossTargets = liveTargets(trade, 'STOP_LOSS')}
		{@const detailHasTargets = detailLiveTakeProfitTargets.length > 0 || detailLiveStopLossTargets.length > 0}
		<div
			use:portal
			class="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-s0/60 backdrop-blur-[2px] p-3 md:p-6"
			onclick={(e) => { if (e.target === e.currentTarget) selectedTrade = null; }}
			onkeydown={(e) => { if (e.key === 'Escape') selectedTrade = null; }}
			role="dialog"
			tabindex="-1"
		>
			<div class="w-full max-w-lg rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl overflow-x-hidden">
				<div class="flex items-center justify-between border-b border-bd px-4 md:px-5 py-3 md:py-4">
					<div class="flex items-center gap-3">
						<img src={tokenImage(trade.chain, trade.tokenAddress)} alt="" class="h-9 w-9 rounded-xl ring-1 ring-bd" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
						<div>
							<div class="text-base font-bold text-tx">{trade.tokenSymbol}</div>
							<div class="flex items-center gap-1.5 text-xs text-g5">
								<ChainIcon chain={trade.chain} class="h-3.5 w-3.5 text-g7" />
								<span>{shortAddress(trade.tokenAddress)}</span>
								<span>#{trade.id}</span>
							</div>
						</div>
					</div>
					<button
						onclick={() => (selectedTrade = null)}
						class="cursor-pointer rounded-lg p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-g9"
					>
						<X class="h-5 w-5" strokeWidth={2} />
					</button>
				</div>

				<div class="grid grid-cols-2 {'currentValue' in trade && trade.currentValue ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-3 border-b border-bd px-4 md:px-5 py-3">
				<div>
					<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Bought</div>
					<CurrencyValue usd={String(trade.totalBought.usd)} native={String(trade.totalBought.native)} chain={trade.chain} mode="value" class="mt-0.5 text-sm font-bold text-tx" iconClass="h-3.5 w-3.5" />
					<div class="text-xs text-g4">{formatNumber(String(trade.totalBought.tokens))} {trade.tokenSymbol}</div>
				</div>
				<div>
					<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Sold</div>
					<CurrencyValue usd={String(trade.totalSold.usd)} native={String(trade.totalSold.native)} chain={trade.chain} mode="value" class="mt-0.5 text-sm font-bold text-tx" iconClass="h-3.5 w-3.5" />
					<div class="text-xs text-g4">{formatNumber(String(trade.totalSold.tokens))} {trade.tokenSymbol}</div>
				</div>
				{#if 'currentValue' in trade && trade.currentValue}
					<div>
						<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Value</div>
						<CurrencyValue usd={String(trade.currentValue.usd)} native={String(trade.currentValue.native)} chain={trade.chain} mode="value" class="mt-0.5 text-sm font-bold text-tx" iconClass="h-3.5 w-3.5" />
						{#if trade.pnl.multiplier}<div class="text-xs text-yel">{netPnlMultiplier(trade).toFixed(2)}x</div>{/if}
					</div>
				{/if}
				<div>
					<div class="text-[10px] font-medium uppercase tracking-wider text-g5">PnL <span class="text-g6 normal-case">(net of fees)</span></div>
					<div class="mt-0.5 text-sm font-bold {pnlColor(trade)}">
						<CurrencyValue usd={String(netPnlUsd(trade))} native={String(netPnlNative(trade))} chain={trade.chain} mode="value" iconClass="h-3.5 w-3.5" />
						{#if trade.pnl.multiplier && !('currentValue' in trade && trade.currentValue)}<span class="ml-1 text-xs text-yel">{netPnlMultiplier(trade).toFixed(2)}x</span>{/if}
					</div>
					<div class="text-xs {pnlColor(trade)}">{netPnlPct(trade).toFixed(1)}%</div>
				</div>
			</div>

				{#if detailHasTargets}
					<div class="border-b border-bd px-5 py-3">
						<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-g6">Targets</div>
						<div class="space-y-2">
							{#each detailLiveTakeProfitTargets as target, idx}
								<div class="rounded-xl border border-grn/20 bg-s2 px-3.5 py-2.5">
									<div class="flex items-center justify-between gap-3">
										<div class="flex min-w-0 items-center gap-2">
											<span class="rounded-md bg-grn/10 px-1.5 py-0.5 text-[11px] font-bold text-grn">TP{idx + 1}</span>
											<span class="text-sm font-bold text-grn">{targetTriggerLabel(target)}</span>
											<span class="text-xs text-grn/45">sell {Math.round(target.sellPct)}%</span>
										</div>
										<span class="rounded-md bg-grn/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-grn">live</span>
									</div>
								</div>
							{/each}
							{#each detailLiveStopLossTargets as target, idx}
								<div class="rounded-xl border border-red/20 bg-s2 px-3.5 py-2.5">
									<div class="flex items-center justify-between gap-3">
										<div class="flex min-w-0 items-center gap-2">
											<span class="rounded-md bg-red/10 px-1.5 py-0.5 text-[11px] font-bold text-red">SL{idx + 1}</span>
											<span class="text-sm font-bold text-red">{targetTriggerLabel(target)}</span>
											{#if target.mode === 'TRAILING'}<span class="text-xs text-red/45">trail</span>{/if}
											<span class="text-xs text-red/45">sell {Math.round(target.sellPct)}%</span>
										</div>
										<span class="rounded-md bg-red/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red">live</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="px-5 py-3">
					<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-g6">Swaps ({trade.swaps.length})</div>
					{#if trade.swaps.length === 0}
						<div class="py-4 text-center text-xs text-g4">No swaps recorded</div>
					{:else}
						<div class="max-h-64 space-y-2 overflow-y-auto">
					{#each trade.swaps as swap, i}
							<div class="rounded-xl border border-bd/40 bg-s2 px-3.5 py-2.5">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<span class="rounded-md px-1.5 py-0.5 text-[11px] font-bold {swap.side === 'BUY' ? 'bg-grn/10 text-grn' : 'bg-red/10 text-red'}">
											{swap.side}
										</span>
										<span class="rounded-md px-1.5 py-0.5 text-[10px] {swap.txHash ? 'bg-grn/10 text-grn' : 'bg-yel/10 text-yel'}">
											{swap.txHash ? 'CONFIRMED' : 'PENDING'}
										</span>
										{#if 'target' in swap && swap.target}
											{@const st = swap.target as unknown as TradeMetTarget}
											<span class="rounded-md px-1.5 py-0.5 text-[10px] font-bold {st.kind === 'TAKE_PROFIT' ? 'bg-org/10 text-org' : 'bg-red/10 text-red'}">
												{st.kind === 'TAKE_PROFIT' ? 'TP' : 'SL'} {targetTriggerLabel(st)} hit
											</span>
										{/if}
									</div>
									<span class="text-[11px] text-g4 cursor-help" title={fullDateTime(swap.timestamp)}>{timeAgo(swap.timestamp, getNow())}</span>
								</div>
								<div class="mt-2 grid grid-cols-2 gap-2 text-xs">
									<div>
										<div class="text-g5">Value</div>
										<CurrencyValue usd={String(swap.value.amount.usd)} native={String(swap.value.amount.native)} chain={trade.chain} mode="value" class="font-medium text-tx" iconClass="h-3 w-3" />
									</div>
									{#if swap.value.amountToken}
										<div>
											<div class="text-g5">Tokens</div>
											<div class="font-medium text-tx">{formatNumber(String(swap.value.amountToken))} {trade.tokenSymbol}</div>
										</div>
									{/if}
								</div>
								{#if swap.txHash}
									<div class="mt-2 flex items-center justify-between border-t border-bd/30 pt-2">
										<span class="text-[11px] text-g4">{shortAddress(swap.txHash)}</span>
										<a
											href={explorerTxUrl(trade.chain, swap.txHash)}
											target="_blank"
											rel="noopener"
											class="flex items-center gap-1 rounded-md bg-wh/5 px-2 py-1 text-[11px] font-medium text-g7 transition-all hover:bg-wh/10 hover:text-grn"
										>
											View on {trade.chain === 'SOL' ? 'Solscan' : trade.chain === 'ETH' ? 'Etherscan' : trade.chain === 'BASE' ? 'Basescan' : 'Explorer'}
											<ExternalLink class="h-3 w-3" strokeWidth={2} />
										</a>
									</div>
								{/if}
							</div>
						{/each}
						</div>
					{/if}
				</div>

				<div class="flex items-center justify-between border-t border-bd px-5 py-3">
					<button class="btn-secondary px-3.5 py-2 text-xs" onclick={() => { const c = trade.chain; const a = trade.tokenAddress; selectedTrade = null; goto(`/?chain=${c}&token=${a}`); onnavigate(); }}>View Token</button>
					<div class="flex items-center gap-2">
						{#if trade.status === 'ACTIVE'}
							<button onclick={() => sellAll(trade as ActiveTrade)} disabled={sellingTradeId === trade.id} class="btn-danger-outline px-4 py-2 text-xs">{sellingTradeId === trade.id ? 'Selling...' : 'Sell All'}</button>
						{/if}
						<button onclick={() => { selectedTrade = null; onnavigate(); }} class="btn-secondary px-3.5 py-2 text-xs">Close</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if editingTrade}
		{@const eTrade = editingTrade}
		<div
			use:portal
			class="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-s0/60 backdrop-blur-[2px] p-3 md:p-6"
			onclick={(e) => { if (e.target === e.currentTarget) editingTrade = null; }}
			onkeydown={(e) => { if (e.key === 'Escape') editingTrade = null; }}
			role="dialog"
			tabindex="-1"
		>
			<div class="w-full max-w-lg rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl overflow-x-hidden">
				<div class="flex items-center justify-between border-b border-bd px-4 md:px-5 py-3 md:py-4">
				<div class="flex items-center gap-3">
					<img src={tokenImage(eTrade.chain, eTrade.tokenAddress)} alt="" class="h-9 w-9 rounded-xl ring-1 ring-bd" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
					<div>
						<div class="text-base font-bold text-tx">Edit Position</div>
						<div class="text-xs text-g5">{eTrade.tokenSymbol} · #{eTrade.id}</div>
						</div>
					</div>
					<button
						onclick={() => (editingTrade = null)}
						class="cursor-pointer rounded-lg p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-g9"
					>
						<X class="h-5 w-5" strokeWidth={2} />
					</button>
				</div>

				<div class="max-h-[60vh] overflow-y-auto px-5 py-4">
					<div class="mb-4">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-xs font-semibold uppercase tracking-wider text-g8">Targets</span>
							<div class="flex items-center gap-1">
								<button
									onclick={() => addEditTarget('TAKE_PROFIT')}
									class="cursor-pointer rounded-lg bg-grn/10 px-2.5 py-1 text-[11px] font-semibold text-grn transition-all hover:bg-grn/20"
								>
									+ TP
								</button>
								<button
									onclick={() => addEditTarget('STOP_LOSS')}
									class="cursor-pointer rounded-lg bg-red/10 px-2.5 py-1 text-[11px] font-semibold text-red transition-all hover:bg-red/20"
								>
									+ SL
								</button>
								<button
									onclick={() => addEditTarget('STOP_LOSS', 'TRAILING')}
									class="cursor-pointer rounded-lg bg-red/10 px-2.5 py-1 text-[11px] font-semibold text-red transition-all hover:bg-red/20"
								>
									+ Trailing SL
								</button>
							</div>
						</div>
						{#if editTargets.length === 0}
							<div class="flex items-center justify-center rounded-lg border border-dashed border-bd/50 py-6 text-xs text-g4">
								No targets configured
							</div>
						{:else}
							<div class="grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto">
								{#each editTargets as target, i}
									<TargetCard
										target={{ kind: target.type as SellTargetKind, triggerValue: target.trigger, sellPercent: target.sellPct, targetKind: target.targetKind, mode: target.mode }}
										onupdate={(t) => { editTargets[i] = { ...editTargets[i], type: t.kind, trigger: t.triggerValue, sellPct: t.sellPercent, targetKind: t.targetKind, mode: t.mode }; }}
										onremove={() => removeEditTarget(i)}
									/>
								{/each}
							</div>
						{/if}
					</div>

					<div class="mt-4">
						<span class="text-xs font-semibold uppercase tracking-wider text-g8">Sell Settings</span>
						<div class="mt-2 rounded-xl border border-bd bg-s2 p-3">
							<div class="flex items-center gap-2">
								<div class="flex-1">
									<div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-g5">Slippage</div>
									<div class="relative">
										<input
											type="text"
											bind:value={editSellSlippage}
											placeholder="Auto"
											class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none focus:border-grn/40"
										/>
										<span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-g4">%</span>
									</div>
								</div>
								<div class="flex-1">
									<div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-g5">Gas Price</div>
									<select
										bind:value={editSellGasPriceType}
										class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none focus:border-grn/40"
									>
									<option value="AUTO">Auto</option>
									<option value="LOW">Low</option>
									<option value="MEDIUM">Medium</option>
									<option value="HIGH">High</option>
									</select>
								</div>
							</div>
						</div>
					</div>

					{#if editError}
						<div class="mt-3 rounded-lg bg-red/10 px-3 py-2 text-xs text-red">{editError}</div>
					{/if}
				</div>

				<div class="flex items-center justify-end gap-2 border-t border-bd px-5 py-3">
					<button onclick={() => (editingTrade = null)} class="btn-secondary px-4 py-2 text-xs">Cancel</button>
					<button onclick={savePositionEdit} disabled={editSaving} class="btn-primary px-4 py-2 text-xs">{editSaving ? 'Saving...' : 'Save Changes'}</button>
				</div>
			</div>
		</div>
	{/if}

	{#if sellModalTrade}
		{@const st = getActivePositions().find((t) => t.id === sellModalTrade!.id) ?? sellModalTrade}
		{@const remaining = st.tokensRemaining ? formatNumber(String(st.tokensRemaining)) : '—'}
		{@const value = st.currentValue ? formatUsd(String(st.currentValue.usd * sellPct / 100)) : null}
		<div use:portal class="fixed inset-0 z-[300] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" onclick={(e) => { if (e.target === e.currentTarget) sellModalTrade = null; }} onkeydown={(e) => { if (e.key === 'Escape') sellModalTrade = null; }} role="presentation">
			<div class="mx-4 w-full max-w-sm rounded-2xl border border-red/20 bg-s5 p-4 md:p-6 shadow-2xl backdrop-blur-xl" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={() => {}}>
				<div class="mb-5 flex items-center justify-between">
					<div class="flex items-center gap-3">
					<img src={tokenImage(st.chain, st.tokenAddress)} alt="" class="h-9 w-9 rounded-lg ring-1 ring-bd" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
					<div>
						<div class="text-sm font-bold text-tx">Sell {st.tokenSymbol}</div>
							<div class="text-xs text-g5">{remaining} tokens remaining</div>
						</div>
					</div>
					<button onclick={() => (sellModalTrade = null)} class="cursor-pointer rounded-lg p-1.5 text-g5 transition-colors hover:bg-s7 hover:text-tx">
						<X class="h-4 w-4" />
					</button>
				</div>
				<div class="mb-3 text-xs font-medium text-g7">Percent to sell</div>
				<div class="mb-4 flex gap-2">
					{#each [10, 25, 50, 75, 100] as pct}
						<button
						onclick={() => (sellPct = pct)}
						class="flex-1 cursor-pointer rounded-lg border py-2.5 text-sm font-bold transition-all {sellPct === pct ? 'border-red bg-red/20 text-red' : 'border-bd bg-s4 text-g7 hover:text-tx'}"
						>
							{pct}%
						</button>
					{/each}
				</div>
				<div class="mb-5 flex items-center gap-2 rounded-lg border border-bd bg-s4 px-3 py-2.5">
					<input
						type="number"
						min="1"
						max="100"
						bind:value={sellPct}
						class="w-full bg-transparent text-lg font-bold text-tx outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
					/>
					<span class="shrink-0 text-sm text-g5">%</span>
					{#if value}
						<span class="shrink-0 text-sm font-medium text-g7">≈ {value}</span>
					{/if}
				</div>
				<button onclick={confirmSell} disabled={sellExecuting || sellPct < 1 || sellPct > 100} class="btn-danger w-full py-3 text-sm">{sellExecuting ? 'Selling...' : `Sell ${sellPct}%`}</button>
			</div>
		</div>
	{/if}
	{#if dismissConfirmTrade}
		<div use:portal class="fixed inset-0 z-[300] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" onclick={(e) => { if (e.target === e.currentTarget) dismissConfirmTrade = null; }} onkeydown={(e) => { if (e.key === 'Escape') dismissConfirmTrade = null; }} role="presentation">
			<div class="w-full max-w-sm mx-3 md:mx-0 rounded-2xl border border-red/20 bg-s5 p-4 md:p-6 shadow-2xl backdrop-blur-xl" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={() => {}}>
				<div class="mb-4 flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-red/10">
						<AlertTriangle class="h-5 w-5 text-red" strokeWidth={2} />
					</div>
					<div>
					<div class="text-sm font-bold text-tx">Dismiss Position</div>
					<div class="flex items-center gap-1 text-xs text-g6">{dismissConfirmTrade.tokenSymbol} on <ChainIcon chain={dismissConfirmTrade.chain} class="h-3 w-3 text-g6" /></div>
					</div>
				</div>
				<p class="mb-5 text-xs leading-relaxed text-g8">This will cancel the position and remove it from the trading engine. Any pending orders (buy dips, sell targets, stop losses) will be cancelled. This action cannot be undone.</p>
				<div class="flex items-center justify-end gap-2">
					<button onclick={() => (dismissConfirmTrade = null)} class="btn-secondary px-4 py-2 text-xs">Cancel</button>
					<button
						onclick={async () => {
							if (!dismissConfirmTrade) return;
							dismissing = true;
							await dismissTrade(dismissConfirmTrade.id);
							dismissing = false;
							dismissConfirmTrade = null;
						}}
						disabled={dismissing}
						class="btn-danger px-4 py-2 text-xs"
					>
						{dismissing ? 'Dismissing...' : 'Dismiss Position'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

{#snippet tradeBadge(trade: ActiveTrade | CompletedTrade)}
	{@const sources = tradeSources(trade)}
	{#if sources.length > 0}
		<div class="mt-1.5 flex flex-wrap items-center gap-1">
			{#each sources as src}
				<span class="flex items-center gap-1 rounded bg-grn/10 px-2 py-1 text-[10px] font-medium text-grn" title={src.sourceName || 'Bot'}>
					{#if src.sourceType === 'TG'}
						<MessageCircle class="h-3 w-3" strokeWidth={1.5} />
					{:else if src.sourceType === 'WALLET'}
						<Wallet class="h-3 w-3" strokeWidth={1.5} />
					{:else if src.sourceType === 'LIST'}
						<ListIcon class="h-3 w-3" strokeWidth={1.5} />
					{:else if src.sourceType === 'CALLER'}
						<Megaphone class="h-3 w-3" strokeWidth={1.5} />
					{:else}
						<BotIcon class="h-3 w-3" strokeWidth={1.5} />
					{/if}
					{#if src.sourceName}
						<span class="truncate">{src.sourceName}</span>
					{/if}
				</span>
			{/each}
		</div>
	{/if}
{/snippet}

{#if PnlShareCard}
	<PnlShareCard bind:show={showShareCard} trade={shareTrade} />
{/if}
