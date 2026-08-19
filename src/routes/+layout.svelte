<script lang="ts">
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import MarketStatusRail from '$lib/components/MarketStatusRail.svelte';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import Columns3 from 'lucide-svelte/icons/columns-3';
	import ScanSearch from 'lucide-svelte/icons/scan-search';
	import Zap from 'lucide-svelte/icons/zap';
	import Bot from 'lucide-svelte/icons/bot';
	import Wallet from 'lucide-svelte/icons/wallet';
	import CircleUser from 'lucide-svelte/icons/circle-user';
	import PanelLeftOpen from 'lucide-svelte/icons/panel-left-open';
	import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
	import type { ComponentType } from 'svelte';
	import { initTheme, getTheme, getThemeVersion, tc } from '$lib/stores/theme.svelte';
	import { initThemeBg } from '$lib/stores/themeBg.svelte';
	import { initCurrency } from '$lib/stores/currency.svelte';
	import { initFeSettings, getWatchlistOpen, toggleWatchlistOpen, getActiveToken, getMultiTab, getCallToastSourceIds, isCallToastSourceEnabled } from '$lib/stores/feSettings.svelte';
	import { initTokenTabs, getPopouts, openTokenAsPopout, consumePopoutRedirectSuppressed } from '$lib/stores/tokenTabs.svelte';
	import { beforeNavigate, preloadCode, goto } from '$app/navigation';
	import { tokenImage } from '$lib/api/config';
	import { formatMarketCap } from '$lib/utils/format';
	import type { Chain } from '$lib/api/types';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';
	import { getIsLoggedIn, initAuth, onAuthTokenChange } from '$lib/stores/auth.svelte';
	import { applyFavouritesSnapshot, applySettingsSnapshot } from '$lib/stores/settings.svelte';
	import { applyTradePresetsSnapshot, handleBalanceUpdate, fetchManagedWallets } from '$lib/stores/trade.svelte';
	import { addToast, addActionToast } from '$lib/stores/toast.svelte';
	import { subscribe, unsubscribe, authenticate } from '$lib/ws/client';
	import { onDestroy, onMount } from 'svelte';
	import { startPegPrices, stopPegPrices } from '$lib/stores/peg.svelte';
	import { getTraderOverviewTarget, getTraderPortfolioTarget } from '$lib/stores/traderAnalytics.svelte';
	import { recoverFromChunkLoadError } from '$lib/utils/chunk-recovery';
	import TerminalHome from './+page.svelte';
	import ScannerHome from './scanner/+page.svelte';
	import MemescopeHome from './memescope/+page.svelte';
	import AutobuysHome from './autobuys/+page.svelte';
	import TradersHome from './trader-analytics/+page.svelte';

	let { children }: { children: Snippet } = $props();

	const NAV_PRELOAD = ['/', '/scanner', '/memescope', '/autobuys', '/trader-analytics', '/profile'] as const;

	const path = $derived(page.url.pathname);
	const isTerminal = $derived(path === '/');
	const isScanner = $derived(path.startsWith('/scanner'));
	const isMemescope = $derived(path.startsWith('/memescope'));
	const isAutobuys = $derived(path.startsWith('/autobuys'));
	const isTraders = $derived(path.startsWith('/trader-analytics'));
	/** Profile stays on normal SK routing — keep-alive left a blank main (sidebar only). */
	const isKeepAliveRoute = $derived(
		isTerminal || isScanner || isMemescope || isAutobuys || isTraders
	);

	/** Keep heavy tabs alive — remounting is the multi-second hitch. */
	let terminalRouteMounted = $state(page.url.pathname === '/');
	let scannerRouteMounted = $state(page.url.pathname.startsWith('/scanner'));
	let memescopeRouteMounted = $state(page.url.pathname.startsWith('/memescope'));
	let autobuysRouteMounted = $state(page.url.pathname.startsWith('/autobuys'));
	let tradersRouteMounted = $state(page.url.pathname.startsWith('/trader-analytics'));

	let mobilePositionsOpen = $state(false);
	let mobileWatchlistOpen = $state(false);
	let mobileTwitterOpen = $state(false);
	const isDesktop = $derived(getIsDesktop());

	let WatchlistPanel = $state<any>(null);
	let TwitterFeedPanel = $state<any>(null);
	let PositionsPanel = $state<any>(null);
	let FloatingTokenWindow = $state<any>(null);
	let TraderOverviewDrawer = $state<any>(null);
	let TraderPortfolioModal = $state<any>(null);
	let desktopWatchlistReady = $state(false);

	async function ensureWatchlistPanel() {
		if (!WatchlistPanel) WatchlistPanel = (await import('$lib/components/WatchlistPanel.svelte')).default;
	}
	async function ensureTwitterFeedPanel() {
		if (!TwitterFeedPanel) TwitterFeedPanel = (await import('$lib/components/TwitterFeedPanel.svelte')).default;
	}
	async function ensurePositionsPanel() {
		if (!PositionsPanel) PositionsPanel = (await import('$lib/components/PositionsPanel.svelte')).default;
	}
	async function ensureFloatingTokenWindow() {
		if (!FloatingTokenWindow) FloatingTokenWindow = (await import('$lib/components/FloatingTokenWindow.svelte')).default;
	}
	async function ensureTraderOverviewDrawer() {
		if (!TraderOverviewDrawer) TraderOverviewDrawer = (await import('$lib/components/trader-analytics/TraderOverviewDrawer.svelte')).default;
	}
	async function ensureTraderPortfolioModal() {
		if (!TraderPortfolioModal) TraderPortfolioModal = (await import('$lib/components/trader-analytics/TraderPortfolioModal.svelte')).default;
	}

	/** Set before paint so keep-alive tabs never render an empty main for a frame. */
	$effect.pre(() => {
		if (isTerminal) {
			terminalRouteMounted = true;
		}
		if (isScanner) scannerRouteMounted = true;
		if (isMemescope) memescopeRouteMounted = true;
		if (isAutobuys) autobuysRouteMounted = true;
		if (isTraders) tradersRouteMounted = true;
	});

	$effect(() => {
		if (isDesktop && getWatchlistOpen()) {
			desktopWatchlistReady = true;
			const run = () => {
				void ensureWatchlistPanel();
				void ensureTwitterFeedPanel();
			};
			if (typeof requestIdleCallback === 'function') {
				const id = requestIdleCallback(run, { timeout: 1200 });
				return () => cancelIdleCallback(id);
			}
			const t = setTimeout(run, 50);
			return () => clearTimeout(t);
		}
	});

	/** Warm other nav chunks while idle so hops aren't cold downloads. */
	$effect(() => {
		if (typeof window === 'undefined' || !isKeepAliveRoute) return;
		const run = () => {
			for (const href of NAV_PRELOAD) {
				if (
					(href === '/' && isTerminal) ||
					(href !== '/' && path.startsWith(href))
				) {
					continue;
				}
				void preloadCode(href);
			}
		};
		if (typeof requestIdleCallback === 'function') {
			const id = requestIdleCallback(run, { timeout: 2200 });
			return () => cancelIdleCallback(id);
		}
		const t = setTimeout(run, 500);
		return () => clearTimeout(t);
	});

	$effect(() => {
		if (mobileWatchlistOpen) void ensureWatchlistPanel();
	});
	$effect(() => {
		if (mobileTwitterOpen) void ensureTwitterFeedPanel();
	});
	$effect(() => {
		if (mobilePositionsOpen) void ensurePositionsPanel();
	});
	$effect(() => {
		if (getPopouts().length > 0) void ensureFloatingTokenWindow();
	});
	$effect(() => {
		if (getTraderOverviewTarget()) void ensureTraderOverviewDrawer();
	});
	$effect(() => {
		if (getTraderPortfolioTarget()) void ensureTraderPortfolioModal();
	});

	beforeNavigate((nav) => {
		if (consumePopoutRedirectSuppressed()) return;
		if (!isDesktop || !getMultiTab()) return;
		const to = nav.to?.url;
		if (!to || to.pathname !== '/') return;
		if (nav.from?.url.pathname === '/') return;
		const chain = to.searchParams.get('chain')?.toUpperCase();
		const token = to.searchParams.get('token');
		if (!chain || !token) return;
		nav.cancel();
		// Each token click spawns its own floating window (a floating tab); clicking
		// the same token again just refocuses it. Respects the 5-tab limit.
		openTokenAsPopout(chain as Chain, token, '');
	});

	let sheetDragY = $state(0);
	let sheetDragging = $state(false);
	let sheetStartY = 0;
	const rewardClaimKeys = new Set<string>();

	function handleRewardClaim(event: string, data: any) {
		if (event !== 'REWARDS_CLAIMED_CONFIRMED' || !data?.chain || !Array.isArray(data?.signature)) return;
		const key = `${data.chain}:${data.rewardType}:${data.signature.join(',')}`;
		if (rewardClaimKeys.has(key)) return;
		rewardClaimKeys.add(key);
		if (rewardClaimKeys.size > 50) {
			const oldest = rewardClaimKeys.values().next().value;
			if (oldest) rewardClaimKeys.delete(oldest);
		}
		const label = data.rewardType === 'AFFILIATE' ? 'Affiliate' : 'Cashback';
		addToast('success', `${label} reward claimed`, `${String(data.amount)} on ${data.chain}`);
	}

	// --- Watchlist call toasts (FE-only) ---------------------------------------
	// Fire a clickable toast when one of the user's individually-enabled watchlist
	// sources (telegram / list / wallet) calls a token. Subscribed app-wide so it
	// works regardless of route or whether the watchlist sidebar is mounted.
	const seenCallIds = new Set<string>();
	const callFamilyById: Record<'TG' | 'LIST' | 'WALLET', string> = { TG: 'tg', LIST: 'lists', WALLET: 'wallets' };
	function handleWatchlistCall(data: any, meta: any) {
		const sourceType = meta?.sourceType as 'CALLER' | 'TG' | 'LIST' | 'WALLET' | undefined;
		const sourceId = meta?.sourceId as string | null | undefined;
		if (!sourceType || sourceType === 'CALLER' || !sourceId) return;
		const nsId = `${callFamilyById[sourceType]}:${sourceId}`;
		if (!isCallToastSourceEnabled(nsId)) return;
		const call = data as any;
		const d = call?.callDetails;
		if (!d?.baseTokenAddress || !d?.baseTokenChain) return;
		const dedupeKey = call.id ?? `${nsId}:${d.baseTokenChain}:${d.baseTokenAddress}:${d.calledAtTimestamp}`;
		if (seenCallIds.has(dedupeKey)) return;
		seenCallIds.add(dedupeKey);
		if (seenCallIds.size > 500) { const oldest = seenCallIds.values().next().value; if (oldest) seenCallIds.delete(oldest); }

		const caller = call?.caller;
		const callerName = (caller && 'name' in caller && caller.name) ? caller.name : (sourceType === 'WALLET' ? 'Wallet' : sourceType === 'LIST' ? 'List' : 'Telegram');
		const sym = d.baseTokenSymbol ? `$${d.baseTokenSymbol}` : (d.baseTokenName || 'token');
		const mcap = d.marketCapUsd != null ? `MC ${formatMarketCap(String(d.marketCapUsd))}` : undefined;
		const chain = d.baseTokenChain;
		const address = d.baseTokenAddress;
		addActionToast({
			type: 'info',
			title: `${callerName} called ${sym}`,
			message: mcap,
			iconUrl: tokenImage(chain, address),
			onClick: () => goto(`/?chain=${chain}&token=${address}`, { noScroll: true })
		});
	}

	// Ownership: this is the ONLY place that subscribes for WATCHLIST_CALL (toasts).
	// It uses the bare family topics with NO params, so it has a different server
	// key than WatchlistPanel's WATCHLIST_FEED subscription (which always carries a
	// cursor window) — the two never share or tear down each other's subscription.
	// We open at most 3 family subs (only when any source is enabled) and filter
	// per-event by meta.sourceId, so enabling/disabling individual sources needs no
	// resubscribe.
	$effect(() => {
		if (!getIsLoggedIn()) return;
		if (getCallToastSourceIds().length === 0) return;
		const families = ['watchlist:tg', 'watchlist:lists', 'watchlist:wallets'];
		const keys = families.map((topic) => subscribe(topic, (event, data, _t, meta) => {
			if (event !== 'WATCHLIST_CALL') return;
			handleWatchlistCall(data, meta);
		}));
		return () => { for (const k of keys) unsubscribe(k); };
	});

	$effect(() => {
		if (!getIsLoggedIn()) return;
		fetchManagedWallets();
		const key = subscribe('user', (event, data) => {
			if (event === 'USER_SETTINGS' && data?.settings) {
				applySettingsSnapshot(data);
			} else if (event === 'USER_FAVOURITES' && Array.isArray(data?.favourites)) {
				applyFavouritesSnapshot(data);
			} else if (event === 'TRADE_PRESETS' && data && typeof data === 'object') {
				applyTradePresetsSnapshot(data);
			} else if (event === 'USER_BALANCE') {
				handleBalanceUpdate(data);
			} else {
				handleRewardClaim(event, data);
			}
		});
		return () => unsubscribe(key);
	});

	onMount(() => {
		const handlePreloadError = (event: Event) => {
			const outcome = recoverFromChunkLoadError(event, {
				now: Date.now,
				storage: window.sessionStorage,
				reload: () => window.location.reload()
			});
			if (outcome === 'suppressed') {
				addToast('error', 'Interface update failed', 'Refresh the page to load the latest version.');
			}
		};
		window.addEventListener('vite:preloadError', handlePreloadError);
		initAuth();
		const unbindAuth = onAuthTokenChange((next) => authenticate(next));
		startPegPrices();
		if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
		initTheme();
		initThemeBg();
		initCurrency();
		initFeSettings();
		initTokenTabs();
		const openWatchlistForCaller = () => {
			if (!getIsDesktop()) mobileWatchlistOpen = true;
		};
		window.addEventListener('watchlist-open-caller', openWatchlistForCaller);
		return () => {
			window.removeEventListener('vite:preloadError', handlePreloadError);
			window.removeEventListener('watchlist-open-caller', openWatchlistForCaller);
			unbindAuth();
		};
	});

	onDestroy(() => stopPegPrices());

	$effect(() => {
		void getTheme();
		void getThemeVersion();
		if (typeof document === 'undefined') return;
		const sz = 64;
		const c = document.createElement('canvas');
		c.width = sz;
		c.height = sz;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const grn = tc('--t-grn');
		const grnDark = tc('--t-grn-dark');
		const grad = ctx.createLinearGradient(0, 0, sz, sz);
		grad.addColorStop(0, grn);
		grad.addColorStop(1, grnDark);
		const r = sz * 0.375;
		const ax = sz * 0.382;
		const ay = sz * 0.5;
		const bx = ax + r * 0.6;
		const by = ay - r * 0.1;
		ctx.beginPath();
		ctx.arc(ax, ay, r, 0, Math.PI * 2);
		ctx.arc(bx, by, r, 0, Math.PI * 2, true);
		ctx.fillStyle = grad;
		ctx.fill('evenodd');
		const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		if (link) link.href = c.toDataURL('image/png');
		const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		if (meta) meta.content = tc('--t-s0');
	});

	function onSheetTouchStart(e: TouchEvent) {
		sheetDragging = true;
		sheetStartY = e.touches[0].clientY;
		sheetDragY = 0;
	}

	function onSheetTouchMove(e: TouchEvent) {
		if (!sheetDragging) return;
		const dy = e.touches[0].clientY - sheetStartY;
		sheetDragY = Math.max(0, dy);
	}

	function onSheetTouchEnd(_e: TouchEvent, closeFn: () => void) {
		sheetDragging = false;
		if (sheetDragY > 100) {
			closeFn();
			setTimeout(() => { sheetDragY = 0; }, 250);
		} else {
			sheetDragY = 0;
		}
	}

	const mobileNavLinks: {
		href: string;
		label: string;
		icon: ComponentType;
	}[] = [
		{ href: '/', label: 'Terminal', icon: Columns3 },
		{ href: '/scanner', label: 'Scanner', icon: ScanSearch },
		{ href: '/memescope', label: 'Memes', icon: Zap },
		{ href: '/autobuys', label: 'Bots', icon: Bot },
		{ href: '/trader-analytics', label: 'Traders', icon: Wallet },
		{ href: '/profile', label: 'Profile', icon: CircleUser }
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}
</script>

