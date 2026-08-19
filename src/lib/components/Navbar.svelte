<script lang="ts">
	import { page } from '$app/state';
	import { tokenImage } from '$lib/api/config';
	import ChainIcon from './ChainIcon.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { getIsLoggedIn, getWalletAddress, getIsConnecting, getAuthError, connectWallet, disconnect, isPhantomInstalled, getAuthToken } from '$lib/stores/auth.svelte';
	import { authenticate, subscribe, unsubscribe } from '$lib/ws/client';
	import { ageFromSeconds, shortAddress, formatNumber, formatPrice, formatMarketCap, formatPercent, formatUsd, pctColor, avatarUrl, fmtVal } from '$lib/utils/format';
	import { api } from '$lib/api/client';
	import type { ManagedWallet, ScannerItem, components, Chain, WalletAsset, TraderRankItem } from '$lib/api/types';
	import WalletWithdrawModal from './WalletWithdrawModal.svelte';
	import { getManagedWallets, fetchManagedWallets } from '$lib/stores/trade.svelte';
	import { fetchSettings, fetchFavourites, clearSettings } from '$lib/stores/settings.svelte';
	import { getProfile, fetchProfile, clearProfile } from '$lib/stores/profile.svelte';
	import Search from 'lucide-svelte/icons/search';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Wallet from 'lucide-svelte/icons/wallet';
	import WalletIcon from './WalletIcon.svelte';
	import LogOut from 'lucide-svelte/icons/log-out';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Columns3 from 'lucide-svelte/icons/columns-3';
	import ScanSearch from 'lucide-svelte/icons/scan-search';
	import Zap from 'lucide-svelte/icons/zap';
	import Bot from 'lucide-svelte/icons/bot';
	import CircleUser from 'lucide-svelte/icons/circle-user';
	import Palette from 'lucide-svelte/icons/palette';
	import Settings from 'lucide-svelte/icons/settings';

	import Camera from 'lucide-svelte/icons/camera';
	import { isDark } from '$lib/stores/theme.svelte';
	import OmbraLogo from './OmbraLogo.svelte';
	import type { ComponentType } from 'svelte';
	import { openTraderPortfolio } from '$lib/stores/traderAnalytics.svelte';

	type ScannerLookupSubscriptionParams = components['schemas']['ScannerLookupSubscriptionParams'];
	type ScannerTokensSnapshot = components['schemas']['ScannerTokensSnapshot'];
	type ScannerItemsUpdate = components['schemas']['ScannerItemsUpdate'];

	let MobileConnectModal = $state<any>(null);
	let MobileScanModal = $state<any>(null);
	let ThemeBuilderModal = $state<any>(null);
	let SettingsModal = $state<any>(null);

	let showMobileConnect = $state(false);
	let showMobileScan = $state(false);
	let showThemeBuilder = $state(false);
	let showSettings = $state(false);

	async function openSettings() {
		if (!SettingsModal) SettingsModal = (await import('./SettingsModal.svelte')).default;
		showSettings = true;
	}

	async function openMobileConnect() {
		if (!MobileConnectModal) MobileConnectModal = (await import('./MobileConnectModal.svelte')).default;
		showMobileConnect = true;
	}
	async function openMobileScan() {
		if (!MobileScanModal) MobileScanModal = (await import('./MobileScanModal.svelte')).default;
		showMobileScan = true;
	}
	async function openThemeBuilder() {
		if (!ThemeBuilderModal) ThemeBuilderModal = (await import('./ThemeBuilderModal.svelte')).default;
		showThemeBuilder = true;
	}


	let isMobile = $state(false);
	function checkMobile() { isMobile = typeof window !== 'undefined' && window.innerWidth < 768; }
	$effect(() => { if (typeof window !== 'undefined') { checkMobile(); window.addEventListener('resize', checkMobile); return () => window.removeEventListener('resize', checkMobile); } });

	const userProfile = $derived(getProfile());

	const navLinks: {
		href: string;
		label: string;
		icon: ComponentType;
	}[] = [
		{ href: '/', label: 'Terminal', icon: Columns3 },
		{ href: '/scanner', label: 'Scanner', icon: ScanSearch },
		{ href: '/memescope', label: 'Memescope', icon: Zap },
		{ href: '/autobuys', label: 'Bots', icon: Bot },
		{ href: '/trader-analytics', label: 'Trader Analytics', icon: Wallet },
		{ href: '/profile', label: 'Profile', icon: CircleUser }
	];

	let showSearch = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<ScannerItem[]>([]);
	let walletResults = $state<TraderRankItem[]>([]);
	let searchMode = $state<'token' | 'wallet'>('token');
	let searching = $state(false);
	let selectedIdx = $state(0);
	let searchInput: HTMLInputElement = $state(null!);
	let debounceTimer: ReturnType<typeof setTimeout>;
	let searchGeneration = 0;
	let lookupWsKey: string | null = null;

	let showWalletPopover = $state(false);
	let walletCopied = $state<string | null>(null);
	let walletPopoverEl: HTMLDivElement = $state(null!);
	let expandedWallets = $state<Set<string>>(new Set());

	let sellingToken = $state<string | null>(null);
	let withdrawingAsset = $state<{ chain: Chain; asset: WalletAsset } | null>(null);

	function openWithdraw(chain: string, asset: WalletAsset) {
		withdrawingAsset = { chain: chain as Chain, asset };
	}

	function onWithdrawComplete() {
		withdrawingAsset = null;
		fetchManagedWallets();
	}

	async function sellToken(chain: string, tokenAddress: string) {
		const key = `${chain}:${tokenAddress}`;
		if (sellingToken) return;
		sellingToken = key;
		try {
			await api.POST('/v2/user/wallets/{chain}/{token}/sell', {
				params: { path: { chain: chain as never, token: tokenAddress } },
				body: { pct: 100 }
			} as never);
			fetchManagedWallets();
		} catch {}
		sellingToken = null;
	}

	const chainOrder: Record<string, number> = { SOL: 0, ETH: 1, BASE: 2, BSC: 3 };
	const wallets = $derived(Object.entries(getManagedWallets()).map(([chain, w]) => ({ chain, ...w })).sort((a, b) => (chainOrder[a.chain] ?? 99) - (chainOrder[b.chain] ?? 99)));
	const totalValueUsd = $derived(wallets.reduce((sum, w) => sum + w.totalValueUsd, 0));

	function toggleWalletPopover() {
		showWalletPopover = !showWalletPopover;
		if (showWalletPopover) {
			fetchManagedWallets();
			fetchProfile();
		}
	}

	function copyWalletAddress(addr: string) {
		navigator.clipboard.writeText(addr);
		walletCopied = addr;
		setTimeout(() => (walletCopied = null), 1200);
	}

	function onClickOutsideWallet(e: MouseEvent) {
		if (showWalletPopover && walletPopoverEl && !walletPopoverEl.contains(e.target as Node)) {
			showWalletPopover = false;
		}
	}

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}

	async function handleConnect() {
		try {
			await connectWallet();
			authenticate(getAuthToken());
			fetchSettings();
			fetchFavourites();
		} catch {}
	}

	function handleDisconnect() {
		authenticate(null);
		disconnect();
		clearSettings();
		clearProfile();
	}

	function stopLookupSubscription() {
		if (!lookupWsKey) return;
		unsubscribe(lookupWsKey);
		lookupWsKey = null;
	}

	function beginSearchRequest() {
		clearTimeout(debounceTimer);
		stopLookupSubscription();
		return ++searchGeneration;
	}

	function applyLookupUpdate(tokens: ScannerItem[], generation: number) {
		if (!showSearch || generation !== searchGeneration || tokens.length === 0) return;
		const updates = new Map(tokens.map((token) => [`${token.chain}:${token.pairAddress}`, token]));
		searchResults = searchResults.map((result) => updates.get(`${result.chain}:${result.pairAddress}`) ?? result);
	}

	function startLookupSubscription(results: ScannerItem[], generation: number) {
		if (!showSearch || generation !== searchGeneration || results.length === 0) return;
		const identities = new Map(results.map((result) => [`${result.chain}:${result.pairAddress}`, {
			chain: result.chain,
			tokenOrPairAddress: result.pairAddress
		}]));
		const params = { lookup: [...identities.values()] } satisfies ScannerLookupSubscriptionParams;
		lookupWsKey = subscribe('scanner:lookup', (event, data) => {
			if (!showSearch || generation !== searchGeneration) return;
			if (event === 'SCANNER_TOKENS') {
				applyLookupUpdate((data as ScannerTokensSnapshot).tokens, generation);
			} else if (event === 'SCANNER_UPDATE') {
				applyLookupUpdate((data as ScannerItemsUpdate).tokens, generation);
			}
		}, params);
	}

	function commitSearchResults(results: ScannerItem[], generation: number) {
		if (!showSearch || generation !== searchGeneration) return;
		searchResults = results;
		selectedIdx = results.length > 0 ? 0 : -1;
		startLookupSubscription(results, generation);
	}

	async function fetchWalletResults(query: string, generation: number) {
		if (query.length < 2) {
			if (showSearch && generation === searchGeneration) walletResults = [];
			return;
		}
		let items: TraderRankItem[] = [];
		try {
			const { data, error } = await api.GET('/v2/traders/search', {
				params: { query: { timeRange: 'ONE_DAY', q: query } }
			});
			items = error ? [] : (data?.items ?? []);
		} catch {
			items = [];
		}
		if (showSearch && generation === searchGeneration) {
			walletResults = items;
		}
	}

	async function fetchDefaultResults(generation: number) {
		walletResults = [];
		if (searchMode === 'wallet') {
			if (showSearch && generation === searchGeneration) {
				searchResults = [];
				searching = false;
			}
			return;
		}
		searching = true;
		try {
			const { data } = await api.GET('/v2/scanner/tokens/search', {
				params: { query: { query: '' } }
			});
			commitSearchResults(data?.tokens ?? [], generation);
		} catch {
			if (showSearch && generation === searchGeneration) searchResults = [];
		} finally {
			if (showSearch && generation === searchGeneration) searching = false;
		}
	}

	function openSearch() {
		showSearch = true;
		const generation = beginSearchRequest();
		searchQuery = '';
		searchResults = [];
		walletResults = [];
		selectedIdx = 0;
		fetchDefaultResults(generation);
		setTimeout(() => searchInput?.focus(), 50);
	}

	function closeSearch() {
		beginSearchRequest();
		showSearch = false;
		searchQuery = '';
		searchResults = [];
		walletResults = [];
		searching = false;
	}

	function onSearchInput() {
		const generation = beginSearchRequest();
		const q = searchQuery.trim();
		if (!q) {
			fetchDefaultResults(generation);
			return;
		}
		searching = true;
		selectedIdx = -1;
		debounceTimer = setTimeout(async () => {
			try {
				if (searchMode === 'wallet') {
					walletResults = [];
					if (showSearch && generation === searchGeneration) searchResults = [];
					await fetchWalletResults(q, generation);
				} else {
					walletResults = [];
					const tokenResponse = await api.GET('/v2/scanner/tokens/search', {
						params: { query: { query: q } }
					});
					commitSearchResults(tokenResponse.data?.tokens ?? [], generation);
				}
			} catch {
				if (showSearch && generation === searchGeneration) {
					searchResults = [];
					walletResults = [];
				}
			} finally {
				if (showSearch && generation === searchGeneration) searching = false;
			}
		}, 250);
	}

	function onSearchModeChange(mode: 'token' | 'wallet') {
		if (searchMode === mode) return;
		searchMode = mode;
		onSearchInput();
	}

	function selectResult(result: ScannerItem) {
		closeSearch();
		goto(`/?chain=${result.chain}&token=${result.tokenAddress}`, { noScroll: true });
	}

	function selectWallet(result: TraderRankItem) {
		closeSearch();
		openTraderPortfolio({ chain: result.chain, walletAddress: result.walletAddress });
	}

	function onSearchKeydown(e: KeyboardEvent) {
		const listLen = searchResults.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIdx = Math.min(selectedIdx + 1, Math.max(0, listLen - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIdx = Math.max(selectedIdx - 1, 0);
		} else if (e.key === 'Enter' && selectedIdx >= 0) {
			e.preventDefault();
			if (searchResults[selectedIdx]) selectResult(searchResults[selectedIdx]!);
		} else if (e.key === 'Escape') {
			closeSearch();
		}
	}

	function onGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			if (showSearch) closeSearch();
			else openSearch();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', onGlobalKeydown);
		window.addEventListener('click', onClickOutsideWallet, true);
		if (getIsLoggedIn()) {
			fetchProfile();
			fetchSettings();
			fetchFavourites();
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', onGlobalKeydown);
			window.removeEventListener('click', onClickOutsideWallet, true);
		}
		beginSearchRequest();
	});
