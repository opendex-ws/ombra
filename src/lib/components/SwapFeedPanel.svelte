<script lang="ts">
	import { untrack, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import Filter from 'lucide-svelte/icons/filter';
	import Check from 'lucide-svelte/icons/check';
	import Plus from 'lucide-svelte/icons/plus';
	import Users from 'lucide-svelte/icons/users';
	import FomoIcon from './FomoIcon.svelte';
	import PumpFunIcon from './PumpFunIcon.svelte';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Search from 'lucide-svelte/icons/search';
	import X from 'lucide-svelte/icons/x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import { api, type QueryOf } from '$lib/api/client';
	import { tokenImage } from '$lib/api/config';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import type {
		Chain,
		LabeledWallet,
		LabeledWalletsResponse,
		LabeledWalletSwap,
		WalletLabelSource,
		WalletLabelSummary,
		WalletLabelsResponse
	} from '$lib/api/types';
	import { formatUsd, timeAgo, fullDateTime, shortAddress, avatarUrl, formatCompactCount } from '$lib/utils/format';
	import { getWalletIconUrl } from '$lib/utils/walleticon';
	import { getNow } from '$lib/stores/tick.svelte';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { getMoneyFlow, getSwapFeedFilters, setSwapFeedFilters, getSwapFeedCompact, toggleSwapFeedCompact } from '$lib/stores/feSettings.svelte';
	import MoneyFlowGraph from './MoneyFlowGraph.svelte';
	import { createFlowAccumulator, type FlowSwap } from '$lib/utils/money-flow';
	import Waypoints from 'lucide-svelte/icons/waypoints';
	import List from 'lucide-svelte/icons/list';
	import Rows3 from 'lucide-svelte/icons/rows-3';
	import AlignJustify from 'lucide-svelte/icons/align-justify';
	import Pause from 'lucide-svelte/icons/pause';
	import { createCoalescer } from '$lib/utils/coalesce';
	import { VirtualList } from '$lib/utils/virtual.svelte';
	import WalletManagePanel from './WalletManagePanel.svelte';
	import { openTraderPortfolio } from '$lib/stores/traderAnalytics.svelte';
	import { mergeLabelSuggestions } from '$lib/utils/wallet-labels';

	let {
		active = true,
		onnavigate = () => {}
	}: {
		active?: boolean;
		onnavigate?: () => void;
	} = $props();

	/** The firehose is unbounded; keep the rendered feed to a sane ceiling. */
	const MAX_SWAPS = 500;
	/** REST lookback is capped at 10 minutes server-side. */
	const SEED_MINUTES = 10;

	let swaps = $state.raw<LabeledWalletSwap[]>([]);
	let loading = $state(true);
	// Filters are restored from the persisted blob so a refresh keeps your setup.
	const savedFilters = getSwapFeedFilters();
	let feedMode = $state<'all' | 'mine'>(savedFilters.feedMode);
	let side = $state<'' | 'BUY' | 'SELL'>(savedFilters.side);
	// The spec defaults this to 10 and warns that an unfiltered subscription is
	// the one most likely to flood a client.
	let minUsd = $state(savedFilters.minUsd);
	let maxUsd = $state<number | null>(savedFilters.maxUsd);
	let wsKey: string | null = null;
	const seen = new Set<string>();
	/** Wallets followed into `wallets:personal` — this set IS the user's own feed. */
	let following = $state<Set<string>>(new Set());
	// `labels` is a free-text filter param the server matches case-insensitively, so
	// the user types one rather than picking from a vocabulary of tens of thousands.
	let selectedLabels = $state<Set<string>>(new Set(savedFilters.labels));
	let labelInput = $state('');
	let labelSuggestions = $state.raw<WalletLabelSummary[]>([]);
	let labelSearching = $state(false);
	let labelRequest = 0;
	let labelDebounce: ReturnType<typeof setTimeout> | undefined;
	const SOURCES: { id: WalletLabelSource; label: string }[] = [
		{ id: 'FOMO', label: 'FOMO' },
		{ id: 'PUMPFUN', label: 'Pump.fun' },
		{ id: 'KOL', label: 'KOL' }
	];
	let selectedSources = $state<Set<WalletLabelSource>>(new Set(savedFilters.sources as WalletLabelSource[]));
	let showLabelFilter = $state(false);
	let followPending = $state<string | null>(null);
	// `wallets:personal` is built by following wallets, so the directory needs to be
	// browsable — otherwise you can only follow whoever happens to trade while you watch.
	let view = $state<'feed' | 'manage'>('feed');
	// Money flow is a beta view over the SAME filtered swaps, not a second feed.
	let flowView = $state(false);

	function openManage() {
		view = 'manage';
	}


	const filterCount = $derived(selectedLabels.size + selectedSources.size);

	function brandSource(labels: { source?: WalletLabelSource | null }[] | undefined): 'FOMO' | 'PUMPFUN' | null {
		if (!labels?.length) return null;
		if (labels.some((l) => l.source === 'FOMO')) return 'FOMO';
		if (labels.some((l) => l.source === 'PUMPFUN')) return 'PUMPFUN';
		return null;
	}

	const vlFull = new VirtualList({ estimate: 58, gap: 0, overscan: 6 });
	const vlCompact = new VirtualList({ estimate: 24, gap: 0, overscan: 12 });
	const compactRows = $derived(getSwapFeedCompact());
	const vl = $derived(compactRows ? vlCompact : vlFull);

	$effect(() => {
		vlFull.count = swaps.length;
		vlCompact.count = swaps.length;
	});

	// The rendered feed is capped at MAX_SWAPS, but money flow is about the shape
	// of a whole session, so it accumulates every swap into per-token totals
	// instead. Memory is bounded by distinct tokens, not by swaps seen.
	const flowAcc = createFlowAccumulator();
	let flowVersion = $state(0);
	const moneyFlow = $derived.by(() => {
		void flowVersion;
		return flowAcc.snapshot();
	});

	function accumulateFlow(rows: LabeledWalletSwap[]) {
		if (rows.length === 0) return;
		flowAcc.add(rows as unknown as FlowSwap[]);
		flowVersion++;
	}

	let feedHoverPaused = $state(false);
	let heldSwaps: LabeledWalletSwap[] = [];

	function prependSwaps(fresh: LabeledWalletSwap[]) {
		if (fresh.length === 0) return;
		swaps = [...fresh, ...swaps].slice(0, MAX_SWAPS);
		applySubscribedFlags(fresh);
		pruneSeen();
	}

	// High-frequency WS: buffer and prepend once per frame rather than rebuilding
	// the array per swap.
	const swapCoalescer = createCoalescer<LabeledWalletSwap>((batch) => {
		if (batch.length === 0) return;
		// `seen` is only a cheap pre-filter — a re-seed clears it while frames are
		// still buffered, so the rendered rows are the authority here. Duplicate
		// ids would break the keyed each, not merely show a row twice.
		const present = new Set(swaps.map((swap) => swap.id));
		for (const swap of heldSwaps) present.add(swap.id);
		const fresh: LabeledWalletSwap[] = [];
		for (const swap of batch) {
			if (present.has(swap.id)) continue;
			present.add(swap.id);
			fresh.push(swap);
		}
		if (fresh.length === 0) return;
		fresh.reverse();
		// Accumulate at ingestion, so pausing the feed on hover never costs flow.
		accumulateFlow(fresh);
		if (feedHoverPaused) {
			heldSwaps = [...fresh, ...heldSwaps].slice(0, MAX_SWAPS);
			return;
		}
		prependSwaps(fresh);
	}, { maxBatch: 200 });

	let feedPointerInside = false;
	let feedScrollTop = 0;
	const LIVE_EDGE_PX = 8;

	function fineHover() {
		return typeof window !== 'undefined'
			&& window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	}

	function canHoverPause(event: PointerEvent) {
		return event.pointerType === 'mouse' && fineHover();
	}

	function setFeedHoverPaused(paused: boolean) {
		if (feedHoverPaused === paused) return;
		feedHoverPaused = paused;
		if (!paused && heldSwaps.length > 0) {
			const held = heldSwaps;
			heldSwaps = [];
			prependSwaps(held);
		}
	}

	function syncFeedHoverPause() {
		setFeedHoverPaused(feedPointerInside && fineHover() && feedScrollTop > LIVE_EDGE_PX);
	}

	/** `seen` only has to cover what is still rendered. */
	function pruneSeen() {
		if (seen.size <= swaps.length + MAX_SWAPS) return;
		seen.clear();
		for (const swap of swaps) seen.add(swap.id);
	}

	function queryParams(): QueryOf<'/v2/wallets/feed'> {
		const q: QueryOf<'/v2/wallets/feed'> = {
			minutes: SEED_MINUTES,
			limit: MAX_SWAPS,
			minUsd,
			maxUsd: maxUsd ?? undefined
		};
		if (side) q.side = side;
		// Without this the Mine seed came back unfiltered while the WS delivered
		// only curated wallets.
		if (feedMode === 'mine') q.curated = true;
		if (selectedLabels.size > 0) q.labels = [...selectedLabels].sort();
		if (selectedSources.size > 0) q.sources = [...selectedSources].sort();
		return q;
	}

	/**
	 * The followed set is what `wallets:personal` is built from. Only the first page
	 * is needed to light up the follow badges on visible rows; the Manage view pages
	 * through the rest.
	 */
	/**
	 * Swaps carry `subscribed` whenever the server can know it (authed REST, and
	 * `wallets:personal` where it is always true). It is absent on the shared
	 * `wallets:feed` firehose, whose frames are broadcast to every subscriber — so
	 * only ever ADD from a present flag, never infer "unfollowed" from its absence.
	 */
	function applySubscribedFlags(rows: LabeledWalletSwap[]) {
		let changed = false;
		for (const row of rows) {
			if (row.subscribed === true && !following.has(row.walletAddress)) {
				following.add(row.walletAddress);
				changed = true;
			} else if (row.subscribed === false && following.delete(row.walletAddress)) {
				changed = true;
			}
		}
		if (changed) following = new Set(following);
	}

	async function loadFollowing() {
		try {
			const { data } = await api.GET('/v2/wallets/subscriptions');
			for (const w of data?.wallets ?? []) following.add(w.walletAddress);
			following = new Set(following);
		} catch {}
	}

	/**
	 * One page of the Manage list. `query`/`sources` are matched server-side now, so
	 * nothing is filtered client-side. Cursors are opaque: only `nextCursor` is ever
	 * sent back.
	 */


	/** Typeahead over the distinct label vocabulary (tens of thousands of entries). */
	async function searchLabels(term: string) {
		const request = ++labelRequest;
		const q = term.trim();
		if (!q) {
			labelSuggestions = [];
			labelSearching = false;
			return;
		}
		labelSearching = true;
		try {
			const query: QueryOf<'/v2/wallets/labels'> = { query: q };
			if (selectedSources.size > 0) query.sources = [...selectedSources].sort();
			const { data } = await api.GET('/v2/wallets/labels', { params: { query } });
			if (request !== labelRequest) return;
			labelSuggestions = mergeLabelSuggestions(data?.labels ?? []).filter(
				(l) => !selectedLabels.has(l.label)
			);
		} catch {
			if (request === labelRequest) labelSuggestions = [];
		} finally {
			if (request === labelRequest) labelSearching = false;
		}
	}

	function onLabelInput(value: string) {
		labelInput = value;
		clearTimeout(labelDebounce);
		labelDebounce = setTimeout(() => void searchLabels(value), 200);
	}

	function addLabel(raw: string) {
		const label = raw.trim();
		if (!label) return;
		const next = new Set(selectedLabels);
		next.add(label);
		selectedLabels = next;
		labelInput = '';
		labelSuggestions = [];
		labelRequest++;
	}

	function removeLabel(label: string) {
		const next = new Set(selectedLabels);
		next.delete(label);
		selectedLabels = next;
	}

	function toggleSource(id: WalletLabelSource) {
		const next = new Set(selectedSources);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedSources = next;
	}

	async function toggleFollow(target: { chain: string; walletAddress: string }) {
		if (!getIsLoggedIn() || followPending) return;
		const wallet = target.walletAddress;
		const wasFollowing = following.has(wallet);
		followPending = wallet;
		// Optimistic: both endpoints are idempotent, so a failure just reverts.
		const next = new Set(following);
		if (wasFollowing) next.delete(wallet);
		else next.add(wallet);
		following = next;
		try {
			const path = { params: { path: { chain: target.chain as Chain, wallet } } };
			if (wasFollowing) await api.DELETE('/v2/wallets/subscriptions/{chain}/{wallet}', path);
			else await api.POST('/v2/wallets/subscriptions/{chain}/{wallet}', path);
		} catch {
			const revert = new Set(following);
			if (wasFollowing) revert.add(wallet);
			else revert.delete(wallet);
			following = revert;
		} finally {
			followPending = null;
		}
		// The followed set defines the `wallets:personal` room, so re-seed when it changes.
		if (feedMode === 'mine') {
			seen.clear();
			await loadSeed();
		}
	}

	function matchesSources(swap: LabeledWalletSwap): boolean {
		if (selectedSources.size === 0) return true;
		return (swap.labels ?? []).some((l) => l.source && selectedSources.has(l.source));
	}

	async function loadSeed() {
		loading = true;
		try {
			const { data } = await api.GET('/v2/wallets/feed', { params: { query: queryParams() } });
			// Bare array today; an envelope (`{ swaps }`) is planned, to match
			// `/token/{chain}/{address}/swaps`. Accept both across that rollout.
			const payload = data as LabeledWalletSwap[] | { swaps?: LabeledWalletSwap[] } | undefined;
			const rows = (Array.isArray(payload) ? payload : (payload?.swaps ?? [])) as LabeledWalletSwap[];
			seen.clear();
			heldSwaps = [];
			for (const row of rows) seen.add(row.id);
			applySubscribedFlags(rows);
			accumulateFlow(rows);
			swaps = rows.slice(0, MAX_SWAPS);
		} catch {
			heldSwaps = [];
			swaps = [];
		} finally {
			loading = false;
		}
	}

	function setupWs() {
		if (wsKey) {
			unsubscribe(wsKey);
			wsKey = null;
		}
		if (!active) return;
		swapCoalescer.clear();
		const topic = feedMode === 'mine' ? 'wallets:personal' : 'wallets:feed';
		const params: Record<string, unknown> = { minUsd };
		if (maxUsd !== null) params.maxUsd = maxUsd;
		if (side) params.side = side;
		if (selectedLabels.size > 0) params.labels = [...selectedLabels].sort();
		wsKey = subscribe(topic, (event, data) => {
			if (event !== 'LABELED_WALLET_SWAP' || !data) return;
			// The spec moved this frame's `data` from one swap to an array, but the
			// deployed backend still sends a bare object. Accept both so the feed
			// works either side of that rollout.
			const batch = (Array.isArray(data) ? data : [data]) as LabeledWalletSwap[];
			for (const swap of batch) {
				// `sources` is a REST-only filter — the WS topic takes no such param,
				// so the live stream is narrowed here or it drifts from the seed.
				if (!matchesSources(swap)) continue;
				// id is `{txHash}:{logPlaceInBlock}` — stable, so it dedupes the
				// overlap between the REST seed and the live stream.
				if (seen.has(swap.id)) continue;
				seen.add(swap.id);
				swapCoalescer.push(swap);
			}
		}, params, { onSubscribed: () => void loadSeed() });
	}

	$effect(() => {
		const isActive = active;
		// Re-seed and re-subscribe whenever a filter changes.
		void feedMode;
		void side;
		void minUsd;
		void maxUsd;
		void selectedLabels;
		void selectedSources;
		if (!isActive) {
			if (wsKey) {
				unsubscribe(wsKey);
				wsKey = null;
			}
			swapCoalescer.clear();
			return;
		}
		untrack(() => {
			// A filter change is a different dataset, so the running totals no
			// longer describe what is on screen. A plain refetch keeps them.
			flowAcc.reset();
			flowVersion++;
			void loadSeed();
			setupWs();
		});
	});

	$effect(() => {
		if (getIsLoggedIn()) untrack(() => void loadFollowing());
	});

	// Persist whenever a filter changes. Writes a different store, so this cannot
	// feed back into its own dependencies.
	$effect(() => {
		const next = {
			feedMode,
			side,
			minUsd,
			maxUsd,
			labels: [...selectedLabels],
			sources: [...selectedSources]
		};
		untrack(() => setSwapFeedFilters(next));
	});

	onDestroy(() => {
		clearTimeout(labelDebounce);
		feedPointerInside = false;
		setFeedHoverPaused(false);
		if (wsKey) unsubscribe(wsKey);
		swapCoalescer.dispose();
	});

	function openWallet(swap: LabeledWalletSwap) {
		openTraderPortfolio({
			chain: swap.chain as Chain,
			walletAddress: swap.walletAddress
		});
	}
</script>

{#snippet sourceAvatar(
	photoId: string | null | undefined,
	wallet: string,
	source: 'FOMO' | 'PUMPFUN' | null,
	box: string,
	badge: string
)}
	<div class="relative {box} shrink-0">
		{#if photoId && avatarUrl(photoId)}
			<img src={avatarUrl(photoId)} alt="" class="{box} rounded-full object-cover ring-1 ring-bd" loading="lazy" />
		{:else}
			<img src={getWalletIconUrl(wallet)} alt="" class="{box} rounded-full ring-1 ring-bd" loading="lazy" />
		{/if}
		{#if source}
			<span
				class="absolute -bottom-1 -left-1 flex {badge} items-center justify-center overflow-hidden rounded-full bg-s6 ring-1 ring-s6"
				title={source === 'FOMO' ? 'FOMO' : 'Pump.fun'}
			>
				<img
					src={source === 'FOMO' ? '/entity-icons/fomo.webp' : '/entity-icons/pumpfun.webp'}
					alt=""
					class="h-full w-full object-cover"
				/>
			</span>
		{/if}
	</div>
{/snippet}

{#snippet sourceMark(id: WalletLabelSource, size: string)}
	{#if id === 'FOMO'}
		<FomoIcon class={size} />
	{:else if id === 'PUMPFUN'}
		<PumpFunIcon class={size} />
	{:else}
		<Users class={size} strokeWidth={2.5} />
	{/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	{#if view === 'manage'}
		<WalletManagePanel
			onback={() => (view = 'feed')}
			onfollowchange={(wallet, isFollowing) => {
				const next = new Set(following);
				if (isFollowing) next.add(wallet);
				else next.delete(wallet);
				following = next;
				// The followed set defines the `wallets:personal` room.
				if (feedMode === 'mine') {
					seen.clear();
					void loadSeed();
				}
			}}
		/>
	{:else}
	<div class="flex shrink-0 flex-col gap-1 border-b border-bd/40 px-2 py-1.5">
		<div class="flex items-center gap-1">
			{#if getIsLoggedIn()}
				{#each [{ id: 'all' as const, label: 'All' }, { id: 'mine' as const, label: 'Mine' }] as mode}
					<button
						onclick={() => (feedMode = mode.id)}
						class="cursor-pointer rounded px-2.5 py-1 text-[11px] font-semibold transition-colors md:px-1.5 md:py-px md:text-[10px] {feedMode === mode.id ? 'bg-grn/20 text-grn' : 'bg-s4 text-g5 hover:text-g8'}"
					>{mode.label}</button>
				{/each}
				<span class="mx-0.5 h-3 w-px shrink-0 bg-bd"></span>
			{/if}
			{#each [{ id: '' as const, label: 'Both' }, { id: 'BUY' as const, label: 'Buy' }, { id: 'SELL' as const, label: 'Sell' }] as s}
				<button
					onclick={() => (side = s.id)}
					class="cursor-pointer rounded px-2.5 py-1 text-[11px] font-semibold transition-colors md:px-1.5 md:py-px md:text-[10px] {side === s.id ? (s.id === 'SELL' ? 'bg-red/20 text-red' : 'bg-grn/20 text-grn') : 'bg-s4 text-g5 hover:text-g8'}"
				>{s.label}</button>
			{/each}
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{#if getMoneyFlow()}
					<button
						onclick={() => (flowView = !flowView)}
						class="cursor-pointer p-1.5 transition-colors md:p-0.5 {flowView ? 'text-grn' : 'text-g4 hover:text-tx'}"
						title={flowView ? 'Show swap list' : 'Show money flow'}
					>
						{#if flowView}
							<List class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
						{:else}
							<Waypoints class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
						{/if}
					</button>
				{/if}
				<button
					onclick={toggleSwapFeedCompact}
					class="cursor-pointer p-1.5 text-g4 transition-colors hover:text-tx md:p-0.5"
					title={compactRows ? 'Show full rows' : 'Show compact rows'}
				>
					{#if compactRows}
						<Rows3 class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
					{:else}
						<AlignJustify class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
					{/if}
				</button>
				{#if getIsLoggedIn()}
					<button
						onclick={openManage}
						class="cursor-pointer p-1.5 text-g4 transition-colors hover:text-tx md:p-0.5"
						title="Manage followed wallets"
					>
						<Users class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
					</button>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-1">
			<button
				onclick={() => (showLabelFilter = !showLabelFilter)}
				class="relative shrink-0 cursor-pointer p-1.5 transition-colors md:p-0.5 {showLabelFilter ? 'text-tx' : filterCount > 0 ? 'text-grn' : 'text-g4 hover:text-tx'}"
				title="Filter by label or platform"
			>
				<Filter class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
				{#if filterCount > 0}
					<span class="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-grn px-0.5 text-[8px] font-bold text-s0">{filterCount}</span>
				{/if}
			</button>
			<span class="ml-1 shrink-0 text-[10px] text-g5">$</span>
			<input
				type="text"
				inputmode="decimal"
				value={minUsd}
				onchange={(e) => {
					const next = Number((e.currentTarget as HTMLInputElement).value);
					minUsd = Number.isFinite(next) && next >= 0 ? next : 10;
					// The ceiling is inclusive and must not sit below the floor.
					if (maxUsd !== null && maxUsd < minUsd) maxUsd = null;
				}}
				class="min-w-0 flex-1 rounded border border-bd bg-s4 px-1.5 py-1.5 text-[11px] text-tx outline-none md:px-1 md:py-px md:text-[10px]"
				aria-label="Minimum swap size in USD"
			/>
			<span class="shrink-0 text-[10px] text-g5">–</span>
			<input
				type="text"
				inputmode="decimal"
				value={maxUsd ?? ''}
				placeholder="any"
				onchange={(e) => {
					const raw = (e.currentTarget as HTMLInputElement).value.trim();
					const next = Number(raw);
					maxUsd = raw !== '' && Number.isFinite(next) && next >= minUsd ? next : null;
				}}
				class="min-w-0 flex-1 rounded border border-bd bg-s4 px-1.5 py-1.5 text-[11px] text-tx outline-none placeholder:text-g4 md:px-1 md:py-px md:text-[10px]"
				aria-label="Maximum swap size in USD"
			/>
		</div>
	</div>

	{#if showLabelFilter}
		<div class="flex shrink-0 flex-col gap-1.5 border-b border-bd/40 px-2 py-1.5">
			<div class="flex flex-wrap items-center gap-1">
				<span class="mr-0.5 text-[10px] font-medium uppercase tracking-wider text-g5">Platform</span>
				{#each SOURCES as src}
					<button
						onclick={() => toggleSource(src.id)}
						class="flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors md:px-1.5 md:py-px md:text-[10px] {selectedSources.has(src.id) ? 'bg-grn/20 text-grn' : 'bg-s4 text-g6 hover:text-g9'}"
					>
						{@render sourceMark(src.id, 'h-2.5 w-2.5')}
						{src.label}
					</button>
				{/each}
			</div>
			<div class="flex flex-wrap items-center gap-1">
				<span class="mr-0.5 text-[10px] font-medium uppercase tracking-wider text-g5">User</span>
				{#each [...selectedLabels] as label}
					<button
						onclick={() => removeLabel(label)}
						class="flex cursor-pointer items-center gap-0.5 rounded bg-grn/20 px-2.5 py-1 text-[11px] font-medium text-grn md:px-1.5 md:py-px md:text-[10px]"
						title="Remove"
					>
						{label}
						<X class="h-2 w-2" strokeWidth={3} />
					</button>
				{/each}
				<div class="relative min-w-[90px] flex-1">
					<input
						type="text"
						value={labelInput}
						oninput={(e) => onLabelInput((e.target as HTMLInputElement).value)}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addLabel(labelSuggestions[0]?.label ?? labelInput);
							} else if (e.key === 'Escape') {
								labelSuggestions = [];
							} else if (e.key === 'Backspace' && !labelInput && selectedLabels.size > 0) {
								removeLabel([...selectedLabels][selectedLabels.size - 1]);
							}
						}}
						placeholder={selectedLabels.size > 0 ? 'add another...' : 'search labels...'}
						class="w-full rounded border border-bd bg-s4 px-2 py-1.5 text-[11px] text-tx outline-none placeholder:text-g4 md:px-1.5 md:py-px md:text-[10px]"
						aria-label="Filter by wallet label"
					/>
					{#if labelInput.trim() && (labelSuggestions.length > 0 || labelSearching)}
						<div class="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-bd bg-s5 py-0.5 shadow-2xl">
							{#if labelSearching && labelSuggestions.length === 0}
								<div class="flex justify-center py-2"><LoaderCircle class="h-3 w-3 animate-spin text-g5" /></div>
							{:else}
								{#each labelSuggestions as sug (sug.label)}
									<button
										onclick={() => addLabel(sug.label)}
										class="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-wh/5"
									>
										{#if sug.source}
											{@render sourceMark(sug.source, 'h-3 w-3 shrink-0')}
										{/if}
										<span class="min-w-0 flex-1 truncate text-[10px] text-tx">{sug.label}</span>
										<span class="shrink-0 text-[9px] text-g5">{formatCompactCount(sug.walletCount)}</span>
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			</div>
			{#if filterCount > 0}
				<button
					onclick={() => {
						selectedLabels = new Set();
						selectedSources = new Set();
					}}
					class="cursor-pointer self-start text-[10px] text-g4 hover:text-g8">clear filters</button>
			{/if}
		</div>
	{/if}

	{#if getMoneyFlow() && flowView}
		<MoneyFlowGraph
			{swaps}
			flow={moneyFlow}
			onselect={(t) => {
				onnavigate();
				goto(`/?chain=${t.chain}&token=${t.address}`);
			}}
		/>
	{:else if loading && swaps.length === 0}
		<div class="space-y-1 p-2">
			{#each Array(8) as _}
				<div class="skeleton h-[54px] rounded-lg"></div>
			{/each}
		</div>
	{:else if swaps.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
			<span class="text-xs text-g5">
				{feedMode === 'mine' ? 'No swaps from wallets you follow' : 'No labeled swaps yet'}
			</span>
			{#if feedMode === 'mine' && following.size === 0}
				<button onclick={openManage} class="btn-primary mt-1 px-2.5 py-1 text-[11px]">Follow wallets</button>
			{:else}
				<span class="text-[10px] text-g4">Waiting for live swaps over ${minUsd}</span>
			{/if}
		</div>
	{:else}
		<div
			role="presentation"
			class="relative min-h-0 flex-1"
			onpointerenter={(event) => { if (canHoverPause(event)) { feedPointerInside = true; syncFeedHoverPause(); } }}
			onpointerleave={() => { feedPointerInside = false; setFeedHoverPaused(false); }}
		>
			{#if feedHoverPaused}
				<div class="pointer-events-none absolute right-2 top-1 z-30 flex items-center gap-1 rounded-md border border-yel/40 bg-s0/90 px-1.5 py-px text-[10px] font-semibold text-yel shadow-md">
					<Pause class="h-3 w-3" fill="currentColor" />
					Paused
				</div>
			{/if}
		<div class="h-full overflow-y-auto" onscroll={(e) => { feedScrollTop = e.currentTarget.scrollTop; vl.handleScroll(e.currentTarget); syncFeedHoverPause(); }} use:vl.viewport_>
			<div class="relative" style="height: {vl.totalHeight}px">
				{#each swaps.slice(vl.start, vl.end) as swap, i (swap.id)}
					{@const buy = swap.side === 'BUY'}
					{@const who = swap.labels[0]?.label ?? shortAddress(swap.walletAddress)}
					{@const extraTag = swap.labels[1]?.label}
					{#if compactRows}
						<div
							class="absolute inset-x-0 flex items-center gap-1 truncate px-2.5 text-[11px] leading-6 transition-colors hover:bg-wh/5 [contain:layout_paint_style]"
							style="top: {(vl.start + i) * vl.stride}px; height: {vl.stride}px"
							title={fullDateTime(swap.timestamp)}
						>
							<button type="button" class="shrink-0 cursor-pointer" onclick={() => openWallet(swap)} title="{shortAddress(swap.walletAddress)} — open trader">
								{@render sourceAvatar(swap.labels[0]?.photoId, swap.walletAddress, brandSource(swap.labels), 'h-4 w-4', 'h-2.5 w-2.5')}
							</button>
							<button type="button" class="shrink-0 max-w-[30%] cursor-pointer truncate font-semibold text-tx hover:underline" onclick={() => openWallet(swap)} title="{who} — open trader">{who}</button>
							<span class="shrink-0 {buy ? 'text-grn' : 'text-red'}">{buy ? 'bought' : 'sold'}</span>
							<span class="shrink-0 font-bold {buy ? 'text-grn' : 'text-red'}">{formatUsd(swap.amountUsd)}</span>
							<span class="shrink-0 text-g5">of</span>
							<a
								href="/?chain={swap.chain}&token={swap.token.address}"
								onclick={onnavigate}
								class="min-w-0 truncate font-semibold text-tx hover:underline"
							>{swap.token.symbol ?? shortAddress(swap.token.address)}</a>
							<span class="ml-auto shrink-0 pl-1 text-[10px] text-g5">{timeAgo(swap.timestamp, getNow())}</span>
						</div>
					{:else}
					<div class="absolute inset-x-0 border-b border-b-bd/40 [contain:layout_paint_style]" style="top: {(vl.start + i) * vl.stride}px">
						<div class="flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-wh/5">
							<div class="group/av relative h-7 w-7 shrink-0 self-start">
								<button
									onclick={() => openWallet(swap)}
									class="block cursor-pointer"
									title="{shortAddress(swap.walletAddress)} — open trader"
								>
									{@render sourceAvatar(swap.labels[0]?.photoId, swap.walletAddress, brandSource(swap.labels), 'h-7 w-7', 'h-3.5 w-3.5')}
								</button>
								{#if getIsLoggedIn()}
									{@const isFollowing = following.has(swap.walletAddress)}
									<button
										onclick={() => toggleFollow(swap)}
										disabled={followPending === swap.walletAddress}
										class="absolute -bottom-1 -right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full ring-1 ring-bd transition-colors disabled:opacity-50 md:h-4 md:w-4 md:hidden md:group-hover/av:flex {isFollowing ? 'bg-grn text-s0 hover:bg-red hover:text-s0' : 'bg-s7 text-tx hover:bg-grn hover:text-s0'}"
										title={isFollowing ? 'Unfollow this wallet' : 'Follow this wallet'}
									>
										{#if followPending === swap.walletAddress}
											<LoaderCircle class="h-2.5 w-2.5 animate-spin" />
										{:else if isFollowing}
											<Check class="h-2.5 w-2.5" strokeWidth={3} />
										{:else}
											<Plus class="h-2.5 w-2.5" strokeWidth={3} />
										{/if}
									</button>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-1.5">
									<button
										onclick={() => openWallet(swap)}
										class="max-w-[50%] shrink-0 cursor-pointer truncate text-[13px] font-semibold text-tx hover:underline"
										title={[who, shortAddress(swap.walletAddress), extraTag].filter(Boolean).join(' · ')}
									>{who}</button>
									{#if swap.labels[0]?.label}
										{#if extraTag}
											<span class="min-w-0 truncate rounded bg-s7 px-1 py-px text-[9px] font-medium text-g8" title={extraTag}>{extraTag}</span>
										{:else}
											<button type="button" class="cursor-pointer min-w-0 truncate font-mono text-[10px] text-g5 hover:underline" title={swap.walletAddress} onclick={() => openWallet(swap)}>{shortAddress(swap.walletAddress)}</button>
										{/if}
									{/if}
									<span class="ml-auto shrink-0 text-[13px] font-bold {buy ? 'text-grn' : 'text-red'}">{formatUsd(swap.amountUsd)}</span>
								</div>
								<div class="flex items-center gap-1 overflow-hidden">
									<span class="shrink-0 text-[10px] font-bold {buy ? 'text-grn' : 'text-red'}">{buy ? 'bought' : 'sold'}</span>
									<a
										href="/?chain={swap.chain}&token={swap.token.address}"
										onclick={onnavigate}
										class="min-w-0 truncate text-[11px] font-semibold text-tx hover:underline"
									>{swap.token.symbol ?? shortAddress(swap.token.address)}</a>
									<span class="ml-auto shrink-0 cursor-help text-[10px] text-g5" title={fullDateTime(swap.timestamp)}>
										{timeAgo(swap.timestamp, getNow())}
									</span>
								</div>
							</div>
							<a
								href="/?chain={swap.chain}&token={swap.token.address}"
								onclick={onnavigate}
								class="shrink-0"
								title={swap.token.symbol ?? shortAddress(swap.token.address)}
							>
								<img
									src={tokenImage(swap.chain, swap.token.address)}
									alt=""
									class="h-6 w-6 rounded-md ring-1 ring-bd"
									onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
								/>
							</a>
						</div>
					</div>
					{/if}
				{/each}
			</div>
		</div>
		</div>
	{/if}
	{/if}
</div>