<div class="flex min-h-screen flex-col bg-s0">
	<Navbar />
	<div
		class="glass fixed top-12 bottom-0 md:bottom-7 left-0 z-10 flex-col border-bd bg-s0 transition-[width] duration-200 ease-in-out overflow-hidden {getWatchlistOpen()
			? 'hidden w-80 border-r md:flex'
			: 'hidden w-0 border-r-0 md:flex'}"
	>
		<div class="flex h-full w-80 flex-col overflow-hidden">
			{#if isDesktop && desktopWatchlistReady && WatchlistPanel}
				<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
					<WatchlistPanel selectedAddress={getActiveToken()} active={true} />
				</div>
				{#if TwitterFeedPanel}
					<TwitterFeedPanel active={true} />
				{/if}
			{/if}
		</div>
	</div>
	<main 	class="flex-1 min-w-0 pt-12 pb-0 md:pb-7 transition-[padding-left] duration-200 ease-in-out {getWatchlistOpen() ? 'md:pl-80' : ''}">
		{#if terminalRouteMounted}
			<div
				class={isTerminal ? '' : 'hidden'}
				aria-hidden={!isTerminal}
				inert={!isTerminal || undefined}
			>
				<TerminalHome routeActive={isTerminal} />
			</div>
		{/if}
		{#if scannerRouteMounted}
			<div
				class={isScanner ? '' : 'hidden'}
				aria-hidden={!isScanner}
				inert={!isScanner || undefined}
			>
				<ScannerHome routeActive={isScanner} />
			</div>
		{/if}
		{#if memescopeRouteMounted}
			<div
				class={isMemescope ? '' : 'hidden'}
				aria-hidden={!isMemescope}
				inert={!isMemescope || undefined}
			>
				<MemescopeHome routeActive={isMemescope} />
			</div>
		{/if}
		{#if autobuysRouteMounted}
			<div
				class={isAutobuys ? '' : 'hidden'}
				aria-hidden={!isAutobuys}
				inert={!isAutobuys || undefined}
			>
				<AutobuysHome routeActive={isAutobuys} />
			</div>
		{/if}
		{#if tradersRouteMounted}
			<div
				class={isTraders ? '' : 'hidden'}
				aria-hidden={!isTraders}
				inert={!isTraders || undefined}
			>
				<TradersHome routeActive={isTraders} />
			</div>
		{/if}
		{#if !isKeepAliveRoute}
			{@render children()}
		{/if}
	</main>
	<button
		onclick={toggleWatchlistOpen}
		class="fixed top-1/2 z-20 h-12 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-bd bg-s1 text-g5 transition-all hover:bg-s7 hover:text-tx hidden md:flex {getWatchlistOpen() ? 'left-80' : 'left-0'}"
		title={getWatchlistOpen() ? 'Close watchlist' : 'Open watchlist'}
	>
		{#if getWatchlistOpen()}
			<PanelLeftClose class="h-3 w-3" strokeWidth={1.5} />
		{:else}
			<PanelLeftOpen class="h-3 w-3" strokeWidth={1.5} />
		{/if}
	</button>
	<MarketStatusRail />
</div>
<ToastContainer />
{#if TraderOverviewDrawer}
	<TraderOverviewDrawer />
{/if}
{#if TraderPortfolioModal}
	<TraderPortfolioModal />
{/if}

{#if isDesktop && FloatingTokenWindow}
	{#each getPopouts() as popout (popout.id)}
		<FloatingTokenWindow {popout} />
	{/each}
{/if}

<div class="fixed bottom-14 left-0 right-0 z-50 flex items-center gap-2 border-t border-bd bg-s1/95 px-3 py-1.5 backdrop-blur-md hide-desktop">
	{#if getIsLoggedIn()}
		<button
			onclick={() => (mobilePositionsOpen = true)}
			class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-[11px] font-medium text-g7 transition-all active:bg-s7"
		>
			Positions
		</button>
	{/if}
	<button
		onclick={() => (mobileWatchlistOpen = true)}
		class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-[11px] font-medium text-g7 transition-all active:bg-s7"
	>
		Watchlist
	</button>
	<button
		onclick={() => (mobileTwitterOpen = true)}
		class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-[11px] font-medium text-g7 transition-all active:bg-s7"
	>
		Feed
	</button>
	{#if getIsLoggedIn() && page.url.pathname === '/'}
		<button
			onclick={() => window.dispatchEvent(new CustomEvent('mobile-trade-open'))}
			class="ml-auto cursor-pointer rounded-xl bg-grn px-5 py-1.5 text-sm font-bold text-s0 transition-all active:scale-95"
		>
			Trade
		</button>
	{/if}
	<MarketStatusRail mobile />
</div>

<nav class="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-stretch border-t border-bd bg-s0/95 backdrop-blur-md mobile-safe-bottom hide-desktop" data-app-bottom-nav>
	{#each mobileNavLinks as link}
		{@const active = isActive(link.href)}
		<a
			href={link.href}
			data-sveltekit-preload-data="hover"
			data-sveltekit-preload-code="hover"
			class="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors
				{active
					? 'text-grn'
					: 'text-g5 active:text-g8'}"
		>
			<link.icon size={20} strokeWidth={1.75} />
			{link.label}
			<span
				class="absolute top-0 h-[2px] w-8 rounded-full bg-grn transition-opacity {active
					? 'opacity-100'
					: 'opacity-0'}"
				aria-hidden="true"
			></span>
		</a>
	{/each}
</nav>

{#snippet mobileSheet(isOpen: boolean, closeFn: () => void, title: string, height: string, children: Snippet)}
	{#if isOpen}
		{@const sheetId = title.toLowerCase().replace(/\s/g, '-')}
		<div class="fixed inset-0 z-[100] md:hidden flex flex-col justify-end">
			<button class="absolute inset-0 bg-s0/50" onclick={closeFn} aria-label="Close"></button>
			<div
				class="glass-strong relative mobile-panel-enter flex flex-col rounded-t-2xl border-t border-bd bg-s2 mobile-safe-bottom"
				style="height: {height}; transform: translateY({sheetDragY}px); transition: {sheetDragging ? 'none' : 'transform 0.25s ease-out'};"
				data-sheet={sheetId}
			>
			<div
				class="shrink-0 cursor-grab active:cursor-grabbing touch-none"
				role="presentation"
				ontouchstart={onSheetTouchStart}
				ontouchmove={onSheetTouchMove}
				ontouchend={(e) => onSheetTouchEnd(e, closeFn)}
			>
				<div class="flex justify-center pt-2 pb-1">
					<div class="h-1 w-10 rounded-full bg-g3"></div>
				</div>
				<div class="flex items-center justify-between px-4 py-2 border-b border-bd">
					<span class="text-sm font-bold text-tx">{title}</span>
					<button onclick={closeFn} class="cursor-pointer rounded-lg p-1.5 text-g5 active:text-tx">
						<span class="text-lg">✕</span>
					</button>
				</div>
			</div>
				<div class="flex flex-1 flex-col min-h-0 overflow-hidden">
					{@render children()}
				</div>
			</div>
		</div>
	{/if}
{/snippet}

<div
	class="fixed inset-0 z-[100] md:hidden flex flex-col justify-end transition-opacity duration-250 {mobilePositionsOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
>
	<button class="absolute inset-0 bg-s0/50" onclick={() => (mobilePositionsOpen = false)} aria-label="Close"></button>
	<div
		class="glass-strong relative flex flex-col rounded-t-2xl border-t border-bd bg-s2 mobile-safe-bottom transition-transform duration-250 ease-out {mobilePositionsOpen ? 'translate-y-0' : 'translate-y-full'}"
		style="height: 75vh; transform: translateY({mobilePositionsOpen ? sheetDragY : 0}px); transition: {sheetDragging ? 'none' : 'transform 0.25s ease-out'};"
		data-sheet="positions"
	>
		<div
			class="shrink-0 cursor-grab active:cursor-grabbing touch-none"
			role="presentation"
			ontouchstart={onSheetTouchStart}
			ontouchmove={onSheetTouchMove}
			ontouchend={(e) => onSheetTouchEnd(e, () => (mobilePositionsOpen = false))}
		>
			<div class="flex justify-center pt-2 pb-1">
				<div class="h-1 w-10 rounded-full bg-g3"></div>
			</div>
			<div class="flex items-center justify-between px-4 py-2 border-b border-bd">
				<span class="text-sm font-bold text-tx">Positions</span>
				<button onclick={() => (mobilePositionsOpen = false)} class="cursor-pointer rounded-lg p-1.5 text-g5 active:text-tx">
					<span class="text-lg">&times;</span>
				</button>
			</div>
		</div>
		<div class="flex flex-1 flex-col min-h-0 overflow-hidden">
			{#if PositionsPanel && (!isDesktop || page.url.pathname !== '/')}
				<PositionsPanel onnavigate={() => (mobilePositionsOpen = false)} />
			{/if}
		</div>
	</div>
</div>

<div
	class="fixed inset-0 z-[100] md:hidden flex flex-col justify-end transition-opacity duration-250 {mobileWatchlistOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
>
	<button class="absolute inset-0 bg-s0/50" onclick={() => (mobileWatchlistOpen = false)} aria-label="Close"></button>
	<div
		class="glass-strong relative flex flex-col rounded-t-2xl border-t border-bd bg-s2 mobile-safe-bottom transition-transform duration-250 ease-out {mobileWatchlistOpen ? 'translate-y-0' : 'translate-y-full'}"
		style="height: 80vh; transform: translateY({mobileWatchlistOpen ? sheetDragY : 0}px); transition: {sheetDragging ? 'none' : 'transform 0.25s ease-out'};"
		data-sheet="watchlist"
	>
	<div
		class="shrink-0 cursor-grab active:cursor-grabbing touch-none"
		role="presentation"
		ontouchstart={onSheetTouchStart}
		ontouchmove={onSheetTouchMove}
		ontouchend={(e) => onSheetTouchEnd(e, () => (mobileWatchlistOpen = false))}
	>
			<div class="flex justify-center pt-2 pb-1">
				<div class="h-1 w-10 rounded-full bg-g3"></div>
			</div>
			<div class="flex items-center justify-between px-4 py-2 border-b border-bd">
				<span class="text-sm font-bold text-tx">Watchlist</span>
				<button onclick={() => (mobileWatchlistOpen = false)} class="cursor-pointer rounded-lg p-1.5 text-g5 active:text-tx">
					<span class="text-lg">✕</span>
				</button>
			</div>
		</div>
		<div class="flex flex-1 flex-col min-h-0 overflow-hidden">
			{#if !isDesktop && mobileWatchlistOpen && WatchlistPanel}
				<WatchlistPanel onnavigate={() => (mobileWatchlistOpen = false)} />
			{/if}
		</div>
	</div>
</div>

<div
	class="fixed inset-0 z-[100] md:hidden flex flex-col justify-end transition-opacity duration-250 {mobileTwitterOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
>
	<button class="absolute inset-0 bg-s0/50" onclick={() => (mobileTwitterOpen = false)} aria-label="Close"></button>
	<div
		class="glass-strong relative flex flex-col rounded-t-2xl border-t border-bd bg-s2 mobile-safe-bottom transition-transform duration-250 ease-out {mobileTwitterOpen ? 'translate-y-0' : 'translate-y-full'}"
		style="height: 80vh; transform: translateY({mobileTwitterOpen ? sheetDragY : 0}px); transition: {sheetDragging ? 'none' : 'transform 0.25s ease-out'};"
		data-sheet="twitter"
	>
	<div
		class="shrink-0 cursor-grab active:cursor-grabbing touch-none"
		role="presentation"
		ontouchstart={onSheetTouchStart}
		ontouchmove={onSheetTouchMove}
		ontouchend={(e) => onSheetTouchEnd(e, () => (mobileTwitterOpen = false))}
	>
			<div class="flex justify-center pt-2 pb-1">
				<div class="h-1 w-10 rounded-full bg-g3"></div>
			</div>
			<div class="flex items-center justify-between px-4 py-2 border-b border-bd">
				<span class="text-sm font-bold text-tx">X Feed</span>
				<button onclick={() => (mobileTwitterOpen = false)} class="cursor-pointer rounded-lg p-1.5 text-g5 active:text-tx">
					<span class="text-lg">✕</span>
				</button>
			</div>
		</div>
		<div class="flex flex-1 flex-col min-h-0 overflow-hidden">
			{#if !isDesktop && mobileTwitterOpen && TwitterFeedPanel}
				<TwitterFeedPanel mobile />
			{/if}
		</div>
	</div>
</div>