</script>

<nav class="fixed top-0 left-0 right-0 z-50 flex h-12 items-center justify-between border-b border-bd bg-s0/90 px-2 md:px-4 backdrop-blur-md">
	<div class="flex items-center gap-2 md:gap-4">
		<a href="/" class="group flex items-center gap-2 text-sm font-bold tracking-[0.15em] text-tx uppercase">
			<OmbraLogo class="h-6 w-6 md:h-7 md:w-7" />
			<span class="hidden sm:inline">Ombra</span>
		</a>

		<button
			onclick={openSearch}
			class="flex w-[11.5rem] min-w-[11.5rem] max-w-[11.5rem] shrink-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg border border-bd bg-s4 px-2 py-1.5 text-sm text-g5 transition-all hover:border-bd3 hover:bg-s7 hover:text-g5 md:gap-2 md:px-3"
		>
			<Search size={14} strokeWidth={2} class="shrink-0" />
			<span class="relative hidden min-w-0 flex-1 md:block">
				<span class="truncate">Search tokens…</span>
			</span>
			<kbd class="ml-auto hidden shrink-0 rounded border border-bd bg-s1 px-1.5 py-0.5 text-[10px] text-g5 sm:inline">⌘K</kbd>
		</button>

	</div>

	
	<!-- Horizontally centered; out of justify-between flow so scrollbar/wallet width cannot shove tabs. -->
	<div class="pointer-events-none absolute inset-x-0 top-0 hidden h-12 items-center justify-center md:flex">
		<div class="pointer-events-auto flex items-center gap-0.5">
	{#each navLinks as link}
				{@const Icon = link.icon}
				{@const active = isActive(link.href)}
				<a
					href={link.href}
					data-sveltekit-preload-data="hover"
					data-sveltekit-preload-code="hover"
					class="relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150
						{active
							? 'text-tx'
							: 'text-g5 hover:text-g8'}"
				>
					<Icon size={14} strokeWidth={1.75} class="shrink-0" />
					<span class="hidden lg:inline">{link.label}</span>
					<span
						class="pointer-events-none absolute bottom-0 left-1/2 h-[2px] w-4 -translate-x-1/2 rounded-full bg-grn transition-opacity {active
							? 'opacity-100'
							: 'opacity-0'}"
						aria-hidden="true"
					></span>
				</a>
			{/each}
		</div>
	</div>

	<div class="flex items-center gap-2">
	<button onclick={openSettings} class="cursor-pointer rounded-lg border border-bd bg-s4 p-1.5 text-g7 transition-all hover:border-bd3 hover:bg-s7 hover:text-tx" title="Settings">
		<Settings size={16} strokeWidth={1.5} />
	</button>
	<button onclick={openThemeBuilder} class="cursor-pointer rounded-lg border border-bd bg-s4 p-1.5 text-g7 transition-all hover:border-bd3 hover:bg-s7 hover:text-tx" title="Theme settings">
		<Palette size={16} strokeWidth={1.5} />
	</button>

	{#if getIsLoggedIn()}
		<div class="relative flex items-center gap-2" bind:this={walletPopoverEl}>
			<button
				onclick={toggleWalletPopover}
				class="flex max-w-[11rem] shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 transition-all hover:border-bd3 hover:bg-s7 {showWalletPopover ? 'border-grn/40 bg-grn/10' : ''}"
			>
				{#if avatarUrl(userProfile?.photoId)}
					<img src={avatarUrl(userProfile?.photoId)} alt="" class="h-5 w-5 rounded-full object-cover ring-1 ring-grn/20" />
				{:else}
					<div class="flex h-5 w-5 items-center justify-center rounded-full bg-grn/20 text-[9px] font-bold text-grn ring-1 ring-grn/20">{userProfile?.username?.[0]?.toUpperCase() ?? '?'}</div>
				{/if}
				<span class="hidden min-w-0 truncate sm:inline text-[13px] font-medium text-g9">{userProfile?.username && userProfile.hasUsername ? userProfile.username : shortAddress(getWalletAddress() ?? '')}</span>
				<ChevronDown size={12} strokeWidth={2} class="text-g5 transition-transform {showWalletPopover ? 'rotate-180' : ''}" />
			</button>

			{#if showWalletPopover}
				<div class="animate-fade-in absolute right-0 top-full mt-2 w-96 flex flex-col rounded-xl border border-bd bg-s5 shadow-2xl shadow-s0/80 backdrop-blur-xl">
					<div class="flex items-center justify-between border-b border-bd px-4 py-3">
						<div class="flex items-center gap-2">
							{#if avatarUrl(userProfile?.photoId)}
								<img src={avatarUrl(userProfile?.photoId)} alt="" class="h-7 w-7 rounded-lg object-cover ring-1 ring-grn/20" />
							{:else}
								<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-grn/10 text-xs font-bold text-grn ring-1 ring-grn/20">{userProfile?.username?.[0]?.toUpperCase() ?? '?'}</div>
							{/if}
							<div>
								<div class="text-xs font-semibold text-tx">{userProfile?.hasUsername ? userProfile.username : 'Wallets'}</div>
								<div class="text-[11px] text-g5">{userProfile ? `Rank #${userProfile.rank}  Level ${userProfile.level.toFixed(0)}  ` : ''}{shortAddress(getWalletAddress() ?? '')}</div>
							</div>
						</div>
						<div class="text-right">
							<div class="text-[11px] text-g6">Total</div>
							<div class="text-sm font-bold text-tx">{formatUsd(totalValueUsd)}</div>
						</div>
					</div>

					<div class="flex flex-col">
						{#if userProfile}
							<div class="grid grid-cols-3 gap-px border-b border-bd bg-bd/50 p-px">
								<div class="bg-s5 px-3 py-2">
									<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Trades</div>
									<div class="mt-0.5 text-sm font-bold text-tx">{userProfile.totalTrades}</div>
								</div>
								<div class="bg-s5 px-3 py-2">
									<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Win Rate</div>
									<div class="mt-0.5 text-sm font-bold {userProfile.winRatePct >= 50 ? 'text-grn' : 'text-red'}">{userProfile.winRatePct.toFixed(1)}%</div>
								</div>
								<div class="bg-s5 px-3 py-2">
									<div class="text-[10px] font-medium uppercase tracking-wider text-g5">W / L</div>
									<div class="mt-0.5 text-sm font-bold"><span class="text-grn">{userProfile.wins}</span> <span class="text-g4">/</span> <span class="text-red">{userProfile.losses}</span></div>
								</div>
								<div class="bg-s5 px-3 py-2">
									<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Total PnL</div>
									<div class="mt-0.5 text-sm font-bold {userProfile.totalPnlUsd >= 0 ? 'text-grn' : 'text-red'}">{formatUsd(userProfile.totalPnlUsd)}</div>
								</div>
								<div class="bg-s5 px-3 py-2">
									<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Wagered</div>
									<div class="mt-0.5 text-sm font-bold text-tx">{formatUsd(userProfile.totalWageredUsd)}</div>
								</div>
								<div class="bg-s5 px-3 py-2">
									<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Referrals</div>
									<div class="mt-0.5 text-sm font-bold text-tx">{userProfile.affiliateCount}</div>
								</div>
							</div>
						{/if}

						<div class="p-2">
							{#if wallets.length > 0}
								{#each wallets as wallet}
									{@const wKey = `${wallet.chain}:${wallet.address}`}
									{@const isOpen = expandedWallets.has(wKey)}
									<div class="rounded-lg px-3 py-2">
										<button
											onclick={() => { const next = new Set(expandedWallets); if (next.has(wKey)) next.delete(wKey); else next.add(wKey); expandedWallets = next; }}
											class="flex w-full cursor-pointer items-center justify-between"
										>
											<div class="flex items-center gap-2">
												<ChevronDown size={12} strokeWidth={2} class="text-g5 transition-transform {isOpen ? 'rotate-0' : '-rotate-90'}" />
												<span class="rounded bg-s7 px-1.5 py-0.5 text-[11px] font-semibold text-g6">{wallet.chain}</span>
											<span
												class="cursor-pointer font-mono text-xs text-g9 transition-colors hover:text-tx"
												role="button"
												tabindex="0"
												onclick={(e) => { e.stopPropagation(); copyWalletAddress(wallet.address); }}
												onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); copyWalletAddress(wallet.address); } }}
											>
													{walletCopied === wallet.address ? 'Copied!' : `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}
												</span>
												{#if wallet.assets.length > 0}
													<span class="text-[10px] text-g4">{wallet.assets.length}</span>
												{/if}
											</div>
											<span class="text-sm font-bold {wallet.totalValueUsd > 0 ? 'text-tx' : 'text-g5'}">{formatUsd(wallet.totalValueUsd)}</span>
										</button>
									{#if isOpen && wallet.assets.length > 0}
										<div class="mt-1.5 max-h-[110px] overflow-y-auto space-y-0.5">
											{#each [...wallet.assets].sort((a, b) => (b.isNative ? 1 : 0) - (a.isNative ? 1 : 0)) as asset}
												{@const sellKey = `${wallet.chain}:${asset.token.address}`}
												<div class="group/asset flex items-center justify-between rounded px-1 py-0.5 text-[11px]">
													<span class="text-g6">{asset.token.symbol}</span>
													<div class="flex items-center gap-1.5">
														<span class="font-mono text-g7">{parseFloat(asset.tokensBalanceStr).toFixed(4)} <span class="text-g5">({formatUsd(asset.valueUsdStr)})</span></span>
														{#if !asset.isNative}
															<button
																onclick={(e) => { e.stopPropagation(); sellToken(wallet.chain, asset.token.address); }}
																disabled={sellingToken === sellKey}
																class="w-12 cursor-pointer rounded bg-red/10 px-1.5 py-0.5 text-[9px] font-semibold text-red opacity-0 transition-all hover:bg-red/20 group-hover/asset:opacity-100 disabled:opacity-50 {sellingToken === sellKey ? '!opacity-100' : ''}"
															>{sellingToken === sellKey ? '...' : 'Sell'}</button>
														{:else}
															<button
																onclick={(e) => { e.stopPropagation(); openWithdraw(wallet.chain, asset); }}
																class="w-12 cursor-pointer rounded bg-s7 px-1.5 py-0.5 text-[9px] font-semibold text-g7 opacity-0 transition-all hover:bg-s6 hover:text-tx group-hover/asset:opacity-100"
															>Withdraw</button>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									{/if}
									</div>
								{/each}
							{:else}
								<div class="flex h-16 items-center justify-center text-xs text-g5">No managed wallets</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		{#if !isPhantomInstalled() && isMobile}
			<button
				onclick={openMobileScan}
				class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-grn px-4 py-1.5 text-[13px] font-semibold text-s0 transition-all hover:bg-grn/90"
			>
				<Camera size={14} strokeWidth={2} />
				Scan QR
			</button>
		{:else}
			<button
				onclick={handleConnect}
				disabled={getIsConnecting()}
				class="cursor-pointer rounded-lg bg-grn px-4 py-1.5 text-[13px] font-semibold text-s0 transition-all hover:bg-grn/90 disabled:opacity-50 disabled:shadow-none"
			>
				{#if getIsConnecting()}
					<span class="flex items-center gap-1.5">
						<LoaderCircle size={12} strokeWidth={4} class="animate-spin" />
						Connecting...
					</span>
				{:else if !isPhantomInstalled()}
					Install Phantom
				{:else}
					Connect Wallet
				{/if}
			</button>
		{/if}
	{/if}
	</div>
</nav>

{#if getAuthError()}
	<div class="animate-slide-down fixed top-14 right-4 z-50 flex items-center gap-2 rounded-lg border border-red/20 bg-s5 px-3 py-2 shadow-lg shadow-red/5 backdrop-blur-sm">
		<div class="h-1.5 w-1.5 rounded-full bg-red"></div>
		<span class="text-sm text-red">{getAuthError()}</span>
	</div>
{/if}

{#if showSearch}
	<div class="fixed inset-0 z-[100] flex items-start justify-center pt-[2vh] md:pt-[12vh]">
		<button class="absolute inset-0 bg-s0/60 backdrop-blur-[2px]" onclick={closeSearch} aria-label="Close search"></button>
		<div class="animate-fade-in relative w-full max-w-xl mx-2 md:mx-0 rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl">
			<div class="flex items-center gap-3 border-b border-bd px-4 py-3.5">
				<Search size={20} strokeWidth={2} class="shrink-0 text-g5" />
				<input
					bind:this={searchInput}
					bind:value={searchQuery}
					oninput={onSearchInput}
					onkeydown={onSearchKeydown}
					type="text"
					placeholder={searchMode === 'wallet'
						? 'Search wallets by address or label...'
						: 'Search tokens by name, symbol, or contract...'}
					class="flex-1 bg-transparent text-[15px] text-tx placeholder-g3 outline-none"
				/>
				{#if searching}
					<LoaderCircle size={16} strokeWidth={4} class="shrink-0 animate-spin text-g5" />
				{/if}
				<kbd class="rounded border border-bd bg-s1 px-1.5 py-0.5 text-[10px] text-g5">ESC</kbd>
			</div>
			<div class="flex items-center gap-2 border-b border-bd px-4 py-2">
				<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Search</span>
				<div class="flex items-center gap-1">
					{#each [{ v: 'token' as const, l: 'Tokens' }, { v: 'wallet' as const, l: 'Wallets' }] as opt}
						<button
							type="button"
							onclick={() => onSearchModeChange(opt.v)}
							class="cursor-pointer rounded-md border px-2 py-1 text-[11px] font-medium transition-colors {searchMode === opt.v ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}"
						>
							{opt.l}
						</button>
					{/each}
				</div>
			</div>

			<div class="max-h-[50vh] overflow-y-auto">
				{#if searchResults.length > 0}
					<div class="border-b border-bd px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-g5">Tokens</div>
					{#each searchResults as result, i (result.pairAddress)}
						{@const migState = result.launchPad?.bondingCurve?.state}
						{@const migPct = result.launchPad?.bondingCurve?.progressPct ?? 0}
						<button
							class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-all duration-100 {i === selectedIdx ? 'bg-grn/10' : 'hover:bg-wh/5'}"
							onclick={() => selectResult(result)}
							onmouseenter={() => (selectedIdx = i)}
						>
						<div
							class="relative h-9 w-9 shrink-0 rounded-xl p-[2px]"
							style={migState === 'Migrated'
								? 'background: var(--t-yel)'
								: migPct > 0
									? `background: conic-gradient(var(--t-grn) ${migPct * 3.6}deg, var(--t-bd2) ${migPct * 3.6}deg)`
									: 'background: var(--t-bd)'}
						>
							{#if result.tokenAddress}
								<img src={tokenImage(result.chain, result.tokenAddress)} alt="" class="h-full w-full rounded-[10px] object-cover" />
							{:else}
								<div class="flex h-full w-full items-center justify-center rounded-[10px] bg-s7 text-xs font-bold text-g6">{result.tokenSymbol?.[0] ?? '?'}</div>
							{/if}
							{#if migState === 'Migrated'}
								<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-s6 px-1 py-px text-[8px] font-bold leading-none text-yel ring-1 ring-yel/20">GRAD</span>
							{:else if migPct > 0}
								<span class="absolute -bottom-1 -right-1 rounded bg-s6 px-0.5 py-px text-[8px] font-bold leading-none text-grn ring-1 ring-bd">{migPct.toFixed(0)}%</span>
							{/if}
						</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="text-sm font-semibold text-tx">{result.tokenSymbol}</span>
									<span class="truncate text-sm text-g5">{result.tokenName}</span>
									<ChainIcon chain={result.chain} class="h-3.5 w-3.5 text-g6" />
								</div>
								<div class="mt-0.5 flex items-center gap-3 text-xs text-g5">
									<span>{@html formatPrice(result.quote.priceUsd)}</span>
									<span>MCap {formatMarketCap(result.quote.marketCapUsd)}</span>
									<span>Liq {formatMarketCap(result.quote.liquidityUsd)}</span>
									<span class={pctColor(result.stats.timeframes['24h'].priceChangePct)}>{formatPercent(result.stats.timeframes['24h'].priceChangePct)}</span>
								</div>
							</div>
							{#if i === selectedIdx}
								<ChevronRight size={16} strokeWidth={2} class="shrink-0 text-grn/40" />
							{/if}
						</button>
					{/each}
				{/if}

				{#if walletResults.length > 0}
					<div class="border-y border-bd px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-g5">Wallets</div>
					{#each walletResults as wallet (`${wallet.chain}:${wallet.walletAddress}`)}
						<button
							type="button"
							class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-wh/5"
							onclick={() => selectWallet(wallet)}
						>
							<WalletIcon address={wallet.walletAddress} photoId={wallet.labels?.[0]?.photoId} size={36} class="h-9 w-9 rounded-xl" />
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									{#if (wallet.labels ?? []).length > 0}
										<span class="truncate text-sm font-semibold text-tx">{wallet.labels![0].label}</span>
										<ChainIcon chain={wallet.chain} class="h-3.5 w-3.5 text-g6" />
										<span class="shrink-0 rounded bg-s7 px-1.5 py-px font-mono text-[10px] font-medium text-g7">{shortAddress(wallet.walletAddress)}</span>
										{#each (wallet.labels ?? []).slice(1) as wl}
											<span class="shrink-0 rounded bg-blu/20 px-1.5 py-px text-[10px] font-medium text-blu">{wl.label}</span>
										{/each}
									{:else}
										<span class="truncate font-mono text-sm font-semibold text-tx">{shortAddress(wallet.walletAddress)}</span>
										<ChainIcon chain={wallet.chain} class="h-3.5 w-3.5 text-g6" />
									{/if}
								</div>
								<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-g5">
									<span>Balance <span class="text-tx">{fmtVal(wallet.walletBalanceUsdStr, wallet.walletBalanceNativeStr, wallet.chain)}</span></span>
									<span>1D PnL <span class={wallet.stats.pnlUsd > 0 ? 'text-grn' : wallet.stats.pnlUsd < 0 ? 'text-red' : 'text-g8'}>{formatUsd(wallet.stats.pnlUsdStr)}</span></span>
									<span>Win {formatPercent(wallet.stats.winRatePct)}</span>
									<span>{formatNumber(wallet.stats.tradeCount)} trades</span>
									<span>{ageFromSeconds(wallet.latestSwapAgeSeconds)}</span>
								</div>
							</div>
							<ChevronRight size={16} strokeWidth={2} class="shrink-0 text-grn/40" />
						</button>
					{/each}
				{/if}

				{#if searchResults.length === 0 && walletResults.length === 0 && searchQuery.trim() && !searching}
					<div class="flex h-24 items-center justify-center text-sm text-g5">No {searchMode === 'wallet' ? 'wallets' : 'tokens'} found</div>
				{:else if searchResults.length === 0 && walletResults.length === 0 && !searchQuery.trim() && !searching}
					<div class="flex h-24 items-center justify-center text-sm text-g5">Type to search {searchMode === 'wallet' ? 'wallets' : 'tokens'}</div>
				{/if}
			</div>

			{#if searchResults.length > 0 || walletResults.length > 0}
				<div class="flex items-center gap-3 border-t border-bd px-4 py-2 text-[11px] text-g5">
					{#if searchResults.length > 0}
						<span class="flex items-center gap-1"><kbd class="rounded border border-bd bg-s1 px-1 py-px text-[10px]">↑↓</kbd> Navigate</span>
						<span class="flex items-center gap-1"><kbd class="rounded border border-bd bg-s1 px-1 py-px text-[10px]">↵</kbd> Select</span>
					{/if}
					<span class="ml-auto"
						>{searchResults.length + walletResults.length} result{(searchResults.length + walletResults.length) !== 1
							? 's'
							: ''}</span
					>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if MobileConnectModal}
	<MobileConnectModal bind:show={showMobileConnect} />
{/if}
{#if MobileScanModal}
	<MobileScanModal bind:show={showMobileScan} />
{/if}
{#if ThemeBuilderModal}
	<ThemeBuilderModal bind:show={showThemeBuilder} />
{/if}
{#if SettingsModal}
	<SettingsModal bind:show={showSettings} onConnectMobile={openMobileConnect} onDisconnect={handleDisconnect} />
{/if}

{#if withdrawingAsset}
	<WalletWithdrawModal
		chain={withdrawingAsset.chain}
		asset={withdrawingAsset.asset}
		onclose={() => (withdrawingAsset = null)}
		oncomplete={onWithdrawComplete}
	/>
{/if}
