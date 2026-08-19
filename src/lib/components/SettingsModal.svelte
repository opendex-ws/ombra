<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import { api } from '$lib/api/client';
	import type { WatchlistSourceItem } from '$lib/api/types';
	import { isUsd, toggleCurrency } from '$lib/stores/currency.svelte';
	import {
		getExpandPositions, toggleExpandPositions,
		getBubbleWatchlist, toggleBubbleWatchlist,
		getMultiTab, toggleMultiTab,
		isCallToastSourceEnabled, toggleCallToastSource
	} from '$lib/stores/feSettings.svelte';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import X from 'lucide-svelte/icons/x';
	import Coins from 'lucide-svelte/icons/coins';
	import DollarSign from 'lucide-svelte/icons/dollar-sign';
	import Smartphone from 'lucide-svelte/icons/smartphone';
	import Rows3 from 'lucide-svelte/icons/rows-3';
	import CircleDot from 'lucide-svelte/icons/circle-dot';
	import Columns3 from 'lucide-svelte/icons/columns-3';
	import Bell from 'lucide-svelte/icons/bell';
	import LogOut from 'lucide-svelte/icons/log-out';
	import { siTelegram } from 'simple-icons';
	import Wallet from 'lucide-svelte/icons/wallet';
	import List from 'lucide-svelte/icons/list';

	let { show = $bindable(false), onConnectMobile, onDisconnect }: {
		show?: boolean;
		onConnectMobile?: () => void;
		onDisconnect?: () => void;
	} = $props();

	function close() { show = false; }

	// --- Call-toast source catalog ------------------------------------------
	type Family = 'tg' | 'lists' | 'wallets';
	type SourceRow = { id: string; name: string; family: Family };
	const familyMeta: Record<Family, { label: string; path: '/v2/watchlist/sources/tg' | '/v2/watchlist/sources/lists' | '/v2/watchlist/sources/wallets'; wantType: 'TG' | 'LIST' | 'WALLET' }> = {
		tg: { label: 'Telegram', path: '/v2/watchlist/sources/tg', wantType: 'TG' },
		lists: { label: 'Lists', path: '/v2/watchlist/sources/lists', wantType: 'LIST' },
		wallets: { label: 'Wallets', path: '/v2/watchlist/sources/wallets', wantType: 'WALLET' }
	};

	let sources = $state<SourceRow[]>([]);
	let loadingSources = $state(false);
	let sourcesFetched = $state(false);

	async function fetchFamily(family: Family): Promise<SourceRow[]> {
		const rows: SourceRow[] = [];
		let cursor: string | undefined;
		const seen = new Set<string>();
		do {
			const { data } = await api.GET(familyMeta[family].path, {
				params: { query: cursor ? { cursor } : {} }
			});
			for (const s of (data?.sources ?? []) as WatchlistSourceItem[]) {
				if ((s as { type?: string }).type !== familyMeta[family].wantType) continue;
				const id = (s as { id?: string }).id;
				const name = (s as { name?: string }).name;
				if (!id) continue;
				rows.push({ id: `${family}:${id}`, name: name || id, family });
			}
			const next = data?.nextCursor ?? undefined;
			if (!next || seen.has(next)) break;
			seen.add(next);
			cursor = next;
		} while (cursor);
		return rows;
	}

	async function loadSources() {
		if (!getIsLoggedIn()) return;
		loadingSources = true;
		try {
			const [tg, lists, wallets] = await Promise.all([
				fetchFamily('tg').catch(() => [] as SourceRow[]),
				fetchFamily('lists').catch(() => [] as SourceRow[]),
				fetchFamily('wallets').catch(() => [] as SourceRow[])
			]);
			sources = [...tg, ...lists, ...wallets];
		} finally {
			loadingSources = false;
			sourcesFetched = true;
		}
	}

	$effect(() => {
		if (show && !sourcesFetched && getIsLoggedIn()) void loadSources();
	});

	const byFamily = $derived.by(() => {
		const map: Record<Family, SourceRow[]> = { tg: [], lists: [], wallets: [] };
		for (const s of sources) map[s.family].push(s);
		return map;
	});

	function familyIcon(family: Family) {
		return family === 'wallets' ? Wallet : family === 'lists' ? List : null;
	}
</script>

