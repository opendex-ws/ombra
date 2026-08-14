<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import type { TokenTimeRange, TraderOverview, TraderTokenPnlItem, TraderTokenPnlResponse, TraderTokenPositionStatus, TraderTokenSwapEntry, TraderTokenSwapsResponse, WalletTimeRange } from '$lib/api/types';
	import { portal } from '$lib/actions/portal';
	import { closeTraderPortfolio, getTraderPortfolioTarget } from '$lib/stores/traderAnalytics.svelte';
	import { ageFromSeconds, explorerAddressUrl, fmtVal, formatNumber, formatPercent, formatUsd, shortAddress } from '$lib/utils/format';
	import TraderPositionTable from './TraderPositionTable.svelte';
	import TraderSwapTable from './TraderSwapTable.svelte';
	import { TOKEN_TIME_RANGE_OPTIONS, WALLET_TIME_RANGE_OPTIONS, valueColorClass, walletTimeRangeLabel } from './config';
	import Copy from 'lucide-svelte/icons/copy';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import UserPlus from 'lucide-svelte/icons/user-plus';

	import X from 'lucide-svelte/icons/x';
	import CalendarDays from 'lucide-svelte/icons/calendar-days';
	import ChartLine from 'lucide-svelte/icons/chart-line';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import type { ErrorResponse } from '$lib/api/types';
	import PnlMonthsCalendar from '../PnlMonthsCalendar.svelte';
	import ChainIcon from '../ChainIcon.svelte';
	import WalletIcon from '../WalletIcon.svelte';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import WalletFundingPanel from '../WalletFundingPanel.svelte';
	import WalletTransferTimeline from '../WalletTransferTimeline.svelte';

	let ctAdding = $state(false);
	let ctDone = $state(false);


	async function addCopyTrade(walletChain: string, walletAddress: string) {
		if (ctAdding || ctDone) return;
		ctAdding = true;
		try {
			const name = overview?.labels?.[0]?.label ?? shortAddress(walletAddress);
			const { error } = await api.POST('/v2/watchlist/manage/wallets/create', {
				body: { name, chain: walletChain as any, walletAddress }
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed');
			ctDone = true;
		} catch {}
		ctAdding = false;
	}

	type PortfolioTab = TraderTokenPositionStatus | 'ACTIVITY';
	type PagedState<T> = {
		items: T[];
		cursor?: string;
		nextCursor?: string;
		loading: boolean;
		loadingMore: boolean;
		error: string;
		loadedKey: string;
		paginated?: boolean;
	};
	const activitySwapKey = (s: { txHash: string; token: { address: string }; side: string; amountTokenStr: string }) => `${s.txHash}:${s.token.address}:${s.side}:${s.amountTokenStr}`;
	const MAX_ACTIVITY = 1000;
	function emptyPagedState<T>(): PagedState<T> {
		return { items: [], loading: false, loadingMore: false, error: '', loadedKey: '' };
	}

	let overviewTimeRange: WalletTimeRange = $state('ONE_DAY');
	let pnlView = $state<'calendar' | 'chart'>('chart');
	let tokenTimeRange: TokenTimeRange = $state('ONE_DAY');
	let activeTab: PortfolioTab = $state('ACTIVE');
	let overview: TraderOverview | null = $state(null);
	let overviewLoading = $state(false);
	let overviewError = $state('');
	let positionStates = $state<Record<TraderTokenPositionStatus, PagedState<TraderTokenPnlItem>>>({
		ACTIVE: emptyPagedState(),
		PAUSED: emptyPagedState()
	});
	let activity = $state<PagedState<TraderTokenSwapEntry>>(emptyPagedState());
	let overviewGeneration = 0;
	let positionGenerations: Record<TraderTokenPositionStatus, number> = { ACTIVE: 0, PAUSED: 0 };
	let activityGeneration = 0;
	let dialogElement: HTMLDivElement = $state(null!);
	let overviewWsKey: string | null = null;
	let positionsWsKey: string | null = null;
	let activityWsKey: string | null = null;

	let target = $derived(getTraderPortfolioTarget());

	const tabs: { value: PortfolioTab; label: string }[] = [
		{ value: 'ACTIVE', label: 'Active' },
		{ value: 'PAUSED', label: 'Paused' },
		{ value: 'ACTIVITY', label: 'Activity' }
	];

	function getPositionState(status: TraderTokenPositionStatus): PagedState<TraderTokenPnlItem> {
		return positionStates[status];
	}

	function setPositionState(status: TraderTokenPositionStatus, state: PagedState<TraderTokenPnlItem>) {
		positionStates = { ...positionStates, [status]: state };
	}

	function positionKey(nextTarget: NonNullable<typeof target>, status: TraderTokenPositionStatus, range: TokenTimeRange): string {
		return `${nextTarget.chain}:${nextTarget.walletAddress}:${status}:${range}`;
	}

	function activityKey(nextTarget: NonNullable<typeof target>): string {
		return `${nextTarget.chain}:${nextTarget.walletAddress}:activity`;
	}

	function cleanupOverviewWs() {
		if (!overviewWsKey) return;
		unsubscribe(overviewWsKey);
		overviewWsKey = null;
	}

	function cleanupPositionsWs() {
		if (!positionsWsKey) return;
		unsubscribe(positionsWsKey);
		positionsWsKey = null;
	}

	function cleanupActivityWs() {
		if (!activityWsKey) return;
		unsubscribe(activityWsKey);
		activityWsKey = null;
	}

	function cleanupWs() {
		cleanupOverviewWs();
		cleanupPositionsWs();
		cleanupActivityWs();
	}

	function isCurrentTarget(nextTarget: NonNullable<typeof target>): boolean {
		return target?.chain === nextTarget.chain && target.walletAddress === nextTarget.walletAddress;
	}

	function setupOverviewWs(nextTarget: NonNullable<typeof target>, range: WalletTimeRange, generation: number) {
		cleanupOverviewWs();
		const topic = `traders:${nextTarget.chain}:${nextTarget.walletAddress}:overview`;
		overviewWsKey = subscribe(topic, (event, data, eventTopic) => {
			if (event !== 'TRADER_OVERVIEW' || eventTopic !== topic || generation !== overviewGeneration) return;
			if (!isCurrentTarget(nextTarget) || overviewTimeRange !== range) return;
			overview = data as TraderOverview;
		}, { timeRange: range });
	}

	function setupPositionsWs(
		nextTarget: NonNullable<typeof target>,
		status: TraderTokenPositionStatus,
		range: TokenTimeRange,
		generation: number,
		endCursor: string
	) {
		cleanupPositionsWs();
		const topic = `traders:${nextTarget.chain}:${nextTarget.walletAddress}:tokens`;
		positionsWsKey = subscribe(topic, (event, data, eventTopic) => {
			if (event !== 'TRADER_TOKEN_PNL' || eventTopic !== topic || generation !== positionGenerations[status]) return;
			if (!isCurrentTarget(nextTarget) || activeTab !== status || tokenTimeRange !== range) return;
			const snapshot = data as TraderTokenPnlResponse;
			setPositionState(status, { ...getPositionState(status), items: snapshot.items, cursor: snapshot.cursor, nextCursor: snapshot.nextCursor });
		}, { timeRange: range, status, endCursor }, {
			recovery: 'refetch',
			onReconnect: () => { void loadPositions(nextTarget, status, range, true, { soft: true }); }
		});
	}

	function setupActivityWs(nextTarget: NonNullable<typeof target>, generation: number, endCursor: string) {
		cleanupActivityWs();
		const topic = `traders:${nextTarget.chain}:${nextTarget.walletAddress}:swaps`;
		activityWsKey = subscribe(topic, (event, data, eventTopic) => {
			if (event !== 'TRADER_SWAPS' || eventTopic !== topic || generation !== activityGeneration) return;
			if (!isCurrentTarget(nextTarget) || activeTab !== 'ACTIVITY') return;
			const snapshot = data as TraderTokenSwapsResponse;
			if (activity.paginated) {
				const seen = new Set(activity.items.map(activitySwapKey));
				const fresh = snapshot.swaps.filter((s) => !seen.has(activitySwapKey(s)));
				if (fresh.length > 0) activity = { ...activity, items: [...fresh, ...activity.items].slice(0, MAX_ACTIVITY) };
			} else {
				activity = { ...activity, items: snapshot.swaps, cursor: snapshot.cursor, nextCursor: snapshot.nextCursor };
			}
		}, { endCursor }, {
			recovery: 'refetch',
			onReconnect: () => { void loadActivity(nextTarget, true, { soft: true }); }
		});
	}

	async function copyAddress() {
		if (target && navigator.clipboard) await navigator.clipboard.writeText(target.walletAddress);
	}

	async function loadOverview(nextTarget: NonNullable<typeof target>, range: WalletTimeRange) {
		cleanupOverviewWs();
		const generation = ++overviewGeneration;
		overviewLoading = true;
		overviewError = '';
		try {
			const { data, error } = await api.GET('/v2/traders/{chain}/{walletAddress}', {
				params: { path: { chain: nextTarget.chain, walletAddress: nextTarget.walletAddress }, query: { timeRange: range } }
			});
			if (generation !== overviewGeneration) return;
			if (error || !data) throw new Error('Unable to load this wallet overview.');
			overview = data;
			setupOverviewWs(nextTarget, range, generation);
		} catch (cause) {
			if (generation !== overviewGeneration) return;
			overview = null;
			overviewError = cause instanceof Error ? cause.message : 'Unable to load wallet overview.';
		} finally {
			if (generation === overviewGeneration) overviewLoading = false;
		}
	}

	async function loadPositions(nextTarget: NonNullable<typeof target>, status: TraderTokenPositionStatus, range: TokenTimeRange, reset: boolean, opts?: { soft?: boolean }) {
		const current = getPositionState(status);
		if (!reset && (!current.nextCursor || current.loadingMore)) return;
		cleanupPositionsWs();
		const key = positionKey(nextTarget, status, range);
		const generation = ++positionGenerations[status];
		const keepVisible = !!(reset && opts?.soft && current.items.length > 0);
		setPositionState(status, {
			...current,
			loading: reset && !keepVisible,
			loadingMore: !reset,
			error: '',
			...(reset && !keepVisible ? { items: [], cursor: undefined, nextCursor: undefined } : reset ? { cursor: undefined, nextCursor: undefined } : {})
		});
		try {
			const { data, error } = await api.GET('/v2/traders/{chain}/{walletAddress}/tokens', {
				params: {
					path: { chain: nextTarget.chain, walletAddress: nextTarget.walletAddress },
					query: { timeRange: range, status, cursor: reset ? undefined : current.nextCursor }
				}
			});
			const isCurrent = generation === positionGenerations[status];
			if (!isCurrent) return;
			if (error || !data) throw new Error(`Unable to load ${status.toLowerCase()} positions.`);
			const latest = getPositionState(status);
			setPositionState(status, {
				items: reset ? data.items : [...latest.items, ...data.items],
				cursor: data.cursor,
				nextCursor: data.nextCursor,
				loading: false,
				loadingMore: false,
				error: '',
				loadedKey: key
			});
			if (isCurrentTarget(nextTarget) && activeTab === status && tokenTimeRange === range) {
				setupPositionsWs(nextTarget, status, range, generation, data.cursor);
			}
		} catch (cause) {
			const isCurrent = generation === positionGenerations[status];
			if (!isCurrent) return;
			const latest = getPositionState(status);
			setPositionState(status, { ...latest, loading: false, loadingMore: false, error: cause instanceof Error ? cause.message : 'Unable to load positions.', loadedKey: reset ? key : latest.loadedKey });
		}
	}

	async function loadActivity(nextTarget: NonNullable<typeof target>, reset: boolean, opts?: { soft?: boolean }) {
		if (!reset && (!activity.nextCursor || activity.loadingMore)) return;
		// Only tear down / re-generate the live WS on a fresh (reset) load; load-more
		// keeps the head subscription alive so new swaps still merge in.
		if (reset) cleanupActivityWs();
		const key = activityKey(nextTarget);
		const generation = reset ? ++activityGeneration : activityGeneration;
		const current = activity;
		const keepVisible = !!(reset && opts?.soft && current.items.length > 0);
		activity = {
			...current,
			loading: reset && !keepVisible,
			loadingMore: !reset,
			error: '',
			...(reset && !keepVisible ? { items: [], cursor: undefined, nextCursor: undefined } : reset ? { cursor: undefined, nextCursor: undefined } : {})
		};
		try {
			const { data, error } = await api.GET('/v2/traders/{chain}/{walletAddress}/swaps', {
				params: { path: { chain: nextTarget.chain, walletAddress: nextTarget.walletAddress }, query: { cursor: reset ? undefined : current.nextCursor } }
			});
			if (generation !== activityGeneration) return;
			if (error || !data) throw new Error('Unable to load wallet activity.');
			const mergedItems = reset ? data.swaps : [...activity.items, ...data.swaps].slice(0, MAX_ACTIVITY);
			activity = {
				items: mergedItems,
				cursor: data.cursor,
				nextCursor: reset || mergedItems.length < MAX_ACTIVITY ? data.nextCursor : undefined,
				loading: false,
				loadingMore: false,
				error: '',
				loadedKey: key,
				paginated: reset ? false : true
			};
			if (reset && isCurrentTarget(nextTarget) && activeTab === 'ACTIVITY') {
				setupActivityWs(nextTarget, generation, data.cursor);
			}
		} catch (cause) {
			if (generation !== activityGeneration) return;
			activity = { ...activity, loading: false, loadingMore: false, error: cause instanceof Error ? cause.message : 'Unable to load wallet activity.', loadedKey: reset ? key : activity.loadedKey };
		}
	}

	function refreshCurrent() {
		if (!target) return;
		void loadOverview(target, overviewTimeRange);
		if (activeTab === 'ACTIVITY') void loadActivity(target, true);
		else void loadPositions(target, activeTab, tokenTimeRange, true);
	}

	$effect(() => {
		const nextTarget = target;
		if (!nextTarget) {
			overviewGeneration++;
			positionGenerations.ACTIVE++;
			positionGenerations.PAUSED++;
			activityGeneration++;
			cleanupWs();
			return;
		}
		untrack(() => {
			cleanupWs();
			overviewTimeRange = 'ONE_DAY';
			tokenTimeRange = 'ONE_DAY';
			activeTab = 'ACTIVE';
			overview = null;
			positionStates = { ACTIVE: emptyPagedState(), PAUSED: emptyPagedState() };
			activity = emptyPagedState();
			ctDone = false;
		});
	});

	$effect(() => {
		if (!target) return;
		untrack(() => void tick().then(() => dialogElement?.focus()));
	});

	$effect(() => {
		const nextTarget = target;
		const range = overviewTimeRange;
		if (nextTarget) untrack(() => void loadOverview(nextTarget, range));
	});

	$effect(() => {
		const nextTarget = target;
		const tab = activeTab;
		const range = tokenTimeRange;
		if (!nextTarget) return;
		untrack(() => {
			if (tab === 'ACTIVITY') {
				cleanupPositionsWs();
				if (activity.loadedKey !== activityKey(nextTarget)) void loadActivity(nextTarget, true);
				else if (activity.cursor !== undefined) setupActivityWs(nextTarget, activityGeneration, activity.cursor);
			} else {
				cleanupActivityWs();
				const state = getPositionState(tab);
				if (state.loadedKey !== positionKey(nextTarget, tab, range)) void loadPositions(nextTarget, tab, range, true);
				else if (state.cursor !== undefined) setupPositionsWs(nextTarget, tab, range, positionGenerations[tab], state.cursor);
			}
		});
	});

	onDestroy(() => {
		cleanupWs();
	});
</script>

{#if target}
	<div
		use:portal
		class="fixed inset-0 z-[210] flex items-end justify-center bg-s0/60 backdrop-blur-[2px] md:items-center md:p-4"
		role="presentation"
		onclick={closeTraderPortfolio}
		onkeydown={(event) => { if (event.key === 'Escape') closeTraderPortfolio(); }}
	>
		<div
			bind:this={dialogElement}
			class="flex h-[100dvh] w-full flex-col bg-s5 shadow-2xl md:h-[90dvh] md:max-w-[78rem] md:rounded-2xl md:border md:border-bd md:backdrop-blur-xl"
			role="dialog"
			aria-modal="true"
			aria-label="Trader portfolio"
			tabindex="-1"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => {
				event.stopPropagation();
				if (event.key === 'Escape') closeTraderPortfolio();
			}}
		>
			<div class="flex shrink-0 items-center gap-3 border-b border-bd px-3 py-3 md:px-5">
				<WalletIcon address={target.walletAddress} photoId={overview?.labels?.[0]?.photoId} size={36} class="h-9 w-9 rounded-xl" />
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2"><h2 class="truncate text-sm font-bold text-tx md:text-base">Trader portfolio</h2><ChainIcon chain={target.chain} class="h-3.5 w-3.5 text-g6" /></div>
					<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-g5">
						{#if (overview?.labels ?? []).length > 0}
							<span class="truncate font-medium text-tx">{overview!.labels![0].label}</span>
							<span class="shrink-0 rounded bg-s7 px-1.5 py-px font-mono text-[10px] text-g7">{shortAddress(target.walletAddress)}</span>
						{:else}
							<span class="truncate font-mono">{shortAddress(target.walletAddress)}</span>
						{/if}
						<button type="button" class="cursor-pointer p-0.5 transition-colors hover:text-tx" onclick={copyAddress} aria-label="Copy wallet address"><Copy class="h-3 w-3" /></button>
						<a href={explorerAddressUrl(target.chain, target.walletAddress)} target="_blank" rel="noopener" class="p-0.5 transition-colors hover:text-tx" aria-label="Open wallet in explorer"><ExternalLink class="h-3 w-3" /></a>
					</div>
				</div>
				{#if getIsLoggedIn() && target}
					<button
						type="button"
						disabled={ctAdding || ctDone}
						class="btn-primary px-2.5 py-1 text-[10px]"
						onclick={() => addCopyTrade(target!.chain, target!.walletAddress)}
						aria-label="Copy trade this wallet"
					>
						{#if ctAdding}Adding...{:else if ctDone}Added{:else}<span class="flex items-center gap-1"><UserPlus class="h-3 w-3" /> Copy Trade</span>{/if}
					</button>
				{/if}
				<button type="button" class="cursor-pointer p-1.5 text-g4 transition-colors hover:text-tx" onclick={refreshCurrent} aria-label="Refresh portfolio"><RefreshCw class="h-4 w-4 {overviewLoading ? 'animate-spin' : ''}" /></button>
				<button type="button" class="cursor-pointer text-g4 transition-colors hover:text-tx" onclick={closeTraderPortfolio} aria-label="Close"><X class="h-4 w-4" /></button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
				<WalletFundingPanel chain={target.chain} walletAddress={target.walletAddress} />
				<WalletTransferTimeline chain={target.chain} walletAddress={target.walletAddress} />

				<div class="mb-3 flex items-center gap-2">
					<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Performance</div>
					<div class="ml-auto flex gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
						{#each WALLET_TIME_RANGE_OPTIONS as range}<button type="button" class="cursor-pointer rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors {overviewTimeRange === range.value ? 'border border-tx text-tx' : 'border border-transparent text-g5 hover:text-g9'}" onclick={() => (overviewTimeRange = range.value)}>{range.label}</button>{/each}
					</div>
				</div>

				{#if overviewLoading && !overview}
					<div class="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">{#each Array(8) as _}<div class="skeleton h-16 rounded-xl"></div>{/each}</div>
				{:else if overviewError}
					<div class="rounded-xl border border-red/20 bg-s1 p-4 text-center text-xs text-red">{overviewError}</div>
				{:else if overview}
					<div class="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
						{@render metric('PnL', formatUsd(overview.stats.pnlUsdStr), walletTimeRangeLabel(overview.timeRange), valueColorClass(overview.stats.pnlUsd))}
						{@render metric('Win rate', formatPercent(overview.stats.winRatePct), `${formatNumber(overview.stats.tradeCount)} trades`, 'text-tx')}
						{@render metric('Buys', formatNumber(overview.stats.buyCount), `${formatNumber(overview.stats.uniqueTokensBought)} tokens`, 'text-grn')}
						{@render metric('Sells', formatNumber(overview.stats.sellCount), 'Executed sells', 'text-red')}
						{@render metric('Cost', formatUsd(overview.stats.totalCostUsdStr), 'Total invested', 'text-tx')}
						{@render metric('Fees', formatUsd(overview.stats.totalFeesUsdStr), 'Total fees', 'text-g8')}
						{@render metric('Balance', fmtVal(overview.walletBalanceUsdStr, overview.walletBalanceNativeStr, overview.chain), 'Current wallet', 'text-tx')}
						{@render metric('Latest swap', ageFromSeconds(overview.latestSwapAgeSeconds), overview.latestSwapTimestampStr, 'text-tx')}
					</div>
					{#if overview.pnlSparkline?.pnlUsd?.length > 1}
						<div class="mt-3">
							{#if pnlView === 'calendar'}
								<PnlMonthsCalendar sparkline={overview.pnlSparkline} numDays={90} actions={pnlViewToggle} />
							{:else}
								{@const pts = overview.pnlSparkline.pnlUsd}
								{@const min = Math.min(...pts)}
								{@const max = Math.max(...pts)}
								{@const range = max - min || 1}
								{@const W = 800}
								{@const H = 56}
								{@const lastVal = pts[pts.length - 1]}
								{@const lineColor = lastVal >= 0 ? 'var(--t-grn)' : 'var(--t-red)'}
								{@const polyPts = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - min) / range) * H}`)}
								{@const zeroY = H - ((0 - min) / range) * H}
								<div class="rounded-xl border border-bd bg-s1 p-3">
									<div class="mb-1.5 flex items-center justify-between">
										<span class="text-[9px] font-medium uppercase tracking-wider text-g5">Cumulative PnL</span>
										<div class="flex items-center gap-2">
											<span class="text-xs font-bold {lastVal >= 0 ? 'text-grn' : 'text-red'}">{lastVal >= 0 ? '+' : ''}{formatUsd(lastVal)}</span>
											{@render pnlViewToggle()}
										</div>
									</div>
									<svg viewBox="0 0 {W} {H}" class="h-52 w-full md:h-56" preserveAspectRatio="none">
										{#if min < 0 && max > 0}
											<line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="var(--t-g1)" stroke-width="1" stroke-dasharray="4,4" />
										{/if}
										<defs>
											<linearGradient id="portfolio-pnl-fill" x1="0" y1="0" x2="0" y2="1">
												<stop offset="0%" stop-color={lineColor} stop-opacity="0.2" />
												<stop offset="100%" stop-color={lineColor} stop-opacity="0" />
											</linearGradient>
										</defs>
										<polygon points="{polyPts.join(' ')} {W},{H} 0,{H}" fill="url(#portfolio-pnl-fill)" />
										<polyline points={polyPts.join(' ')} fill="none" stroke={lineColor} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
									</svg>
								</div>
							{/if}
						</div>
					{/if}
				{/if}

				<div class="mt-5 flex flex-wrap items-center gap-2 border-b border-bd">
					{#each tabs as tab}
						<button type="button" class="cursor-pointer border-b-2 px-3 py-2 text-xs font-medium transition-colors {activeTab === tab.value ? 'border-grn text-tx' : 'border-transparent text-g5 hover:text-g9'}" onclick={() => (activeTab = tab.value)}>{tab.label}</button>
					{/each}
					{#if activeTab !== 'ACTIVITY'}
						<div class="ml-auto mb-1 flex gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
							{#each TOKEN_TIME_RANGE_OPTIONS as range}<button type="button" class="cursor-pointer rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors {tokenTimeRange === range.value ? 'border border-tx text-tx' : 'border border-transparent text-g5 hover:text-g9'}" onclick={() => (tokenTimeRange = range.value)}>{range.label}</button>{/each}
						</div>
					{/if}
				</div>

				<div class="mt-3">
					{#if activeTab === 'ACTIVITY'}
						{@render activityContent()}
					{:else}
						{@render positionsContent(activeTab)}
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}



{#snippet pnlViewToggle()}
	<div class="flex gap-0.5 rounded-md bg-s4 p-0.5">
		<button
			type="button"
			class="cursor-pointer rounded p-0.5 transition-colors {pnlView === 'chart' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
			onclick={() => (pnlView = 'chart')}
			title="Cumulative PnL chart"
		>
			<ChartLine class="h-3 w-3" />
		</button>
		<button
			type="button"
			class="cursor-pointer rounded p-0.5 transition-colors {pnlView === 'calendar' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
			onclick={() => (pnlView = 'calendar')}
			title="Daily PnL calendar"
		>
			<CalendarDays class="h-3 w-3" />
		</button>
	</div>
{/snippet}

{#snippet metric(label: string, value: string, secondary: string, color: string)}
	<div class="min-w-0 rounded-xl border border-bd bg-s1 p-2.5">
		<div class="text-[9px] font-medium uppercase tracking-wider text-g5">{label}</div>
		<div class="mt-1 truncate text-sm font-bold {color}">{value}</div>
		<div class="mt-0.5 truncate text-[9px] text-g5" title={secondary}>{secondary}</div>
	</div>
{/snippet}

{#snippet positionsContent(status: TraderTokenPositionStatus)}
	{@const state = getPositionState(status)}
	{#if state.loading}
		<div class="flex h-48 items-center justify-center rounded-xl border border-bd bg-s1 text-g5"><LoaderCircle class="h-5 w-5 animate-spin" /></div>
	{:else if state.error && state.items.length === 0}
		<div class="rounded-xl border border-red/20 bg-s1 p-6 text-center text-xs text-red">{state.error}</div>
	{:else if state.items.length === 0}
		<div class="rounded-xl border border-bd bg-s1 p-8 text-center text-xs text-g5">No {status.toLowerCase()} positions were returned for this timeframe.</div>
	{:else}
		<TraderPositionTable items={state.items} chain={target!.chain} />
		<div class="flex flex-col items-center gap-2 py-3">
			{#if state.error}<span class="text-[10px] text-red">{state.error}</span>{/if}
			{#if state.nextCursor}<button type="button" class="btn-secondary flex items-center gap-1.5 px-4 py-1.5 text-[10px] disabled:opacity-40" disabled={state.loadingMore} onclick={() => target && loadPositions(target, status, tokenTimeRange, false)}>{#if state.loadingMore}<LoaderCircle class="h-3 w-3 animate-spin" />{/if}{state.loadingMore ? 'Loading…' : 'Load more positions'}</button>{/if}
		</div>
	{/if}
{/snippet}

{#snippet activityContent()}
	{#if activity.loading}
		<div class="flex h-48 items-center justify-center rounded-xl border border-bd bg-s1 text-g5"><LoaderCircle class="h-5 w-5 animate-spin" /></div>
	{:else if activity.error && activity.items.length === 0}
		<div class="rounded-xl border border-red/20 bg-s1 p-6 text-center text-xs text-red">{activity.error}</div>
	{:else if activity.items.length === 0}
		<div class="rounded-xl border border-bd bg-s1 p-8 text-center text-xs text-g5">No wallet activity was returned.</div>
	{:else}
		<TraderSwapTable swaps={activity.items} chain={target!.chain} />
		<div class="flex flex-col items-center gap-2 py-3">
			{#if activity.error}<span class="text-[10px] text-red">{activity.error}</span>{/if}
			{#if activity.nextCursor}<button type="button" class="btn-secondary flex items-center gap-1.5 px-4 py-1.5 text-[10px] disabled:opacity-40" disabled={activity.loadingMore} onclick={() => target && loadActivity(target, false)}>{#if activity.loadingMore}<LoaderCircle class="h-3 w-3 animate-spin" />{/if}{activity.loadingMore ? 'Loading…' : 'Load more activity'}</button>{/if}
		</div>
	{/if}
{/snippet}
