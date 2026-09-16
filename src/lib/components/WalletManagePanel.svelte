<script lang="ts">
	// Browse the labeled-wallet directory and choose which wallets to follow.
	// Following is what builds the `wallets:personal` rooms, so both the swaps and
	// thesis feeds need this exact screen — it lives here rather than in either.
	import { onDestroy } from 'svelte';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Search from 'lucide-svelte/icons/search';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import { api } from '$lib/api/client';
	import type { Chain, LabeledWallet, LabeledWalletsResponse, WalletLabelSource } from '$lib/api/types';
	import { shortAddress, avatarUrl } from '$lib/utils/format';
	import { getWalletIconUrl } from '$lib/utils/walleticon';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { VirtualList } from '$lib/utils/virtual.svelte';
	import FomoIcon from './FomoIcon.svelte';

	let {
		onback,
		onfollowchange = () => {}
	}: {
		onback: () => void;
		/** Lets the host re-seed: the followed set defines its `:personal` room. */
		onfollowchange?: (wallet: string, following: boolean) => void;
	} = $props();

	/** Paging ceiling; the list is windowed, the array is not. */
	const MAX_MANAGE_ROWS = 2000;

	let rows = $state.raw<LabeledWallet[]>([]);
	let cursor = $state<string | undefined>(undefined);
	let total = $state<number | null>(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let tab = $state<'browse' | 'following'>('browse');
	let search = $state('');
	let following = $state<Set<string>>(new Set());
	let followPending = $state<string | null>(null);
	/** Guards against a slow page landing after the query/tab moved on. */
	let request = 0;
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	const vl = new VirtualList({ estimate: 41, gap: 0, overscan: 8 });
	$effect(() => {
		vl.count = rows.length;
	});

	function brandSource(labels: { source?: WalletLabelSource | null }[] | undefined): 'FOMO' | 'PUMPFUN' | null {
		if (!labels?.length) return null;
		if (labels.some((l) => l.source === 'FOMO')) return 'FOMO';
		if (labels.some((l) => l.source === 'PUMPFUN')) return 'PUMPFUN';
		return null;
	}

	async function load(next?: string) {
		const req = ++request;
		if (next) loadingMore = true;
		else loading = true;
		try {
			const query: Record<string, unknown> = {};
			const q = search.trim();
			if (q) query.query = q;
			if (next) query.cursor = next;
			const path = tab === 'following' ? '/v2/wallets/subscriptions' : '/v2/wallets/labeled';
			const { data } = (await api.GET(path as '/v2/wallets/labeled', {
				params: { query }
			} as never)) as { data?: LabeledWalletsResponse };
			if (req !== request) return;
			const page = data?.wallets ?? [];
			rows = next ? [...rows, ...page].slice(0, MAX_MANAGE_ROWS) : page;
			cursor = data?.nextCursor;
			total = data?.totalCount ?? null;
			// Everything on the Following tab is followed by definition.
			if (tab === 'following') {
				for (const w of page) following.add(w.walletAddress);
				following = new Set(following);
			}
		} catch {
			if (req === request && !next) rows = [];
		} finally {
			if (req === request) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	async function loadFollowing() {
		try {
			const { data } = await api.GET('/v2/wallets/subscriptions');
			for (const w of data?.wallets ?? []) following.add(w.walletAddress);
			following = new Set(following);
		} catch {}
	}

	function setTab(next: 'browse' | 'following') {
		if (tab === next) return;
		tab = next;
		void load();
	}

	function onSearchInput(value: string) {
		search = value;
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => void load(), 250);
	}

	function onScroll(el: HTMLElement) {
		vl.handleScroll(el);
		if (!cursor || loadingMore || loading) return;
		if (rows.length >= MAX_MANAGE_ROWS) return;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) void load(cursor);
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
			onfollowchange(wallet, !wasFollowing);
		} catch {
			const revert = new Set(following);
			if (wasFollowing) revert.add(wallet);
			else revert.delete(wallet);
			following = revert;
		} finally {
			followPending = null;
		}
	}

	$effect(() => {
		void load();
		void loadFollowing();
	});

	onDestroy(() => clearTimeout(searchDebounce));
</script>

