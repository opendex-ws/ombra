<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import type { TokenTimeRange, TraderTokenPnlDetailResponse, TraderTokenSwapEntry, TraderTokenSwapsResponse } from '$lib/api/types';
	import { portal } from '$lib/actions/portal';
	import { closeTraderOverview, getTraderOverviewTarget, openTraderPortfolio } from '$lib/stores/traderAnalytics.svelte';
	import { explorerAddressUrl, formatCompactNumber, formatPercent, formatPriceText, formatUsd, shortAddress } from '$lib/utils/format';
	import TraderSwapTable from './TraderSwapTable.svelte';
	import TraderTokenChart from './TraderTokenChart.svelte';
	import { TOKEN_TIME_RANGE_OPTIONS, valueColorClass } from './config';
	import Copy from 'lucide-svelte/icons/copy';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import Maximize2 from 'lucide-svelte/icons/maximize-2';
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
	let pnlView = $state<'calendar' | 'chart'>('chart');

	async function addCopyTrade(walletChain: string, walletAddress: string) {
		if (ctAdding || ctDone) return;
		ctAdding = true;
		try {
			const name = detail?.labels?.[0]?.label ?? shortAddress(walletAddress);
			const { error } = await api.POST('/v2/watchlist/manage/wallets/create', {
				body: { name, chain: walletChain as any, walletAddress }
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed');
			ctDone = true;
		} catch {}
		ctAdding = false;
	}

	let timeRange: TokenTimeRange = $state('ONE_DAY');
	let detail: TraderTokenPnlDetailResponse | null = $state(null);
	const MAX_SWAPS = 1000;
	let swaps: TraderTokenSwapEntry[] = $state([]);
	let swapsPaginated = $state(false);
	const swapKey = (s: TraderTokenSwapEntry) => `${s.txHash}:${s.token.address}:${s.side}:${s.amountTokenStr}`;
	let nextCursor: string | undefined = $state(undefined);
	let detailLoading = $state(false);
	let swapsLoading = $state(false);
	let loadingMore = $state(false);
	let detailError = $state('');
	let swapsError = $state('');
	let detailGeneration = 0;
	let swapsGeneration = 0;
	let detailWsKey: string | null = null;
	let swapsWsKey: string | null = null;

	let target = $derived(getTraderOverviewTarget());

	function cleanupDetailWs() {
		if (!detailWsKey) return;
		unsubscribe(detailWsKey);
		detailWsKey = null;
	}

	function cleanupSwapsWs() {
		if (!swapsWsKey) return;
		unsubscribe(swapsWsKey);
		swapsWsKey = null;
	}

	function cleanupWs() {
		cleanupDetailWs();
		cleanupSwapsWs();
	}

	function isCurrentTarget(nextTarget: NonNullable<typeof target>): boolean {
		return target?.chain === nextTarget.chain
			&& target.walletAddress === nextTarget.walletAddress
			&& target.token.address === nextTarget.token.address;
	}

	function setupDetailWs(nextTarget: NonNullable<typeof target>, range: TokenTimeRange, generation: number) {
		cleanupDetailWs();
		const topic = `traders:${nextTarget.chain}:${nextTarget.walletAddress}:tokens:${nextTarget.token.address}:pnl`;
		detailWsKey = subscribe(topic, (event, data, eventTopic) => {
			if (event !== 'TRADER_TOKEN_PNL_DETAIL' || eventTopic !== topic || generation !== detailGeneration) return;
			if (!isCurrentTarget(nextTarget) || timeRange !== range) return;
			detail = data as TraderTokenPnlDetailResponse;
		}, { timeRange: range });
	}

	function setupSwapsWs(nextTarget: NonNullable<typeof target>, generation: number, endCursor: string) {
		cleanupSwapsWs();
		const topic = `traders:${nextTarget.chain}:${nextTarget.walletAddress}:tokens:${nextTarget.token.address}:swaps`;
		swapsWsKey = subscribe(topic, (event, data, eventTopic) => {
			if (event !== 'TRADER_TOKEN_SWAPS' || eventTopic !== topic || generation !== swapsGeneration) return;
			if (!isCurrentTarget(nextTarget)) return;
			const snapshot = data as TraderTokenSwapsResponse;
			if (swapsPaginated) {
				// User has loaded older rows — merge the live snapshot into the head
				// (dedup) instead of replacing, so pagination isn't wiped.
				const seen = new Set(swaps.map(swapKey));
				const fresh = snapshot.swaps.filter((s) => !seen.has(swapKey(s)));
				if (fresh.length > 0) swaps = [...fresh, ...swaps].slice(0, MAX_SWAPS);
			} else {
				swaps = snapshot.swaps;
				nextCursor = snapshot.nextCursor;
			}
		}, { endCursor }, {
			recovery: 'refetch',
			onReconnect: () => { void loadSwaps(nextTarget, true); }
		});
	}

	async function copyAddress() {
		if (target && navigator.clipboard) await navigator.clipboard.writeText(target.walletAddress);
	}

	async function loadDetail(nextTarget: NonNullable<typeof target>, range: TokenTimeRange) {
		cleanupDetailWs();
		const generation = ++detailGeneration;
		detailLoading = true;
		detailError = '';
		try {
			const { data, error } = await api.GET('/v2/traders/{chain}/{walletAddress}/tokens/{tokenAddress}/pnl', {
				params: {
					path: { chain: nextTarget.chain, walletAddress: nextTarget.walletAddress, tokenAddress: nextTarget.token.address },
					query: { timeRange: range }
				}
			});
			if (generation !== detailGeneration) return;
			if (error || !data) throw new Error('Unable to load this trader’s token performance.');
			detail = data;
			setupDetailWs(nextTarget, range, generation);
		} catch (cause) {
			if (generation !== detailGeneration) return;
			detail = null;
			detailError = cause instanceof Error ? cause.message : 'Unable to load token performance.';
		} finally {
			if (generation === detailGeneration) detailLoading = false;
		}
	}

	async function loadSwaps(nextTarget: NonNullable<typeof target>, reset: boolean) {
		if (!reset && (!nextCursor || loadingMore)) return;
		// Only tear down / re-generate the live WS on a fresh (reset) load. Load-more
		// keeps the existing head subscription alive so new swaps still stream in.
		if (reset) cleanupSwapsWs();
		const generation = reset ? ++swapsGeneration : swapsGeneration;
		if (reset) {
			swapsLoading = true;
			swapsError = '';
		} else {
			loadingMore = true;
		}
		try {
			const { data, error } = await api.GET('/v2/traders/{chain}/{walletAddress}/tokens/{tokenAddress}/swaps', {
				params: {
					path: { chain: nextTarget.chain, walletAddress: nextTarget.walletAddress, tokenAddress: nextTarget.token.address },
					query: { cursor: reset ? undefined : nextCursor }
				}
			});
			if (generation !== swapsGeneration) return;
			if (error || !data) throw new Error('Unable to load this trader’s token swaps.');
			if (reset) {
				swaps = data.swaps;
				swapsPaginated = false;
				nextCursor = data.nextCursor;
				// Subscribe the live head window only on the initial load; load-more
				// keeps that subscription so new swaps still merge into the head.
				setupSwapsWs(nextTarget, generation, data.cursor);
			} else {
				swaps = [...swaps, ...data.swaps].slice(0, MAX_SWAPS);
				swapsPaginated = true;
				nextCursor = swaps.length < MAX_SWAPS ? data.nextCursor : undefined;
			}
		} catch (cause) {
			if (generation !== swapsGeneration) return;
			swapsError = cause instanceof Error ? cause.message : 'Unable to load token swaps.';
			if (reset) {
				swaps = [];
				nextCursor = undefined;
			}
		} finally {
			if (generation === swapsGeneration) {
				swapsLoading = false;
				loadingMore = false;
			}
		}
	}

	function refresh() {
		if (!target) return;
		void loadDetail(target, timeRange);
		void loadSwaps(target, true);
	}

	$effect(() => {
		const nextTarget = target;
		if (!nextTarget) {
			detailGeneration++;
			swapsGeneration++;
			cleanupWs();
			detail = null;
			detailError = '';
			return;
		}
		untrack(() => {
			cleanupWs();
			timeRange = 'ONE_DAY';
			detail = null;
			detailError = '';
			swaps = [];
			nextCursor = undefined;
			ctDone = false;
			void loadSwaps(nextTarget, true);
		});
	});

	$effect(() => {
		const nextTarget = target;
		const range = timeRange;
		if (!nextTarget) return;
		untrack(() => void loadDetail(nextTarget, range));
	});

	onDestroy(() => {
		cleanupWs();
	});
</script>

{#if target}
	<div
		use:portal
		class="fixed inset-0 z-[190] flex items-end justify-end bg-s0/50 md:items-stretch"
		role="presentation"
		onclick={closeTraderOverview}
		onkeydown={(event) => { if (event.key === 'Escape') closeTraderOverview(); }}
	>
		<div
			class="glass-strong flex h-[94dvh] w-full flex-col rounded-t-2xl border-t border-bd bg-s2 shadow-2xl md:h-full md:max-w-[42rem] md:rounded-none md:rounded-l-2xl md:border-l md:border-t-0"
			role="dialog"
			aria-modal="true"
			aria-label="Trader token overview"
			tabindex="-1"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => {
				event.stopPropagation();
				if (event.key === 'Escape') closeTraderOverview();
			}}
		>
			<div class="flex shrink-0 items-center gap-3 border-b border-bd bg-s1/60 px-4 py-3 md:rounded-tl-2xl">
				<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-bd bg-s2 text-xs font-bold text-tx">{target.token.symbol.slice(0, 3)}</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<h2 class="truncate text-sm font-bold text-tx">{target.token.symbol} trader overview</h2>
						<ChainIcon chain={target.chain} class="h-3.5 w-3.5 text-g6" />
					</div>
					<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-g5">
						<WalletIcon address={target.walletAddress} photoId={detail?.labels?.[0]?.photoId} size={14} class="h-3.5 w-3.5" />
						{#if (detail?.labels ?? []).length > 0}
							<span class="truncate font-medium text-tx">{detail!.labels![0].label}</span>
							<span class="shrink-0 rounded bg-s7 px-1.5 py-px font-mono text-[10px] text-g7">{shortAddress(target.walletAddress)}</span>
						{:else}
							<span class="truncate font-mono">{shortAddress(target.walletAddress)}</span>
						{/if}
						<button type="button" class="cursor-pointer p-0.5 transition-colors hover:text-tx" onclick={copyAddress} aria-label="Copy wallet address"><Copy class="h-3 w-3" /></button>
						<a href={explorerAddressUrl(target.chain, target.walletAddress)} target="_blank" rel="noopener" class="p-0.5 transition-colors hover:text-tx" aria-label="Open wallet in explorer"><ExternalLink class="h-3 w-3" /></a>
					</div>
				</div>
				{#if getIsLoggedIn()}
					<button
						type="button"
						disabled={ctAdding || ctDone}
						class="btn-primary px-2.5 py-1 text-[10px]"
						onclick={() => addCopyTrade(target.chain, target.walletAddress)}
						aria-label="Copy trade this wallet"
					>
						{#if ctAdding}Adding...{:else if ctDone}Added{:else}<span class="flex items-center gap-1"><UserPlus class="h-3 w-3" /> Copy Trade</span>{/if}
					</button>
				{/if}
				<button type="button" class="cursor-pointer p-1.5 text-g4 transition-colors hover:text-tx" onclick={refresh} aria-label="Refresh trader overview"><RefreshCw class="h-4 w-4 {detailLoading || swapsLoading ? 'animate-spin' : ''}" /></button>
				<button type="button" class="cursor-pointer text-g4 transition-colors hover:text-tx" onclick={closeTraderOverview} aria-label="Close"><X class="h-4 w-4" /></button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<div class="flex gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
						{#each TOKEN_TIME_RANGE_OPTIONS as range}
							<button type="button" class="cursor-pointer rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors {timeRange === range.value ? 'border border-tx text-tx' : 'border border-transparent text-g5 hover:text-g9'}" onclick={() => (timeRange = range.value)}>{range.label}</button>
						{/each}
					</div>
					<button type="button" class="btn-secondary ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[10px]" onclick={() => openTraderPortfolio({ chain: target.chain, walletAddress: target.walletAddress })}>
						<Maximize2 class="h-3 w-3" /> Full portfolio
					</button>
				</div>

				<WalletFundingPanel chain={target.chain} walletAddress={target.walletAddress} />
				<WalletTransferTimeline chain={target.chain} walletAddress={target.walletAddress} />

				{#if detailLoading && !detail}
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">{#each Array(8) as _}<div class="skeleton h-16 rounded-xl"></div>{/each}</div>
				{:else if detailError}
					<div class="rounded-xl border border-red/20 bg-s1 p-4 text-center text-xs text-red">{detailError}</div>
				{:else if detail}
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{@render metric('Realized PnL', formatUsd(detail.item.profitUsdStr), detail.item.profitPct === undefined ? '—' : formatPercent(detail.item.profitPct), valueColorClass(detail.item.profitUsd))}
						{@render metric('Unrealized', formatUsd(detail.item.unrealizedProfitUsdStr), formatPercent(detail.item.unrealizedProfitPct), valueColorClass(detail.item.unrealizedProfitUsd))}
						{@render metric('Bought', formatUsd(detail.item.boughtUsdStr), `${detail.item.buys} buys`, 'text-grn')}
						{@render metric('Sold', detail.item.soldUsdStr ? formatUsd(detail.item.soldUsdStr) : '—', `${detail.item.sells} sells`, 'text-red')}
						{@render metric('Balance', formatUsd(detail.item.balanceUsdStr), `${formatCompactNumber(detail.item.remainingTokensStr)} tokens`, 'text-tx')}
						{@render metric('Avg buy', formatPriceText(detail.item.avgCostBoughtStr), `Avg sell ${detail.item.avgCostSoldStr ? formatPriceText(detail.item.avgCostSoldStr) : '—'}`, 'text-tx')}
						{@render metric('Current price', formatPriceText(detail.item.currentPriceUsdStr), `MC ${formatUsd(detail.item.currentMarketCapUsdStr)}`, 'text-tx')}
						{@render metric('Fees', formatUsd(detail.item.totalFeesUsdStr), `${detail.item.balancePctOfSupply.toFixed(4)}% supply`, 'text-g8')}
					</div>
					{#if detail.pnlSparkline?.pnlUsd?.length > 1}
						<div class="mt-2">
							{#if pnlView === 'calendar'}
								<PnlMonthsCalendar sparkline={detail.pnlSparkline} numDays={90} single actions={pnlViewToggle} />
							{:else}
								{@const pts = detail.pnlSparkline.pnlUsd}
								{@const min = Math.min(...pts)}
								{@const max = Math.max(...pts)}
								{@const range = max - min || 1}
								{@const W = 600}
								{@const H = 48}
								{@const lastVal = pts[pts.length - 1]}
								{@const lineColor = lastVal >= 0 ? 'var(--t-grn)' : 'var(--t-red)'}
								{@const polyPts = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - min) / range) * H}`)}
								{@const zeroY = H - ((0 - min) / range) * H}
								<div class="rounded-xl border border-bd bg-s1 p-2.5">
									<div class="mb-1 flex items-center justify-between">
										<span class="text-[9px] font-medium uppercase tracking-wider text-g5">Cumulative PnL</span>
										<div class="flex items-center gap-1.5">
											<span class="text-xs font-bold {lastVal >= 0 ? 'text-grn' : 'text-red'}">{lastVal >= 0 ? '+' : ''}{formatUsd(lastVal)}</span>
											{@render pnlViewToggle()}
										</div>
									</div>
									<svg viewBox="0 0 {W} {H}" class="h-72 w-full" preserveAspectRatio="none">
										{#if min < 0 && max > 0}
											<line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="var(--t-g1)" stroke-width="1" stroke-dasharray="4,4" />
										{/if}
										<defs>
											<linearGradient id="trader-pnl-fill" x1="0" y1="0" x2="0" y2="1">
												<stop offset="0%" stop-color={lineColor} stop-opacity="0.2" />
												<stop offset="100%" stop-color={lineColor} stop-opacity="0" />
											</linearGradient>
										</defs>
										<polygon points="{polyPts.join(' ')} {W},{H} 0,{H}" fill="url(#trader-pnl-fill)" />
										<polyline points={polyPts.join(' ')} fill="none" stroke={lineColor} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
									</svg>
								</div>
							{/if}
						</div>
					{/if}
				{/if}

				<div class="mt-4">
					<div class="mb-2 flex items-center justify-between"><h3 class="text-xs font-bold text-tx">Price and executions</h3><span class="text-[9px] text-g4">Buy/sell markers use this wallet’s swaps</span></div>
					<TraderTokenChart chain={target.chain} address={target.token.address} {timeRange} {swaps} />
				</div>

				<div class="mt-4">
					<div class="mb-2 flex items-center justify-between">
						<div>
							<h3 class="text-xs font-bold text-tx">Token activity</h3>
							<span class="text-[9px] text-g4">{target.token.symbol} · {target.token.name}</span>
						</div>
						<span class="text-[9px] text-g4">{swaps.length} loaded</span>
					</div>
					{#if swapsLoading && swaps.length === 0}
						<div class="flex h-32 items-center justify-center rounded-xl border border-bd bg-s1 text-g5"><LoaderCircle class="h-5 w-5 animate-spin" /></div>
					{:else if swapsError && swaps.length === 0}
						<div class="rounded-xl border border-red/20 bg-s1 p-4 text-center text-xs text-red">{swapsError}</div>
					{:else if swaps.length === 0}
						<div class="rounded-xl border border-bd bg-s1 p-6 text-center text-xs text-g5">No swaps are available for this token.</div>
					{:else}
						<TraderSwapTable {swaps} chain={target.chain} tokenSymbol={target.token.symbol} tokenName={target.token.name} />
						<div class="flex flex-col items-center gap-2 py-3">
							{#if swapsError}<span class="text-[10px] text-red">{swapsError}</span>{/if}
							{#if nextCursor}
								<button
									type="button"
									class="btn-secondary flex items-center gap-1.5 px-4 py-1.5 text-[10px] disabled:opacity-40"
									disabled={loadingMore}
									onclick={() => target && loadSwaps(target, false)}
								>
									{#if loadingMore}<LoaderCircle class="h-3 w-3 animate-spin" />{/if}
									{loadingMore ? 'Loading…' : 'Load more activity'}
								</button>
							{/if}
						</div>
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
	<div class="rounded-xl border border-bd bg-s1 p-2.5">
		<div class="text-[9px] font-medium uppercase tracking-wider text-g5">{label}</div>
		<div class="mt-1 truncate text-sm font-bold {color}">{value}</div>
		<div class="mt-0.5 truncate text-[9px] text-g5">{secondary}</div>
	</div>
{/snippet}
