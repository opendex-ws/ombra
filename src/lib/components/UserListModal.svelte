<script lang="ts">
	import { untrack } from 'svelte';
	import { portal } from '$lib/actions/portal';
	import { api } from '$lib/api/client';
	import type { WatchlistSourceItem, TokenFilter, TokenMarketFilter, TokenSecurityFilter, TokenSocialFilter, TokenSourceFilter, TokenSourceGroup, TokenTaxFilter, Chain, TokenActivityFilter, TokenActivityWindowFilter, TokenHolderFilter, ScannerGraduation } from '$lib/api/types';
	import type { PlatformType } from '$lib/api/types';
	import { getRouterInfo } from '$lib/utils/routers';
	import X from 'lucide-svelte/icons/x';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Camera from 'lucide-svelte/icons/camera';
	import { avatarUrl } from '$lib/utils/format';
	import SourcePicker from './SourcePicker.svelte';
	import ImageCropper from './ImageCropper.svelte';

	type ListSource = WatchlistSourceItem & { type: 'LIST' };

	let { show = $bindable(false), editList = null as ListSource | null, onclose = () => {}, onsaved = () => {} }: {
		show?: boolean;
		editList?: ListSource | null;
		onclose?: () => void;
		onsaved?: () => void;
	} = $props();

	let editingListId = $state<string | null>(null);
	let ulName = $state('');
	let ulChain = $state<Chain | ''>('');
	let ulMcapMin = $state('');
	let ulMcapMax = $state('');
	let ulLiqMin = $state('');
	let ulLiqMax = $state('');
	let ulAgeMin = $state('');
	let ulAgeMax = $state('');
	let ulDexPaid = $state<boolean | null>(null);
	let ulIsRenounced = $state<boolean | null>(null);
	let ulLpLocked = $state<boolean | null>(null);
	let ulFreezeDisabled = $state<boolean | null>(null);
	let ulMintDisabled = $state<boolean | null>(null);
	let ulNotHoneypot = $state<boolean | null>(null);
	let ulIsVerified = $state<boolean | null>(null);
	let ulHasWebsite = $state<boolean | null>(null);
	let ulHasTwitter = $state<boolean | null>(null);
	let ulHasTelegram = $state<boolean | null>(null);
	let ulHasDiscord = $state<boolean | null>(null);
	let ulWithAnySocial = $state<boolean | null>(null);
	let ulMaxBuyTax = $state('');
	let ulMaxSellTax = $state('');
	let ulMaxTransferTax = $state('');
	let ulSelectedCallers = $state<string[]>([]);
	let ulSelectedTgConns = $state<string[]>([]);
	let ulSelectedWallets = $state<string[]>([]);
	// Source grouping: source id -> group index (0 = A, 1 = B, …); absent = ungrouped.
	// A list triggers only when EVERY group is satisfied (≥1 member called) AND the
	// call-count range is met. Ungrouped sources only add to the call count.
	let ulSourceGroups = $state<Record<string, number>>({});
	function groupLetter(i: number): string {
		// A–Z, then AA, AB, … so groups always read as letters.
		let s = '';
		i += 1;
		while (i > 0) { i -= 1; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
		return s;
	}
	// Categorical group colors (fixed hues, not theme-driven — like a rainbow) so
	// distinct groups are visually distinguishable at a glance.
	const GROUP_COLORS = ['#22c55e', '#60a5fa', '#f59e0b', '#a78bfa', '#ec4899', '#14b8a6', '#f97316', '#e11d48'];
	function groupColor(i: number): string { return GROUP_COLORS[i % GROUP_COLORS.length]; }
	// Distinct group indices currently in use, contiguous-normalized order.
	const usedGroupIndices = $derived(
		[...new Set(Object.values(ulSourceGroups))].filter((n) => n >= 0).sort((a, b) => a - b)
	);
	// Cycle a source's group on click: ungrouped -> A -> B -> … -> (new) -> ungrouped.
	function cycleSourceGroup(id: string) {
		const cur = ulSourceGroups[id];
		const used = usedGroupIndices;
		const maxUsed = used.length ? used[used.length - 1] : -1;
		let next: number;
		if (cur === undefined || cur < 0) next = used.length ? used[0] : 0;
		else {
			const pos = used.indexOf(cur);
			// advance to next existing group, then to a brand-new group, then ungroup
			if (pos < used.length - 1) next = used[pos + 1];
			else if (cur === maxUsed && Object.values(ulSourceGroups).filter((g) => g === cur).length > 1) next = maxUsed + 1;
			else next = -1;
		}
		const copy = { ...ulSourceGroups };
		if (next < 0) delete copy[id];
		else copy[id] = next;
		ulSourceGroups = normalizeGroups(copy);
	}
	// Re-pack group indices so they're contiguous 0..k after removals.
	function normalizeGroups(g: Record<string, number>): Record<string, number> {
		const idx = [...new Set(Object.values(g))].filter((n) => n >= 0).sort((a, b) => a - b);
		const remap = new Map(idx.map((v, i) => [v, i]));
		const out: Record<string, number> = {};
		for (const [id, v] of Object.entries(g)) if (v >= 0 && remap.has(v)) out[id] = remap.get(v)!;
		return out;
	}
	function removeFromGroups(id: string) {
		if (ulSourceGroups[id] === undefined) return;
		const copy = { ...ulSourceGroups };
		delete copy[id];
		ulSourceGroups = normalizeGroups(copy);
	}
	const totalSelectedSources = $derived(ulSelectedCallers.length + ulSelectedTgConns.length + ulSelectedWallets.length);
	let ulSaving = $state(false);
	let ulImageData = $state<string | null>(null);
	let ulImagePreview = $state<string | null>(null);
	let showImageCropper = $state(false);
	let ulPlatforms = $state<PlatformType[]>([]);
	let ulGraduation = $state<ScannerGraduation | ''>('');
	let ulLpBurned = $state<boolean | null>(null);
	let ulProxy = $state<boolean | null>(null);
	let ulCallCountMin = $state('');
	let ulCallCountMax = $state('');
	let ulHolderCountMin = $state('');
	let ulHolderCountMax = $state('');
	let ulTop10PctMax = $state('');
	let ulDevPctMax = $state('');
	let ulInsiderPctMax = $state('');
	let ulSniperPctMax = $state('');
	let ulBundlerPctMax = $state('');
	let ulActivityTimeframe = $state<'fiveMin' | 'oneHour' | 'sixHours' | 'twentyFourHours'>('fiveMin');
	let ulVolMin = $state('');
	let ulVolMax = $state('');
	let ulFeesMin = $state('');
	let ulFeesMax = $state('');
	let ulTxnsMin = $state('');
	let ulTxnsMax = $state('');
	let ulBuysMin = $state('');
	let ulSellsMin = $state('');
	let ulPriceChangeMin = $state('');
	let ulPriceChangeMax = $state('');

	const platformOptions: PlatformType[] = ['RAYDIUM', 'RAYDIUM_CP', 'RAYDIUM_CLMM', 'RAYDIUM_LAUNCH', 'PUMPFUN', 'PUMPSWAP', 'METEORA_DYN', 'METEORA_DLMM', 'METEORA_BONDING_CURVE', 'METEORA_DYN_V2', 'UNISWAP_V2', 'UNISWAP_V3', 'AERODROME_V2', 'HEAVEN', 'FOURMEME_V2', 'LETS_BONK', 'BELIEVE', 'BAGS', 'PRINTR', 'MOONSHOT'];
	const activityTimeframes = [
		{ key: 'fiveMin' as const, label: '5m' },
		{ key: 'oneHour' as const, label: '1h' },
		{ key: 'sixHours' as const, label: '6h' },
		{ key: 'twentyFourHours' as const, label: '24h' },
	];
	const chains: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];

	type UlTab = 'market' | 'safety' | 'activity' | 'sources';
	const ulTabs: { key: UlTab; label: string }[] = [
		{ key: 'market', label: 'Market' },
		{ key: 'safety', label: 'Safety' },
		{ key: 'activity', label: 'Activity' },
		{ key: 'sources', label: 'Sources' }
	];
	let ulTab = $state<UlTab>('market');

	let srcPickerOpen = $state<'callers' | 'tg' | 'wallets' | null>(null);
	let srcPickerShow = $state(false);
	let srcPickerSelectedIds = $state<string[]>([]);
	let sourceNameMap = $state<Record<string, string>>({});

	function rememberSourceName(item: WatchlistSourceItem) {
		const rec = item as { id?: string; name?: string };
		if (rec.id && rec.name) sourceNameMap = { ...sourceNameMap, [rec.id]: rec.name };
	}


	function resetForm() {
		ulName = '';
		ulChain = '';
		ulMcapMin = '';
		ulMcapMax = '';
		ulLiqMin = '';
		ulLiqMax = '';
		ulAgeMin = '';
		ulAgeMax = '';
		ulDexPaid = null;
		ulIsRenounced = null;
		ulLpLocked = null;
		ulFreezeDisabled = null;
		ulMintDisabled = null;
		ulNotHoneypot = null;
		ulIsVerified = null;
		ulHasWebsite = null;
		ulHasTwitter = null;
		ulHasTelegram = null;
		ulHasDiscord = null;
		ulWithAnySocial = null;
		ulMaxBuyTax = '';
		ulMaxSellTax = '';
		ulMaxTransferTax = '';
		ulSelectedCallers = [];
		ulSelectedTgConns = [];
		ulSelectedWallets = [];
		ulSourceGroups = {};
		ulPlatforms = [];
		ulGraduation = '';
		ulLpBurned = null;
		ulProxy = null;
		ulCallCountMin = '';
		ulCallCountMax = '';
		ulHolderCountMin = '';
		ulHolderCountMax = '';
		ulTop10PctMax = '';
		ulDevPctMax = '';
		ulInsiderPctMax = '';
		ulSniperPctMax = '';
		ulBundlerPctMax = '';
		ulActivityTimeframe = 'fiveMin';
		ulVolMin = '';
		ulVolMax = '';
		ulFeesMin = '';
		ulFeesMax = '';
		ulTxnsMin = '';
		ulTxnsMax = '';
		ulBuysMin = '';
		ulSellsMin = '';
		ulPriceChangeMin = '';
		ulPriceChangeMax = '';
		ulImageData = null;
		ulImagePreview = null;
		editingListId = null;
		sourceNameMap = {};
	}

	function populateForm(list: ListSource) {
		ulName = list.name;
		const f = list.sourceDetails.tokenFilter;
		// Single source of truth on read: sourceDetails.sources (enriched). On read
		// tokenFilter.sources is null, so both membership (ids/group index) AND
		// display names come from here. Flat lists = ungrouped; groups[] = grouped.
		const enriched = list.sourceDetails.sources;
		const nameMap: Record<string, string> = {};
		const callers: string[] = [];
		const tgConns: string[] = [];
		const wallets: string[] = [];
		const groupMap: Record<string, number> = {};
		if (enriched) {
			for (const c of enriched.callers ?? []) if (c.id) { callers.push(c.id); if (c.name) nameMap[c.id] = c.name; }
			for (const t of enriched.tgConnections ?? []) if (t.id) { tgConns.push(t.id); if (t.name) nameMap[t.id] = t.name; }
			for (const w of enriched.wallets ?? []) if (w.id) { wallets.push(w.id); if (w.name) nameMap[w.id] = w.name; }
			(enriched.groups ?? []).forEach((g, gi) => {
				for (const c of g.callers ?? []) if (c.id) { callers.push(c.id); groupMap[c.id] = gi; if (c.name) nameMap[c.id] = c.name; }
				for (const t of g.tgConnections ?? []) if (t.id) { tgConns.push(t.id); groupMap[t.id] = gi; if (t.name) nameMap[t.id] = t.name; }
				for (const w of g.wallets ?? []) if (w.id) { wallets.push(w.id); groupMap[w.id] = gi; if (w.name) nameMap[w.id] = w.name; }
			});
		}
		sourceNameMap = nameMap;
		ulSelectedCallers = [...new Set(callers)];
		ulSelectedTgConns = [...new Set(tgConns)];
		ulSelectedWallets = [...new Set(wallets)];
		ulSourceGroups = normalizeGroups(groupMap);
		ulChain = (f.scope?.chain?.[0] as Chain) ?? '';
		ulMcapMin = f.market?.marketCapUsd?.min?.toString() ?? '';
		ulMcapMax = f.market?.marketCapUsd?.max?.toString() ?? '';
		ulLiqMin = f.market?.liquidityUsd?.min?.toString() ?? '';
		ulLiqMax = f.market?.liquidityUsd?.max?.toString() ?? '';
		ulAgeMin = f.market?.ageHours?.min?.toString() ?? '';
		ulAgeMax = f.market?.ageHours?.max?.toString() ?? '';
		ulDexPaid = f.socials?.dexScreenerPaid ?? null;
		ulIsRenounced = f.security?.renounced ?? null;
		ulLpLocked = f.security?.lpLocked ?? null;
		ulFreezeDisabled = f.security?.freezable === false ? true : null;
		ulMintDisabled = f.security?.mintable === false ? true : null;
		ulNotHoneypot = f.security?.honeypot === false ? true : null;
		ulIsVerified = f.security?.contractVerified ?? null;
		ulHasWebsite = f.socials?.hasWebsite ?? null;
		ulHasTwitter = f.socials?.hasTwitter ?? null;
		ulHasTelegram = f.socials?.hasTelegram ?? null;
		ulHasDiscord = f.socials?.hasDiscord ?? null;
		ulWithAnySocial = f.socials?.hasAnySocial ?? null;
		ulMaxBuyTax = f.tax?.buyTaxPct?.max?.toString() ?? '';
		ulMaxSellTax = f.tax?.sellTaxPct?.max?.toString() ?? '';
		ulMaxTransferTax = f.tax?.transferTaxPct?.max?.toString() ?? '';
		ulPlatforms = (f.scope?.platforms as PlatformType[]) ?? [];
		ulGraduation = (f.scope?.graduation as ScannerGraduation) ?? '';
		ulLpBurned = f.security?.lpBurned ?? null;
		ulProxy = f.security?.proxy === false ? true : null;
		ulCallCountMin = (f as Record<string, unknown>).callCount ? String(((f as Record<string, unknown>).callCount as { min?: number })?.min ?? '') : '';
		ulCallCountMax = (f as Record<string, unknown>).callCount ? String(((f as Record<string, unknown>).callCount as { max?: number })?.max ?? '') : '';
		ulHolderCountMin = f.holders?.holderCount?.min?.toString() ?? '';
		ulHolderCountMax = f.holders?.holderCount?.max?.toString() ?? '';
		ulTop10PctMax = f.holders?.top10Pct?.max?.toString() ?? '';
		ulDevPctMax = f.holders?.devPct?.max?.toString() ?? '';
		ulInsiderPctMax = f.holders?.insiderPct?.max?.toString() ?? '';
		ulSniperPctMax = f.holders?.sniperPct?.max?.toString() ?? '';
		ulBundlerPctMax = f.holders?.bundlerPct?.max?.toString() ?? '';
		const actKeys = ['fiveMin', 'oneHour', 'sixHours', 'twentyFourHours'] as const;
		const activeKey = actKeys.find(k => f.activity?.[k]);
		ulActivityTimeframe = activeKey ?? 'fiveMin';
		const aw = activeKey ? f.activity?.[activeKey] : null;
		ulVolMin = aw?.volumeUsd?.min?.toString() ?? '';
		ulVolMax = aw?.volumeUsd?.max?.toString() ?? '';
		ulFeesMin = aw?.totalFeesUsd?.min?.toString() ?? '';
		ulFeesMax = aw?.totalFeesUsd?.max?.toString() ?? '';
		ulTxnsMin = aw?.transactions?.min?.toString() ?? '';
		ulTxnsMax = aw?.transactions?.max?.toString() ?? '';
		ulBuysMin = aw?.buys?.min?.toString() ?? '';
		ulSellsMin = aw?.sells?.min?.toString() ?? '';
		ulPriceChangeMin = aw?.priceChangePct?.min?.toString() ?? '';
		ulPriceChangeMax = aw?.priceChangePct?.max?.toString() ?? '';
	}

	function buildTokenFilter(): TokenFilter {
		const filter: TokenFilter = {};
		const scope: Record<string, unknown> = {};
		if (ulChain) scope.chain = [ulChain as Chain];
		if (ulPlatforms.length > 0) scope.platforms = ulPlatforms;
		if (ulGraduation) scope.graduation = ulGraduation;
		if (Object.keys(scope).length > 0) filter.scope = scope as TokenFilter['scope'];
		const market: TokenMarketFilter = {};
		if (ulMcapMin || ulMcapMax) {
			market.marketCapUsd = {};
			if (ulMcapMin) market.marketCapUsd.min = parseFloat(ulMcapMin);
			if (ulMcapMax) market.marketCapUsd.max = parseFloat(ulMcapMax);
		}
		if (ulLiqMin || ulLiqMax) {
			market.liquidityUsd = {};
			if (ulLiqMin) market.liquidityUsd.min = parseFloat(ulLiqMin);
			if (ulLiqMax) market.liquidityUsd.max = parseFloat(ulLiqMax);
		}
		if (ulAgeMin || ulAgeMax) {
			market.ageHours = {};
			if (ulAgeMin) market.ageHours.min = parseFloat(ulAgeMin);
			if (ulAgeMax) market.ageHours.max = parseFloat(ulAgeMax);
		}
		if (Object.keys(market).length > 0) filter.market = market;
		const sec: TokenSecurityFilter = {};
		if (ulIsRenounced !== null) sec.renounced = ulIsRenounced;
		if (ulLpLocked !== null) sec.lpLocked = ulLpLocked;
		if (ulLpBurned !== null) sec.lpBurned = ulLpBurned;
		if (ulFreezeDisabled !== null) sec.freezable = ulFreezeDisabled === true ? false : null;
		if (ulMintDisabled !== null) sec.mintable = ulMintDisabled === true ? false : null;
		if (ulNotHoneypot !== null) sec.honeypot = ulNotHoneypot === true ? false : null;
		if (ulIsVerified !== null) sec.contractVerified = ulIsVerified;
		if (ulProxy !== null) sec.proxy = ulProxy === true ? false : null;
		if (Object.keys(sec).length > 0) filter.security = sec;
		const tax: TokenTaxFilter = {};
		if (ulMaxBuyTax) tax.buyTaxPct = { max: parseFloat(ulMaxBuyTax) };
		if (ulMaxSellTax) tax.sellTaxPct = { max: parseFloat(ulMaxSellTax) };
		if (ulMaxTransferTax) tax.transferTaxPct = { max: parseFloat(ulMaxTransferTax) };
		if (Object.keys(tax).length > 0) filter.tax = tax;
		const soc: TokenSocialFilter = {};
		if (ulHasWebsite !== null) soc.hasWebsite = ulHasWebsite;
		if (ulHasTwitter !== null) soc.hasTwitter = ulHasTwitter;
		if (ulHasTelegram !== null) soc.hasTelegram = ulHasTelegram;
		if (ulHasDiscord !== null) soc.hasDiscord = ulHasDiscord;
		if (ulWithAnySocial !== null) soc.hasAnySocial = ulWithAnySocial;
		if (ulDexPaid !== null) soc.dexScreenerPaid = ulDexPaid;
		if (Object.keys(soc).length > 0) filter.socials = soc;
		const sources: TokenSourceFilter = {};
		// Split each selected id into its group (AND-of-groups) or the flat list
		// (ungrouped — contributes only to call count). Kind is tracked per list.
		const kinds: [string[], keyof TokenSourceGroup][] = [
			[ulSelectedCallers, 'callers'],
			[ulSelectedTgConns, 'tgConnections'],
			[ulSelectedWallets, 'wallets']
		];
		const flat: Record<string, string[]> = { callers: [], tgConnections: [], wallets: [] };
		const groupBuckets = new Map<number, TokenSourceGroup>();
		for (const [ids, kind] of kinds) {
			for (const id of ids) {
				const gi = ulSourceGroups[id];
				if (gi === undefined || gi < 0) {
					flat[kind as string].push(id);
				} else {
					let bucket = groupBuckets.get(gi);
					if (!bucket) { bucket = {}; groupBuckets.set(gi, bucket); }
					((bucket[kind] ??= []) as string[]).push(id);
				}
			}
		}
		if (flat.callers.length > 0) sources.callers = flat.callers;
		if (flat.tgConnections.length > 0) sources.tgConnections = flat.tgConnections;
		if (flat.wallets.length > 0) sources.wallets = flat.wallets;
		const groupList = [...groupBuckets.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
		if (groupList.length > 0) sources.groups = groupList;
		if (Object.keys(sources).length > 0) filter.sources = sources;
		if (ulCallCountMin || ulCallCountMax) {
			const cc: { min?: number; max?: number } = {};
			if (ulCallCountMin) cc.min = parseInt(ulCallCountMin);
			if (ulCallCountMax) cc.max = parseInt(ulCallCountMax);
			(filter as Record<string, unknown>).callCount = cc;
		}
		const holders: TokenHolderFilter = {};
		if (ulHolderCountMin || ulHolderCountMax) {
			holders.holderCount = {};
			if (ulHolderCountMin) holders.holderCount.min = parseInt(ulHolderCountMin);
			if (ulHolderCountMax) holders.holderCount.max = parseInt(ulHolderCountMax);
		}
		if (ulTop10PctMax) holders.top10Pct = { max: parseFloat(ulTop10PctMax) };
		if (ulDevPctMax) holders.devPct = { max: parseFloat(ulDevPctMax) };
		if (ulInsiderPctMax) holders.insiderPct = { max: parseFloat(ulInsiderPctMax) };
		if (ulSniperPctMax) holders.sniperPct = { max: parseFloat(ulSniperPctMax) };
		if (ulBundlerPctMax) holders.bundlerPct = { max: parseFloat(ulBundlerPctMax) };
		if (Object.keys(holders).length > 0) filter.holders = holders;
		const aw: TokenActivityWindowFilter = {};
		if (ulVolMin || ulVolMax) {
			aw.volumeUsd = {};
			if (ulVolMin) aw.volumeUsd.min = parseFloat(ulVolMin);
			if (ulVolMax) aw.volumeUsd.max = parseFloat(ulVolMax);
		}
		if (ulFeesMin || ulFeesMax) {
			aw.totalFeesUsd = {};
			if (ulFeesMin) aw.totalFeesUsd.min = parseFloat(ulFeesMin);
			if (ulFeesMax) aw.totalFeesUsd.max = parseFloat(ulFeesMax);
		}
		if (ulTxnsMin || ulTxnsMax) {
			aw.transactions = {};
			if (ulTxnsMin) aw.transactions.min = parseInt(ulTxnsMin);
			if (ulTxnsMax) aw.transactions.max = parseInt(ulTxnsMax);
		}
		if (ulBuysMin) aw.buys = { min: parseInt(ulBuysMin) };
		if (ulSellsMin) aw.sells = { min: parseInt(ulSellsMin) };
		if (ulPriceChangeMin || ulPriceChangeMax) {
			aw.priceChangePct = {};
			if (ulPriceChangeMin) aw.priceChangePct.min = parseFloat(ulPriceChangeMin);
			if (ulPriceChangeMax) aw.priceChangePct.max = parseFloat(ulPriceChangeMax);
		}
		if (Object.keys(aw).length > 0) {
			filter.activity = { [ulActivityTimeframe]: aw } as TokenActivityFilter;
		}
		return filter;
	}

	function openSourcePicker(type: 'callers' | 'tg' | 'wallets') {
		srcPickerOpen = type;
		srcPickerShow = true;
		if (type === 'callers') srcPickerSelectedIds = [...ulSelectedCallers];
		else if (type === 'tg') srcPickerSelectedIds = [...ulSelectedTgConns];
		else srcPickerSelectedIds = [...ulSelectedWallets];
	}

	function closeSourcePicker() {
		if (srcPickerOpen === 'callers') ulSelectedCallers = [...srcPickerSelectedIds];
		else if (srcPickerOpen === 'tg') ulSelectedTgConns = [...srcPickerSelectedIds];
		else if (srcPickerOpen === 'wallets') ulSelectedWallets = [...srcPickerSelectedIds];
		srcPickerOpen = null;
		srcPickerShow = false;
	}

	function getSourceLabel(id: string): string {
		const name = sourceNameMap[id];
		if (name) return name;
		return id.length > 12 ? id.slice(0, 6) + '...' + id.slice(-4) : id;
	}

	async function save() {
		if (!ulName.trim()) return;
		ulSaving = true;
		try {
		const body = { name: ulName.trim(), tokenFilter: buildTokenFilter(), imageData: ulImageData } as never;
		if (editingListId) {
			await api.PUT('/v2/watchlist/manage/lists/{listId}/update', {
				params: { path: { listId: editingListId } },
				body
			});
		} else {
			await api.POST('/v2/watchlist/manage/lists/create', { body });
		}
			show = false;
			resetForm();
			onsaved();
		} catch {} finally {
			ulSaving = false;
		}
	}

	async function deleteList() {
		if (!editingListId) return;
		try {
			await api.DELETE('/v2/watchlist/manage/lists/{listId}/delete', { params: { path: { listId: editingListId } } });
			show = false;
			resetForm();
			onsaved();
		} catch {}
	}

	function close() {
		show = false;
		resetForm();
		onclose();
	}

	$effect(() => {
		const list = editList;
		if (show) {
			untrack(() => {
				ulTab = 'market';
				if (list) {
					editingListId = list.id;
					populateForm(list);
				} else {
					resetForm();
				}
			});
		}
	});
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div use:portal class="fixed inset-0 z-[200] overflow-y-auto bg-s0/60 backdrop-blur-[2px]" onkeydown={(e) => { if (e.key === 'Escape') close(); }}>
		<div class="flex min-h-full items-center justify-center p-3 md:p-6" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
		<div class="animate-fade-in w-full max-w-md overflow-x-hidden rounded-2xl border border-bd bg-s5 p-6 shadow-2xl backdrop-blur-xl" onclick={(e) => e.stopPropagation()}>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-base font-semibold text-tx">{editingListId ? 'Edit' : 'Create'} User List</h2>
				<button onclick={close} class="cursor-pointer text-g7 transition-colors hover:text-tx">
					<X class="h-5 w-5" strokeWidth={2} />
				</button>
			</div>

			<div class="space-y-3">
				<div class="space-y-3">
					{#if showImageCropper}
						<ImageCropper bind:show={showImageCropper} inline onconfirm={(base64) => {
							ulImageData = base64;
							ulImagePreview = base64;
						}} />
					{:else}
						<div class="flex items-center gap-3">
							<button onclick={() => showImageCropper = true} class="group/avatar relative shrink-0 cursor-pointer">
								{#if ulImagePreview}
									<img src={ulImagePreview} alt="" class="h-12 w-12 rounded-xl object-cover ring-1 ring-bd" />
								{:else if editList?.photoId && avatarUrl(editList.photoId)}
									<img src={avatarUrl(editList.photoId)} alt="" class="h-12 w-12 rounded-xl object-cover ring-1 ring-bd" />
								{:else}
									<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-s7 ring-1 ring-bd">
										<Camera class="h-5 w-5 text-g5" />
									</div>
								{/if}
								<div class="absolute inset-0 flex items-center justify-center rounded-xl bg-s0/50 opacity-0 transition-opacity group-hover/avatar:opacity-100">
									<Camera class="h-4 w-4 text-tx" />
								</div>
							</button>
							<div class="flex-1">
								<label class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5" for="ul-name-modal">List Name</label>
								<input id="ul-name-modal" type="text" bind:value={ulName} placeholder="My Filter..." class="w-full rounded-lg border border-bd bg-s4 px-3 py-1.5 text-sm text-tx placeholder-g3 outline-none transition-all focus:border-grn/40" />
							</div>
						</div>
					{/if}
					<div class="flex items-center gap-2">
						<div class="flex-1">
							<label class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5" for="ul-chain-modal">Chain</label>
							<select id="ul-chain-modal" bind:value={ulChain} class="w-full rounded-lg border border-bd bg-s4 px-3 py-1.5 text-sm text-tx outline-none transition-all focus:border-grn/40">
								<option value="">All Chains</option>
								{#each chains as c}<option value={c}>{c}</option>{/each}
							</select>
						</div>
						<div class="flex-1">
							<label class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5" for="ul-grad-modal">Graduation</label>
							<select id="ul-grad-modal" bind:value={ulGraduation} class="w-full rounded-lg border border-bd bg-s4 px-3 py-1.5 text-sm text-tx outline-none transition-all focus:border-grn/40">
								<option value="">All</option>
								<option value="onlyGraduated">Graduated</option>
								<option value="ignoreGraduated">Not Graduated</option>
							</select>
						</div>
					</div>
				</div>

				<div class="flex gap-4 border-b border-bd px-0.5">
					{#each ulTabs as t}
						<button
							onclick={() => (ulTab = t.key)}
							class="relative cursor-pointer pb-2 text-xs font-semibold transition-colors {ulTab === t.key ? 'text-tx' : 'text-g5 hover:text-g8'}"
						>
							{t.label}
							{#if ulTab === t.key}<span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-grn"></span>{/if}
						</button>
					{/each}
				</div>

				{#if ulTab === 'market'}
				<div class="rounded-lg border border-bd bg-s1 p-3 space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Platforms</span>
						{#if ulPlatforms.length > 0}
							<button onclick={() => { ulPlatforms = []; }} class="cursor-pointer text-[10px] font-medium text-red hover:text-red-light transition-colors">Show All</button>
						{/if}
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#each platformOptions as plat}
							{@const selected = ulPlatforms.includes(plat)}
							{@const info = getRouterInfo(plat)}
							<button
								onclick={() => { ulPlatforms = selected ? ulPlatforms.filter(p => p !== plat) : [...ulPlatforms, plat]; }}
								class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors {selected
									? 'border-tx text-tx'
									: 'border-bd text-g6 hover:text-g9'}"
							>
								{#if info.icon}<img src={info.icon} alt="" class="h-3.5 w-3.5 rounded" />{/if}
								{info.name}
							</button>
						{/each}
					</div>
				</div>

				<div class="rounded-lg border border-bd bg-s1 p-3 space-y-3">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Market</span>
					{@render rangeInput('Market Cap', ulMcapMin, ulMcapMax, (a: string, b: string) => { ulMcapMin = a; ulMcapMax = b; })}
					{@render rangeInput('Liquidity', ulLiqMin, ulLiqMax, (a: string, b: string) => { ulLiqMin = a; ulLiqMax = b; })}
					{@render rangeInput('Age (hours)', ulAgeMin, ulAgeMax, (a: string, b: string) => { ulAgeMin = a; ulAgeMax = b; })}
					{@render ulSlider('Buy Tax', ulMaxBuyTax, (v: string) => { ulMaxBuyTax = v; })}
					{@render ulSlider('Sell Tax', ulMaxSellTax, (v: string) => { ulMaxSellTax = v; })}
					{@render ulSlider('Transfer Tax', ulMaxTransferTax, (v: string) => { ulMaxTransferTax = v; })}
				</div>
				{/if}

				{#if ulTab === 'safety'}
				<div class="rounded-lg border border-bd bg-s1 p-3 space-y-2">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Safety</span>
					<div class="flex flex-wrap gap-2">
						{@render ulChip('Not Honeypot', () => ulNotHoneypot, (v: boolean | null) => { ulNotHoneypot = v; })}
						{@render ulChip('LP Locked', () => ulLpLocked, (v: boolean | null) => { ulLpLocked = v; })}
						{@render ulChip('LP Burned', () => ulLpBurned, (v: boolean | null) => { ulLpBurned = v; })}
						{@render ulChip('Renounced', () => ulIsRenounced, (v: boolean | null) => { ulIsRenounced = v; })}
						{@render ulChip('Verified', () => ulIsVerified, (v: boolean | null) => { ulIsVerified = v; })}
						{@render ulChip('Freeze Off', () => ulFreezeDisabled, (v: boolean | null) => { ulFreezeDisabled = v; })}
						{@render ulChip('Mint Off', () => ulMintDisabled, (v: boolean | null) => { ulMintDisabled = v; })}
						{@render ulChip('Not Proxy', () => ulProxy, (v: boolean | null) => { ulProxy = v; })}
						{@render ulChip('DEX Paid', () => ulDexPaid, (v: boolean | null) => { ulDexPaid = v; })}
					</div>
				</div>

				<div class="rounded-lg border border-bd bg-s1 p-3 space-y-2">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Socials</span>
					<div class="flex flex-wrap gap-2">
						{@render ulChip('Any', () => ulWithAnySocial, (v: boolean | null) => { ulWithAnySocial = v; })}
						{@render ulChip('Website', () => ulHasWebsite, (v: boolean | null) => { ulHasWebsite = v; })}
						{@render ulChip('Twitter', () => ulHasTwitter, (v: boolean | null) => { ulHasTwitter = v; })}
						{@render ulChip('Telegram', () => ulHasTelegram, (v: boolean | null) => { ulHasTelegram = v; })}
						{@render ulChip('Discord', () => ulHasDiscord, (v: boolean | null) => { ulHasDiscord = v; })}
					</div>
				</div>

				<div class="rounded-lg border border-bd bg-s1 p-3 space-y-3">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Holders</span>
					<div class="grid grid-cols-3 gap-3">
						{@render ulSlider('Top 10 %', ulTop10PctMax, (v: string) => { ulTop10PctMax = v; })}
						{@render ulSlider('Dev %', ulDevPctMax, (v: string) => { ulDevPctMax = v; })}
						{@render ulSlider('Insider %', ulInsiderPctMax, (v: string) => { ulInsiderPctMax = v; })}
						{@render ulSlider('Sniper %', ulSniperPctMax, (v: string) => { ulSniperPctMax = v; })}
						{@render ulSlider('Bundler %', ulBundlerPctMax, (v: string) => { ulBundlerPctMax = v; })}
					</div>
					<div class="h-px bg-bd"></div>
					{@render ulInlineRange('Count', ulHolderCountMin, ulHolderCountMax, (a: string, b: string) => { ulHolderCountMin = a; ulHolderCountMax = b; })}
				</div>
				{/if}

				{#if ulTab === 'activity'}
				<div class="rounded-lg border border-bd bg-s1 p-3 space-y-3">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Activity</span>
					<div class="rounded-lg bg-s4 p-0.5 flex gap-0.5 ring-1 ring-bd">
						{#each activityTimeframes as tf}
							<button
								class="flex-1 rounded-md py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer {ulActivityTimeframe === tf.key ? 'bg-bd text-tx' : 'text-g4 hover:text-g7'}"
								onclick={() => { ulActivityTimeframe = tf.key; }}
							>{tf.label}</button>
						{/each}
					</div>
					{@render rangeInput('Volume', ulVolMin, ulVolMax, (a: string, b: string) => { ulVolMin = a; ulVolMax = b; })}
					{@render rangeInput('Fees', ulFeesMin, ulFeesMax, (a: string, b: string) => { ulFeesMin = a; ulFeesMax = b; })}
					{@render ulInlineRange('Buys', ulBuysMin, '', (a: string) => { ulBuysMin = a; })}
					{@render ulInlineRange('Sells', ulSellsMin, '', (a: string) => { ulSellsMin = a; })}
					{@render ulInlineRange('Txns', ulTxnsMin, ulTxnsMax, (a: string, b: string) => { ulTxnsMin = a; ulTxnsMax = b; })}
					{@render ulInlineRange('Price Chg %', ulPriceChangeMin, ulPriceChangeMax, (a: string, b: string) => { ulPriceChangeMin = a; ulPriceChangeMax = b; })}
				</div>
				{/if}

				{#if ulTab === 'sources'}
				<div class="rounded-lg border border-bd bg-s1 p-3 space-y-3">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Sources</span>
					{#if totalSelectedSources > 1}
						<p class="text-[10px] leading-snug text-g5">
							Click a source to assign it a group. Grouped sources require <span class="text-g7">one from each group</span> to call (A <span class="text-tx">and</span> B), while sources in the same group are <span class="text-g7">interchangeable</span> (X <span class="text-tx">or</span> Y). Ungrouped sources only add to the call count.
						</p>
					{/if}
					<div class="space-y-2">
						{#each [
							{ label: 'Callers', items: ulSelectedCallers, open: () => openSourcePicker('callers'), remove: (id: string) => { ulSelectedCallers = ulSelectedCallers.filter(c => c !== id); removeFromGroups(id); } },
							{ label: 'Telegram', items: ulSelectedTgConns, open: () => openSourcePicker('tg'), remove: (id: string) => { ulSelectedTgConns = ulSelectedTgConns.filter(c => c !== id); removeFromGroups(id); } },
							{ label: 'Wallets', items: ulSelectedWallets, open: () => openSourcePicker('wallets'), remove: (id: string) => { ulSelectedWallets = ulSelectedWallets.filter(c => c !== id); removeFromGroups(id); } }
						] as src}
							<div class="rounded-lg border border-bd bg-s4">
								<div class="flex items-center justify-between px-2.5 py-1.5">
									<span class="text-xs font-medium text-g8">{src.label}{#if src.items.length > 0} <span class="text-g5">({src.items.length})</span>{/if}</span>
									<button onclick={src.open} class="btn-secondary px-2 py-0.5 text-[11px]">{src.items.length > 0 ? 'Edit' : 'Add'}</button>
								</div>
								{#if src.items.length > 0}
									<div class="flex flex-wrap gap-1 border-t border-bd px-2.5 py-1.5">
										{#each src.items as id}
											{@const gi = ulSourceGroups[id]}
											{@const grouped = gi !== undefined && gi >= 0}
											{@const gc = grouped ? groupColor(gi) : ''}
											<span
												class="flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] {grouped ? '' : 'border-bd bg-s2'}"
												style={grouped ? `border-color:${gc}55; background:${gc}1a` : ''}
											>
												<button
													type="button"
													onclick={() => cycleSourceGroup(id)}
													class="flex min-w-0 cursor-pointer items-center gap-1 text-tx"
													title={grouped ? `Group ${groupLetter(gi)} — click to change` : 'Click to add to a group'}
												>
													{#if grouped}
														<span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-s0" style={`background:${gc}`}>{groupLetter(gi)}</span>
													{:else}
														<span class="shrink-0 text-[9px] text-g4">＋</span>
													{/if}
													<span class="truncate">{getSourceLabel(id)}</span>
												</button>
												<button onclick={() => src.remove(id)} class="shrink-0 cursor-pointer text-g5 transition-colors hover:text-red">
													<X class="h-2.5 w-2.5" />
												</button>
											</span>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
					{@render rangeInput('Call Count', ulCallCountMin, ulCallCountMax, (a: string, b: string) => { ulCallCountMin = a; ulCallCountMax = b; })}
				</div>
				{/if}

				<div class="flex items-center gap-2 pt-1">
					{#if editingListId}
						<button onclick={deleteList} class="btn-danger-outline flex items-center justify-center gap-1.5 px-3 py-2 text-xs">
							<Trash2 class="h-3 w-3" />
							Delete
						</button>
					{/if}
					<button onclick={save} disabled={ulSaving || !ulName.trim()} class="btn-primary ml-auto flex-1 py-2.5 text-sm">
						{ulSaving ? 'Saving...' : editingListId ? 'Update List' : 'Create List'}
					</button>
				</div>
			</div>
		</div>
		</div>
	</div>

	{#if srcPickerOpen}
		<SourcePicker
			bind:show={srcPickerShow}
			mode="multi"
			tabs={[srcPickerOpen]}
			bind:selectedIds={srcPickerSelectedIds}
			title={srcPickerOpen === 'callers' ? 'Select Callers' : srcPickerOpen === 'tg' ? 'Select Telegram' : 'Select Wallets'}
			ontoggle={rememberSourceName}
			onclose={closeSourcePicker}
		/>
	{/if}


{/if}

{#snippet rangeInput(label: string, minVal: string, maxVal: string, onset: (min: string, max: string) => void)}
	<div>
		<div class="flex items-center justify-between mb-1.5">
			<span class="text-xs font-medium text-g8">{label}</span>
			{#if minVal || maxVal}
				<button onclick={() => onset('', '')} class="cursor-pointer text-[10px] text-g5 hover:text-red transition-colors">clear</button>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<input type="number" placeholder="Min" value={minVal} oninput={(e) => onset(e.currentTarget.value, maxVal)}
				class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40" />
			<span class="text-[10px] text-g1 shrink-0">to</span>
			<input type="number" placeholder="Max" value={maxVal} oninput={(e) => onset(minVal, e.currentTarget.value)}
				class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40" />
		</div>
	</div>
{/snippet}

{#snippet ulChip(label: string, getter: () => boolean | null, setter: (v: boolean | null) => void)}
	{@const active = getter() === true}
	<button
		class="cursor-pointer rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors {active
			? 'border-tx text-tx'
			: 'border-bd text-g6 hover:text-g9'}"
		onclick={() => setter(active ? null : true)}
	>
		{label}
	</button>
{/snippet}

{#snippet ulSlider(label: string, val: string, onset: (v: string) => void)}
	{@const numVal = val ? parseFloat(val) : 100}
	<div>
		<div class="mb-1 flex items-center justify-between">
			<span class="text-[11px] text-g7">{label}</span>
			<span class="text-[11px] font-medium {numVal < 100 ? 'text-grn' : 'text-g4'}">{numVal < 100 ? `≤${numVal}%` : 'Any'}</span>
		</div>
		<input type="range" min="0" max="100" step="1" value={numVal}
			oninput={(e) => {
				const v = parseFloat(e.currentTarget.value);
				onset(v >= 100 ? '' : String(v));
			}}
			class="slider-input w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bd2 accent-grn outline-none" />
	</div>
{/snippet}

{#snippet ulInlineRange(label: string, minVal: string, maxVal: string, onset: (...args: string[]) => void)}
	<div class="flex items-center gap-2">
		<span class="w-18 shrink-0 text-[11px] text-g7">{label}</span>
		<input type="number" placeholder="min" value={minVal} oninput={(e) => onset(e.currentTarget.value, maxVal)}
			class="w-full min-w-0 rounded-lg border border-bd bg-s4 px-2 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40" />
		{#if maxVal !== undefined}
			<span class="text-[10px] text-g1 shrink-0">-</span>
			<input type="number" placeholder="max" value={maxVal} oninput={(e) => onset(minVal, e.currentTarget.value)}
				class="w-full min-w-0 rounded-lg border border-bd bg-s4 px-2 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40" />
		{/if}
	</div>
{/snippet}
