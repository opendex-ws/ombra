<script lang="ts">
	import { untrack } from 'svelte';
	import { portal } from '$lib/actions/portal';
	import { api } from '$lib/api/client';
	import type { WatchlistSourceItem, CallerSource } from '$lib/api/types';
	import X from 'lucide-svelte/icons/x';
	import Check from 'lucide-svelte/icons/check';
	import { typeBadge } from '$lib/utils/format';

	type SourceTab = 'callers' | 'tg' | 'wallets' | 'lists';
	type TabConfig = { key: SourceTab; label: string };

	let {
		show = $bindable(false),
		mode = 'single' as 'single' | 'multi',
		tabs = ['callers', 'tg', 'wallets'] as SourceTab[],
		selectedIds = $bindable<string[]>([]),
		activeTab: initialTab = undefined as SourceTab | undefined,
		title = 'Select Source',
		onselect = (_item: WatchlistSourceItem) => {},
		ontoggle = (_item: WatchlistSourceItem) => {},
		onclose = () => {}
	}: {
		show: boolean;
		mode?: 'single' | 'multi';
		tabs?: SourceTab[];
		selectedIds?: string[];
		activeTab?: SourceTab;
		title?: string;
		onselect?: (item: WatchlistSourceItem) => void;
		ontoggle?: (item: WatchlistSourceItem) => void;
		onclose?: () => void;
	} = $props();

	let currentTab = $state<SourceTab>('callers');

	let search = $state('');
	let loading = $state(false);
	let fetched = $state(false);
	let searchDebounce: ReturnType<typeof setTimeout> | null = null;
	const requestSeqByTab: Record<SourceTab, number> = { callers: 0, tg: 0, wallets: 0, lists: 0 };

	type TabData = { items: WatchlistSourceItem[]; cursor?: string; hasMore: boolean; loadingMore: boolean; search: string };
	const emptyTab = (): TabData => ({ items: [], cursor: undefined, hasMore: false, loadingMore: false, search: '' });
	let tabData = $state<Record<SourceTab, TabData>>({
		callers: emptyTab(),
		tg: emptyTab(),
		wallets: emptyTab(),
		lists: emptyTab()
	});

	const pathMap: Record<SourceTab, '/v2/watchlist/sources/callers' | '/v2/watchlist/sources/tg' | '/v2/watchlist/sources/wallets' | '/v2/watchlist/sources/lists'> = {
		callers: '/v2/watchlist/sources/callers',
		tg: '/v2/watchlist/sources/tg',
		wallets: '/v2/watchlist/sources/wallets',
		lists: '/v2/watchlist/sources/lists'
	};

	const tabLabels: Record<SourceTab, string> = {
		callers: 'Callers',
		tg: 'Telegram',
		wallets: 'Wallets',
		lists: 'User Lists'
	};

	const tabConfigs = $derived<TabConfig[]>(tabs.map(t => ({ key: t, label: tabLabels[t] })));

	function getSourceName(item: WatchlistSourceItem): string {
		return (item as { name: string }).name;
	}

	function getSourceId(item: WatchlistSourceItem): string {
		return (item as { id: string }).id;
	}

	function getSourceType(item: WatchlistSourceItem): CallerSource {
		return (item as { type: CallerSource }).type;
	}

	const filteredItems = $derived(tabData[currentTab].items);

	async function loadTab(tab: SourceTab, reset: boolean) {
		const t = tabData[tab];
		if (!reset && (!t.hasMore || t.loadingMore)) return;
		const seq = ++requestSeqByTab[tab];
		const q = search.trim();
		if (reset) {
			tabData[tab] = { ...emptyTab(), search: q };
		} else {
			tabData[tab].loadingMore = true;
		}
		try {
			const query: Record<string, string> = {};
			if (q) query.search = q;
			if (!reset && t.cursor) query.cursor = t.cursor;
			const { data } = await api.GET(pathMap[tab], { params: { query: query as never } });
			if (seq !== requestSeqByTab[tab]) return;
			const newItems = data?.sources ?? [];
			tabData[tab] = {
				items: reset ? newItems : [...tabData[tab].items, ...newItems],
				cursor: data?.nextCursor,
				hasMore: !!data?.nextCursor,
				loadingMore: false,
				search: q
			};
		} catch {
			if (seq === requestSeqByTab[tab]) tabData[tab].loadingMore = false;
		}
	}

	async function fetchSources() {
		if (fetched) return;
		loading = true;
		try {
			await Promise.all(tabs.map(t => loadTab(t, true)));
		} catch {}
		loading = false;
		fetched = true;
	}

	function onSearchInput() {
		if (searchDebounce) clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => loadTab(currentTab, true), 300);
	}

	function switchTab(tab: SourceTab) {
		currentTab = tab;
		if (fetched && tabData[tab].search !== search.trim()) {
			loadTab(tab, true);
		}
	}

	function handleSelect(item: WatchlistSourceItem) {
		const id = getSourceId(item);
		if (mode === 'single') {
			onselect(item);
			close();
		} else {
			if (selectedIds.includes(id)) {
				selectedIds = selectedIds.filter(s => s !== id);
			} else {
				selectedIds = [...selectedIds, id];
			}
			ontoggle(item);
		}
	}

	function handleScroll(e: Event) {
		if (!tabData[currentTab].hasMore) return;
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
			loadTab(currentTab, false);
		}
	}

	function close() {
		show = false;
		search = '';
		onclose();
	}

	$effect(() => {
		if (show) {
			const tab = initialTab ?? tabs[0] ?? 'callers';
			untrack(() => {
				currentTab = tab;
				search = '';
				fetchSources();
			});
		}
	});
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px] p-4" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
		<div class="animate-fade-in w-full max-w-md rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-bd px-5 py-4">
				<h3 class="text-sm font-semibold text-tx">{title}</h3>
				<button onclick={close} class="cursor-pointer text-g4 transition-colors hover:text-tx">
					<X class="h-4 w-4" />
				</button>
			</div>

			{#if tabConfigs.length > 1}
				<div class="flex border-b border-bd">
					{#each tabConfigs as tab}
						<button onclick={() => switchTab(tab.key)} class="relative flex-1 cursor-pointer py-2.5 text-xs font-medium transition-colors {currentTab === tab.key ? 'text-tx' : 'text-g5 hover:text-g9'}">
							{tab.label}
							{#if currentTab === tab.key}<span class="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-grn"></span>{/if}
						</button>
					{/each}
				</div>
			{/if}

			<div class="p-4">
				<input
					type="text"
					bind:value={search}
					oninput={onSearchInput}
					placeholder="Search..."
					class="mb-3 w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-sm text-tx placeholder-g4 outline-none focus:border-grn/40"
				/>
				{#if loading}
					<div class="space-y-2">{#each Array(4) as _}<div class="skeleton h-10 rounded-lg"></div>{/each}</div>
				{:else if filteredItems.length === 0}
					<div class="py-8 text-center text-sm text-g5">No sources found</div>
				{:else}
					<div class="max-h-[400px] space-y-1 overflow-y-auto" onscroll={handleScroll}>
						{#each filteredItems as item}
							{@const id = getSourceId(item)}
							{@const selected = selectedIds.includes(id)}
							<button
								onclick={() => handleSelect(item)}
								class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors {selected ? 'bg-grn/10 ring-1 ring-grn/20' : 'hover:bg-wh/5'}"
							>
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm font-medium text-tx">{getSourceName(item)}</div>
								</div>
								{#if mode === 'multi'}
									<div class="h-4 w-4 shrink-0 rounded border {selected ? 'border-grn bg-grn' : 'border-bd'}">
										{#if selected}<Check class="h-4 w-4 text-s0" strokeWidth={3} />{/if}
									</div>
								{:else}
									<span class="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium {typeBadge(getSourceType(item))}">{getSourceType(item)}</span>
								{/if}
							</button>
						{/each}
						{#if tabData[currentTab].loadingMore}
							<div class="py-2 text-center text-xs text-g5">Loading more...</div>
						{/if}
					</div>
				{/if}
				{#if mode === 'multi'}
					<button onclick={close} class="btn-primary mt-3 w-full py-2 text-sm">Done</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