{#if show}
<div use:portal class="fixed inset-0 z-[200] flex items-start justify-center bg-s0/60 p-4 pt-[8vh] backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={(e) => { if (e.key === 'Escape') close(); }}>
	<div class="animate-fade-in flex max-h-[84vh] w-full max-w-md flex-col rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl">
		<div class="flex shrink-0 items-center justify-between border-b border-bd px-5 py-3.5">
			<span class="text-sm font-bold text-tx">Settings</span>
			<button onclick={close} class="cursor-pointer text-g4 transition-colors hover:text-tx" aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>

		<div class="flex min-h-0 flex-1 flex-col p-3">
			<!-- General -->
			<div class="shrink-0 space-y-1">
				<button onclick={toggleCurrency} class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-tx transition-all hover:bg-s7">
					{#if isUsd()}
						<Coins size={16} strokeWidth={1.5} class="text-g5" />
						<div class="flex-1 text-left"><div>Show as Native</div><div class="text-[10px] text-g5">Display values in SOL, ETH, BNB</div></div>
					{:else}
						<DollarSign size={16} strokeWidth={1.5} class="text-g5" />
						<div class="flex-1 text-left"><div>Show as USD</div><div class="text-[10px] text-g5">Display values in US dollars</div></div>
					{/if}
					<span class="rounded bg-s7 px-1.5 py-0.5 text-[10px] text-g6">{isUsd() ? 'USD' : 'Native'}</span>
				</button>

				{#if getIsLoggedIn()}
					<button onclick={() => { close(); onConnectMobile?.(); }} class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-tx transition-all hover:bg-s7">
						<Smartphone size={16} strokeWidth={1.5} class="text-g5" />
						<div class="flex-1 text-left"><div>Connect Mobile</div><div class="text-[10px] text-g5">Scan QR to link your phone</div></div>
					</button>
				{/if}

				<button onclick={toggleExpandPositions} class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-tx transition-all hover:bg-s7">
					<Rows3 size={16} strokeWidth={1.5} class="text-g5" />
					<div class="flex-1 text-left"><div>Expand Positions</div><div class="text-[10px] text-g5">Show position details by default</div></div>
					<span class="rounded bg-s7 px-1.5 py-0.5 text-[10px] text-g6">{getExpandPositions() ? 'On' : 'Off'}</span>
				</button>

				<button onclick={toggleBubbleWatchlist} class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-tx transition-all hover:bg-s7">
					<CircleDot size={16} strokeWidth={1.5} class="text-g5" />
					<div class="flex-1 text-left"><div class="flex items-center gap-1.5">Bubble Watchlist <span class="rounded bg-blu/20 px-1 py-px text-[8px] font-bold uppercase text-blu-light">Beta</span></div><div class="text-[10px] text-g5">Group calls into token bubbles</div></div>
					<span class="rounded bg-s7 px-1.5 py-0.5 text-[10px] text-g6">{getBubbleWatchlist() ? 'On' : 'Off'}</span>
				</button>

				<button onclick={toggleMultiTab} class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-tx transition-all hover:bg-s7">
					<Columns3 size={16} strokeWidth={1.5} class="text-g5" />
					<div class="flex-1 text-left"><div class="flex items-center gap-1.5">Multi-Tab Tokens <span class="rounded bg-blu/20 px-1 py-px text-[8px] font-bold uppercase text-blu-light">Beta</span></div><div class="text-[10px] text-g5">Open tokens in tabs instead of replacing</div></div>
					<span class="rounded bg-s7 px-1.5 py-0.5 text-[10px] text-g6">{getMultiTab() ? 'On' : 'Off'}</span>
				</button>
			</div>

			<!-- Call notifications -->
			{#if getIsLoggedIn()}
				<div class="mt-4 flex min-h-0 flex-1 flex-col border-t border-bd pt-3">
					<div class="flex shrink-0 items-center gap-2 px-3 pb-1">
						<Bell size={14} strokeWidth={1.5} class="text-g5" />
						<span class="text-xs font-semibold text-tx">Call Notifications</span>
					</div>
					<p class="shrink-0 px-3 pb-2 text-[10px] leading-snug text-g5">Get a clickable toast when a selected source calls a token.</p>

					{#if loadingSources}
						<div class="px-3 py-4 text-center text-[11px] text-g5">Loading sources…</div>
					{:else if sources.length === 0}
						<div class="px-3 py-4 text-center text-[11px] text-g5">No Telegram, list, or wallet sources configured. Add them in the watchlist.</div>
					{:else}
						<!-- Each family is a generously-tall pane that scrolls internally only
						     when its list overflows; the section scrolls if all three together
						     exceed the modal. -->
						<div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
							{#each (['tg', 'lists', 'wallets'] as const) as family}
								{#if byFamily[family].length > 0}
									{@const Icon = familyIcon(family)}
									<div class="flex flex-col">
										<div class="mb-1 flex shrink-0 items-center gap-1.5 px-3 text-[10px] font-medium uppercase tracking-wider text-g5">
											{#if family === 'tg'}<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siTelegram.path}/></svg>{:else if Icon}<Icon size={12} strokeWidth={1.5} />{/if}
											{familyMeta[family].label}
											<span class="ml-auto rounded bg-s7 px-1 py-px text-[9px] text-g6">{byFamily[family].length}</span>
										</div>
										<div class="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-bd/50 bg-s0/30 p-0.5">
											{#each byFamily[family] as src (src.id)}
												{@const enabled = isCallToastSourceEnabled(src.id)}
												<button onclick={() => toggleCallToastSource(src.id)} class="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-xs text-tx transition-all hover:bg-s7">
													<span class="min-w-0 flex-1 truncate text-left">{src.name}</span>
													<span class="relative h-5 w-9 shrink-0 rounded-full transition-colors {enabled ? 'bg-grn' : 'bg-bd2'}">
														<span class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-all {enabled ? 'left-[18px]' : 'left-0.5'}"></span>
													</span>
												</button>
											{/each}
										</div>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		{#if getIsLoggedIn()}
			<div class="shrink-0 border-t border-bd p-2">
				<button onclick={() => { close(); onDisconnect?.(); }} class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium text-red transition-all hover:bg-red/10">
					<LogOut size={14} strokeWidth={1.5} /> Disconnect
				</button>
			</div>
		{/if}
	</div>
</div>
{/if}
