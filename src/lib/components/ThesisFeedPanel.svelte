<script lang="ts">
	// Theses: posts wallets made explaining why they bought a token. Cursor
	// paginated over REST, live over `wallets:thesis` / `wallets:thesis:personal`.
	import { untrack, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import Filter from 'lucide-svelte/icons/filter';
	import Heart from 'lucide-svelte/icons/heart';
	import PumpFunIcon from './PumpFunIcon.svelte';
	import FomoIcon from './FomoIcon.svelte';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import XIcon from 'lucide-svelte/icons/x';
	import { api, type QueryOf } from '$lib/api/client';
	import { tokenImage } from '$lib/api/config';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import type { Chain, ThesisItem, ThesisResponse, ThesisSource, WalletLabelSummary } from '$lib/api/types';
	import { formatUsd, timeAgo, fullDateTime, shortAddress, formatCompactCount, avatarUrl } from '$lib/utils/format';
	import { getWalletIconUrl } from '$lib/utils/walleticon';
	import { getNow } from '$lib/stores/tick.svelte';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { openTraderOverview } from '$lib/stores/traderAnalytics.svelte';
	import { createCoalescer } from '$lib/utils/coalesce';
	import { VirtualList } from '$lib/utils/virtual.svelte';
	import WalletManagePanel from './WalletManagePanel.svelte';
	import Users from 'lucide-svelte/icons/users';
	import { parseThesisText } from '$lib/utils/thesis';
	import { mergeLabelSuggestions } from '$lib/utils/wallet-labels';

	let {
		active = true,
		chain = 'SOL',
		tokenAddress = '',
		compact = false,
		onnavigate = () => {},
		oncount = (_count: number | null) => {}
	}: {
		active?: boolean;
		chain?: string;
		/** Scope to one token, e.g. the token header popover. */
		tokenAddress?: string;
		/** Chrome-free: the host supplies the filters. */
		compact?: boolean;
		onnavigate?: () => void;
		oncount?: (count: number | null) => void;
	} = $props();

	/** Live prepend ceiling. */
	const MAX_THESES = 500;
	/** Paging ceiling: rows are windowed, but the array itself is not free. */
	const MAX_LOADED_THESES = 2000;
	const SOURCES: { id: ThesisSource; label: string }[] = [
		{ id: 'FOMO', label: 'FOMO' },
		{ id: 'PUMPFUN', label: 'Pump.fun' }
	];

	let theses = $state.raw<ThesisItem[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let nextCursor = $state<string | undefined>(undefined);
	let totalCount = $state<number | null>(null);
	let feedMode = $state<'all' | 'mine'>('all');
	let minMarketcapUsd = $state('');
	let selectedSources = $state<Set<ThesisSource>>(new Set());
	let showFilters = $state(false);
	// Following is what fills `wallets:thesis:personal`, so the same directory
	// screen the swaps feed uses belongs here too.
	let view = $state<'feed' | 'manage'>('feed');
	/** Comma separated on REST, an array on the WS — same as the swaps feed. */
	let selectedLabels = $state<Set<string>>(new Set());
	let labelInput = $state('');
	let labelSuggestions = $state.raw<WalletLabelSummary[]>([]);
	let labelSearching = $state(false);
	let labelRequest = 0;
	let labelDebounce: ReturnType<typeof setTimeout> | undefined;

	/** Typeahead over the shared label vocabulary; there are far too many to list. */
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
			const { data } = (await api.GET('/v2/wallets/labels', {
				params: { query: { query: q } }
			} as never)) as { data?: { labels?: WalletLabelSummary[] } };
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
	let wsKey: string | null = null;
	/** The ack that follows our own subscribe must not repeat the load we just did. */
	let skipAckLoad = false;
	let loadRequest = 0;
	const seen = new Set<string>();
	/**
	 * `subscribed` is present on authed REST rows but ABSENT on the broadcast
	 * `wallets:thesis` stream, so reading it per row would badge the seed and never
	 * the live rows. Accumulate the wallets we have been told about instead.
	 */
	let followedWallets = $state<Set<string>>(new Set());

	function applySubscribedFlags(rows: readonly ThesisItem[]) {
		let changed = false;
		for (const row of rows) {
			const wallet = row.walletAddress;
			if (!wallet) continue;
			if (row.subscribed === true && !followedWallets.has(wallet)) {
				followedWallets.add(wallet);
				changed = true;
			} else if (row.subscribed === false && followedWallets.delete(wallet)) {
				changed = true;
			}
		}
		if (changed) followedWallets = new Set(followedWallets);
	}
	const filterCount = $derived(selectedSources.size + (minMarketcapUsd.trim() ? 1 : 0) + selectedLabels.size);

	const vl = new VirtualList({ estimate: 96, gap: 0, overscan: 6, measured: true });
	$effect(() => {
		vl.keys = theses.map((t) => t.id);
	});

	const thesisCoalescer = createCoalescer<ThesisItem>((batch) => {
		if (batch.length === 0) return;
		// `seen` is only a cheap pre-filter — a re-seed clears it while frames are
		// still buffered, so the rendered rows are the authority here. Duplicate
		// ids would break the keyed each, not merely show a row twice.
		const present = new Set(theses.map((item) => item.id));
		const fresh: ThesisItem[] = [];
		for (const item of batch) {
			if (present.has(item.id)) continue;
			present.add(item.id);
			fresh.push(item);
		}
		if (fresh.length === 0) return;
		// Live prepends drop the tail: paged history is re-fetchable, and an
		// unbounded array is the one thing windowing does not save you from.
		theses = [...fresh.reverse(), ...theses].slice(0, MAX_LOADED_THESES);
		applySubscribedFlags(fresh);
		pruneSeen();
	}, { maxBatch: 100 });

	/** `seen` only has to cover what is still rendered. */
	function pruneSeen() {
		if (seen.size <= theses.length + MAX_THESES) return;
		seen.clear();
		for (const item of theses) seen.add(item.id);
	}

	function restQuery(cursor?: string): QueryOf<'/v2/wallets/thesis'> {
		const q: QueryOf<'/v2/wallets/thesis'> = { chain: chain as Chain };
		if (tokenAddress) q.tokenAddress = tokenAddress;
		if (feedMode === 'mine') q.curated = true;
		if (selectedSources.size > 0) q.sources = [...selectedSources].sort();
		if (selectedLabels.size > 0) q.labels = [...selectedLabels].sort();
		const floor = Number(minMarketcapUsd);
		if (minMarketcapUsd.trim() && Number.isFinite(floor) && floor > 0) q.minMarketcapUsd = floor;
		if (cursor) q.cursor = cursor;
		return q;
	}

	async function load(cursor?: string) {
		const request = ++loadRequest;
		if (cursor) loadingMore = true;
		else loading = true;
		try {
			const { data } = (await api.GET('/v2/wallets/thesis', {
				params: { query: restQuery(cursor) }
			})) as { data?: ThesisResponse };
			if (request !== loadRequest) return;
			const rows = data?.theses ?? [];
			if (cursor) {
				const present = new Set(theses.map((item) => item.id));
				const page = rows.filter((row) => !present.has(row.id));
				theses = [...theses, ...page].slice(0, MAX_LOADED_THESES);
			} else {
				seen.clear();
				theses = rows;
			}
			for (const row of rows) seen.add(row.id);
			applySubscribedFlags(rows);
			pruneSeen();
			nextCursor = data?.nextCursor;
			totalCount = data?.totalCount ?? null;
			oncount(totalCount);
		} catch {
			if (request === loadRequest && !cursor) theses = [];
		} finally {
			if (request === loadRequest) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	/**
	 * Broadcast frames arrive on the bare `wallets:thesis` topic even for a
	 * filtered subscription — the canonical suffix is echoed on the ACK but not on
	 * the frames, so a token-scoped subscriber is handed every thesis. Re-apply the
	 * filters here or the live rows contradict both the seed and the filter UI.
	 */
	function matchesFilters(item: ThesisItem): boolean {
		if (tokenAddress && item.token.address !== tokenAddress) return false;
		if (chain && item.chain !== chain) return false;
		if (selectedSources.size > 0 && !(item.source && selectedSources.has(item.source))) return false;
		if (selectedLabels.size > 0) {
			const wanted = [...selectedLabels].map((l) => l.toLowerCase());
			const has = (item.labels ?? []).some((l) => wanted.includes(l.label.toLowerCase()));
			if (!has) return false;
		}
		const floor = Number(minMarketcapUsd);
		if (minMarketcapUsd.trim() && Number.isFinite(floor) && floor > 0) {
			const mc = Number(item.marketcapUsd ?? 0);
			if (!Number.isFinite(mc) || mc < floor) return false;
		}
		return true;
	}

	function setupWs() {
		if (wsKey) {
			unsubscribe(wsKey);
			wsKey = null;
		}
		if (!active) return;
		thesisCoalescer.clear();
		skipAckLoad = true;
		// `curated` is not a subscribe param: the personal topic IS the curated feed.
		const topic = feedMode === 'mine' ? 'wallets:thesis:personal' : 'wallets:thesis';
		const params: Record<string, unknown> = {};
		if (tokenAddress) params.tokenAddress = tokenAddress;
		params.chains = [chain];
		if (selectedSources.size > 0) params.sources = [...selectedSources].sort();
		if (selectedLabels.size > 0) params.labels = [...selectedLabels].sort();
		const floor = Number(minMarketcapUsd);
		if (minMarketcapUsd.trim() && Number.isFinite(floor) && floor > 0) params.minMarketcapUsd = floor;
		wsKey = subscribe(
			topic,
			(event, data) => {
				if (event !== 'THESIS' || !data) return;
				const item = data as ThesisItem;
				if (!matchesFilters(item)) return;
				if (seen.has(item.id)) return;
				seen.add(item.id);
				thesisCoalescer.push(item);
			},
			// An unfiltered subscription sends no params at all rather than `{}`,
			// which is a distinct wire shape the server may treat differently.
			Object.keys(params).length > 0 ? params : undefined,
			{
				onSubscribed: () => {
					// Reconnects still refetch; the initial ack does not.
					if (skipAckLoad) {
						skipAckLoad = false;
						return;
					}
					void load();
				}
			}
		);
	}

	let loadKey = '';

	$effect(() => {
		const isActive = active;
		const key = JSON.stringify([
			chain,
			tokenAddress,
			feedMode,
			[...selectedSources].sort(),
			minMarketcapUsd.trim(),
			[...selectedLabels].sort()
		]);
		if (!isActive) {
			untrack(() => {
				if (wsKey) {
					unsubscribe(wsKey);
					wsKey = null;
				}
				thesisCoalescer.clear();
			});
			loadKey = '';
			return;
		}
		if (key === loadKey) return;
		loadKey = key;
		untrack(() => {
			void load();
			setupWs();
		});
	});

	onDestroy(() => {
		clearTimeout(labelDebounce);
		if (wsKey) unsubscribe(wsKey);
		thesisCoalescer.dispose();
	});

	function onScroll(el: HTMLElement) {
		vl.handleScroll(el);
		if (!nextCursor || loadingMore || loading) return;
		if (theses.length >= MAX_LOADED_THESES) return;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) void load(nextCursor);
	}

	function openWallet(item: ThesisItem) {
		if (!item.walletAddress) return;
		openTraderOverview({
			chain: item.chain as Chain,
			walletAddress: item.walletAddress,
			token: {
				address: item.token.address,
				chain: item.chain as Chain,
				decimals: 6,
				name: item.token.name ?? '',
				symbol: item.token.symbol ?? ''
			}
		});
	}

	function openToken(item: ThesisItem) {
		onnavigate();
		goto(`/?chain=${item.chain}&token=${item.token.address}`);
	}

	function toggleSource(id: ThesisSource) {
		const next = new Set(selectedSources);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedSources = next;
	}
</script>

{#snippet sourceAvatar(
	photoId: string | null | undefined,
	wallet: string | null | undefined,
	source: ThesisSource | null | undefined,
	box: string,
	badge: string
)}
	<div class="relative {box} shrink-0">
		{#if photoId && avatarUrl(photoId)}
			<img src={avatarUrl(photoId)} alt="" class="{box} rounded-full object-cover ring-1 ring-bd" loading="lazy" />
		{:else if wallet}
			<img src={getWalletIconUrl(wallet)} alt="" class="{box} rounded-full ring-1 ring-bd" loading="lazy" />
		{:else}
			<div class="{box} rounded-full bg-s4 ring-1 ring-bd"></div>
		{/if}
		{#if source === 'PUMPFUN' || source === 'FOMO'}
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

{#snippet sourceMark(id: ThesisSource, size: string)}
	{#if id === 'FOMO'}
		<FomoIcon class={size} />
	{:else}
		<PumpFunIcon class={size} />
	{/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	{#if view === 'manage'}
		<WalletManagePanel
			onback={() => (view = 'feed')}
			onfollowchange={() => {
				// The followed set defines the `:personal` room; re-seed if we are in it.
				if (feedMode === 'mine') {
					seen.clear();
					loadKey = '';
					void load();
					setupWs();
				}
			}}
		/>
	{:else}
	{#if !compact}
		<div class="flex shrink-0 items-center gap-1 border-b border-bd/40 px-2 py-1.5">
			<button
				onclick={() => (showFilters = !showFilters)}
				class="relative shrink-0 cursor-pointer p-1.5 transition-colors md:p-0.5 {showFilters ? 'text-tx' : filterCount > 0 ? 'text-grn' : 'text-g4 hover:text-tx'}"
				title="Filter theses"
			>
				<Filter class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
				{#if filterCount > 0}
					<span class="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-grn px-0.5 text-[8px] font-bold text-s0">{filterCount}</span>
				{/if}
			</button>
			{#if getIsLoggedIn()}
				{#each [{ id: 'all' as const, label: 'All' }, { id: 'mine' as const, label: 'Mine' }] as mode}
					<button
						onclick={() => (feedMode = mode.id)}
						class="cursor-pointer rounded px-2.5 py-1 text-[11px] font-semibold transition-colors md:px-1.5 md:py-px md:text-[10px] {feedMode === mode.id ? 'bg-grn/20 text-grn' : 'bg-s4 text-g5 hover:text-g8'}"
					>{mode.label}</button>
				{/each}
			{/if}
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{#if totalCount !== null}
					<span class="text-[10px] text-g5">{totalCount}</span>
				{/if}
				{#if getIsLoggedIn()}
					<button
						onclick={() => (view = 'manage')}
						class="cursor-pointer p-1.5 text-g4 transition-colors hover:text-tx md:p-0.5"
						title="Manage followed wallets"
					>
						<Users class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
					</button>
				{/if}
			</div>
		</div>

		{#if showFilters}
			<div class="flex shrink-0 flex-col gap-1.5 border-b border-bd/40 px-2 py-1.5">
				<div class="flex flex-wrap items-center gap-1">
					<span class="mr-0.5 text-[10px] font-medium uppercase tracking-wider text-g5">Platform</span>
					{#each SOURCES as src}
						<button
							onclick={() => {
								const next = new Set(selectedSources);
								if (next.has(src.id)) next.delete(src.id);
								else next.add(src.id);
								selectedSources = next;
							}}
							class="flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors md:px-1.5 md:py-px md:text-[10px] {selectedSources.has(src.id) ? 'bg-grn/20 text-grn' : 'bg-s4 text-g6 hover:text-g9'}"
						>
							{@render sourceMark(src.id, 'h-3 w-3 md:h-2.5 md:w-2.5')}
							{src.label}
						</button>
					{/each}
				</div>
				<div class="flex items-center gap-1">
					<span class="shrink-0 text-[10px] font-medium uppercase tracking-wider text-g5">User</span>
					{#each [...selectedLabels] as label}
						<button
							onclick={() => removeLabel(label)}
							class="flex cursor-pointer items-center gap-0.5 rounded bg-grn/20 px-2.5 py-1 text-[11px] font-medium text-grn md:px-1.5 md:py-px md:text-[10px]"
							title="Remove"
						>
							{label}
							<XIcon class="h-2 w-2" strokeWidth={3} />
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
							placeholder={selectedLabels.size > 0 ? 'add another…' : 'search labels…'}
							aria-label="Filter by author label"
							class="w-full rounded border border-bd bg-s4 px-1.5 py-1.5 text-[11px] text-tx outline-none placeholder:text-g4 md:px-1 md:py-px md:text-[10px]"
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
											<span class="min-w-0 flex-1 truncate text-[10px] text-tx">{sug.label}</span>
											<span class="shrink-0 text-[9px] text-g5">{formatCompactCount(sug.walletCount)}</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
					<span class="shrink-0 text-[10px] font-medium uppercase tracking-wider text-g5">Min MC</span>
					<input
						type="text"
						inputmode="decimal"
						bind:value={minMarketcapUsd}
						placeholder="any"
						aria-label="Minimum market cap at post time"
						class="w-16 shrink-0 rounded border border-bd bg-s4 px-1.5 py-1.5 text-[11px] text-tx outline-none placeholder:text-g4 md:px-1 md:py-px md:text-[10px]"
					/>
					{#if filterCount > 0}
						<button
							onclick={() => { selectedSources = new Set(); minMarketcapUsd = ''; selectedLabels = new Set(); }}
							class="shrink-0 cursor-pointer px-1 text-[10px] text-g4 hover:text-g8"
						>clear</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}

	{#if loading && theses.length === 0}
		<!-- Same cap as the loaded list, or the popover shrinks when data lands. -->
		<div class="space-y-1 overflow-hidden p-2 {compact ? 'md:max-h-[380px]' : ''}">
			{#each Array(compact ? 3 : 5) as _}
				<div class="skeleton h-[88px] rounded-lg"></div>
			{/each}
		</div>
	{:else if theses.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
			<span class="text-xs text-g5">
				{feedMode === 'mine' ? 'No theses from wallets you follow' : 'No theses yet'}
			</span>
			<span class="text-[10px] text-g4">Posts explaining why wallets bought show up here</span>
		</div>
	{:else}
		<div
			class="flex-1 overflow-y-auto {compact ? 'md:max-h-[380px]' : ''}"
			onscroll={(e) => onScroll(e.currentTarget)}
			use:vl.viewport_
		>
			<div class="relative" style="height: {vl.totalHeight}px">
				{#each theses.slice(vl.start, vl.end) as item, i (item.id)}
					{@const who = item.username || item.labels[0]?.label || (item.walletAddress ? shortAddress(item.walletAddress) : 'Unknown')}
					{@const ticker = item.token.symbol ?? ''}
					<div class="absolute inset-x-0" style="top: {vl.offsetOf(vl.start + i)}px" use:vl.measureRow={item.id}>
						<article class="border-b border-bd/40 px-2.5 py-2 [contain:layout_paint_style]">
							<!-- Header: who posted, and which token. The body below spans the
							     full width — a side rail squeezed long theses into a column. -->
							<div class="flex items-center gap-2">
								<button
									onclick={() => openWallet(item)}
									class="shrink-0 {item.walletAddress ? 'cursor-pointer' : 'cursor-default'}"
									title={item.walletAddress ? `${who} — open trader` : who}
								>
									{@render sourceAvatar(item.labels[0]?.photoId, item.walletAddress, item.source, 'h-7 w-7', 'h-3.5 w-3.5')}
								</button>
								<div class="flex min-w-0 flex-1 flex-col">
									<button
										onclick={() => openWallet(item)}
										class="min-w-0 truncate text-left text-[14px] font-semibold text-tx md:text-[13px] {item.walletAddress ? 'cursor-pointer hover:underline' : 'cursor-default'}"
										title="{who}{item.walletAddress ? ` · ${shortAddress(item.walletAddress)}` : ''}{item.walletAddress && followedWallets.has(item.walletAddress) ? ' · Following' : ''}"
									>{who}</button>
									{#if item.username && item.walletAddress}
										<span class="truncate font-mono text-[11px] text-g5 md:text-[10px]" title={item.walletAddress}>
											{shortAddress(item.walletAddress)}
										</span>
									{/if}
								</div>
								<button
									onclick={() => openToken(item)}
									class="flex max-w-[45%] shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-s4 px-1.5 py-1 transition-colors hover:bg-s7"
									title="Open {item.token.name ?? (ticker || shortAddress(item.token.address))}"
								>
									<img
										src={tokenImage(item.chain, item.token.address)}
										alt=""
										class="h-5 w-5 shrink-0 rounded ring-1 ring-bd"
										onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
									/>
									<span class="min-w-0 truncate text-[12px] font-semibold text-tx md:text-[11px]">
										{ticker || shortAddress(item.token.address)}
									</span>
									{#if item.marketcapUsd}
										<span class="shrink-0 text-[10px] text-g5" title="Market cap when posted">
											{formatUsd(item.marketcapUsd)}
										</span>
									{/if}
								</button>
							</div>

							<!-- The thesis itself is the point, so it gets the full width. -->
							<p class="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-g9 md:text-[12px] md:leading-snug">
								{#each parseThesisText(item.text) as segment}
									{#if segment.kind === 'mention'}
										<span class="font-medium text-blu-light">@{segment.value}</span>
									{:else}{segment.value}{/if}
								{/each}
							</p>

							<div class="mt-1 flex items-center gap-2 text-[11px] text-g5 md:text-[10px]">
								{#if item.likes > 0}
									<span class="flex items-center gap-0.5">
										<Heart class="h-3 w-3" strokeWidth={2} />
										{item.likes}
									</span>
								{/if}
								<span class="ml-auto cursor-help" title={fullDateTime(item.createdAtTimestamp)}>
									{timeAgo(item.createdAtTimestamp, getNow())}
								</span>
							</div>
						</article>
					</div>
				{/each}
			</div>
			{#if loadingMore}
				<div class="flex items-center justify-center py-2"><LoaderCircle class="h-3 w-3 animate-spin text-g5" /></div>
			{/if}
		</div>
	{/if}
	{/if}
</div>