{#snippet walletAvatar(photoId: string | null | undefined, wallet: string, source: 'FOMO' | 'PUMPFUN' | null)}
	<div class="relative h-6 w-6 shrink-0">
		{#if photoId && avatarUrl(photoId)}
			<img src={avatarUrl(photoId)} alt="" class="h-6 w-6 rounded-full object-cover ring-1 ring-bd" loading="lazy" />
		{:else}
			<img src={getWalletIconUrl(wallet)} alt="" class="h-6 w-6 rounded-full ring-1 ring-bd" loading="lazy" />
		{/if}
		{#if source}
			<span
				class="absolute -bottom-1 -left-1 flex h-3 w-3 items-center justify-center overflow-hidden rounded-full bg-s6 ring-1 ring-s6"
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

<div class="flex shrink-0 items-center gap-2 border-b border-bd px-2 py-1.5">
	<button
		onclick={onback}
		class="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-tx transition-colors hover:text-g8"
	>
		<ArrowLeft class="h-3 w-3" /> Manage Wallets
	</button>
</div>
<div class="flex shrink-0 items-center gap-1.5 border-b border-bd p-2">
	<div class="flex gap-0.5 rounded-md bg-s4 p-0.5">
		<button
			onclick={() => setTab('browse')}
			class="cursor-pointer rounded px-3 py-1.5 text-[11px] font-semibold transition-colors md:px-2 md:py-0.5 md:text-[10px] {tab === 'browse' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
		>Browse</button>
		<button
			onclick={() => setTab('following')}
			class="cursor-pointer rounded px-3 py-1.5 text-[11px] font-semibold transition-colors md:px-2 md:py-0.5 md:text-[10px] {tab === 'following' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
		>Following{tab === 'following' && total !== null ? ` (${total})` : ''}</button>
	</div>
	<div class="relative min-w-0 flex-1">
		<Search class="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-g4" />
		<input
			type="text"
			value={search}
			oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
			placeholder="Search address or label..."
			class="w-full rounded-lg border border-bd bg-s4 py-2 pl-7 pr-2 text-[12px] text-tx outline-none placeholder:text-g4 md:py-1 md:text-[11px]"
		/>
	</div>
</div>
<div class="min-h-0 flex-1 overflow-y-auto" onscroll={(e) => onScroll(e.currentTarget)} use:vl.viewport_>
	{#if loading && rows.length === 0}
		<div class="flex justify-center py-4"><LoaderCircle class="h-4 w-4 animate-spin text-g5" /></div>
	{:else if rows.length === 0}
		<div class="flex h-20 items-center justify-center px-4 text-center text-[11px] text-g5">
			{search
				? 'No wallets found'
				: tab === 'following'
					? 'Not following any wallets yet — add some from Browse'
					: 'No labeled wallets'}
		</div>
	{:else}
		<div class="relative" style="height: {vl.totalHeight}px">
			{#each rows.slice(vl.start, vl.end) as w, i (w.chain + w.walletAddress)}
				{@const isFollowing = following.has(w.walletAddress)}
				<div
					class="absolute inset-x-0 flex items-center gap-2 border-b border-bd/40 px-3 py-1.5 [contain:layout_paint_style]"
					style="top: {(vl.start + i) * vl.stride}px"
				>
					{@render walletAvatar(w.labels[0]?.photoId, w.walletAddress, brandSource(w.labels))}
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1 overflow-hidden">
							{#each w.labels.slice(0, 2) as label}
								<span
									class="flex shrink-0 items-center rounded bg-s7 px-1 py-px text-[9px] font-medium text-g8"
									title={label.source ? `${label.label} — via ${label.source}` : label.label}
								>
									{label.label}
								</span>
							{/each}
						</div>
						<div class="truncate text-[10px] text-g5">{shortAddress(w.walletAddress)}</div>
					</div>
					<button
						onclick={() => toggleFollow(w)}
						disabled={followPending === w.walletAddress}
						class="{isFollowing ? 'btn-secondary' : 'btn-primary'} shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50 md:px-2 md:py-0.5 md:text-[10px]"
					>
						{isFollowing ? 'Following' : 'Follow'}
					</button>
				</div>
			{/each}
		</div>
		{#if loadingMore}
			<div class="flex items-center justify-center py-2"><LoaderCircle class="h-3 w-3 animate-spin text-g5" /></div>
		{/if}
	{/if}
</div>
