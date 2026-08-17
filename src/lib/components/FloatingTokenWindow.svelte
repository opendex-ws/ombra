<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy, onMount } from 'svelte';
	import X from 'lucide-svelte/icons/x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import PanelTop from 'lucide-svelte/icons/panel-top';
	import type { Chain } from '$lib/api/types';
	import type { TokenPopout } from '$lib/stores/tokenTabs.svelte';
	import { closePopout, closePopoutAndTab, focusPopout, setPopoutPos, setPopoutSize, updatePopoutSymbol, getFocusedPopoutId, suppressPopoutRedirect } from '$lib/stores/tokenTabs.svelte';
	import { getMultiTab } from '$lib/stores/feSettings.svelte';
	import { getPanelZ, bringToFront, dropPanel } from '$lib/stores/floatingPanels.svelte';
	import { goto } from '$app/navigation';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import { api } from '$lib/api/client';
	import { formatPrice, formatMarketCap, formatNumber, formatUsd, fmtVal, shortAddress } from '$lib/utils/format';
	import { isUsd } from '$lib/stores/currency.svelte';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { quickBuy, quickSell, getQuickTradeLoading, getQuickTradeError, getTradeForToken } from '$lib/stores/trade.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import ChainIcon from './ChainIcon.svelte';
	import Copy from 'lucide-svelte/icons/copy';
	import Check from 'lucide-svelte/icons/check';
	import Globe from 'lucide-svelte/icons/globe';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Flame from 'lucide-svelte/icons/flame';
	import Coins from 'lucide-svelte/icons/coins';
	import { siX, siTelegram, siDiscord, siInstagram } from 'simple-icons';
	import { portal } from '$lib/actions/portal';

	let { popout }: { popout: TokenPopout } = $props();

	let TokenChart = $state<any>(null);
	$effect(() => {
		if (!TokenChart) {
			void import('./TokenChart.svelte').then((m) => { TokenChart = m.default; });
		}
	});

	let winEl = $state<HTMLDivElement | null>(null);
	let chartWrapEl = $state<HTMLDivElement | null>(null);
	let chartHeight = $state(220);

	const focused = $derived(getFocusedPopoutId() === popout.id);

	let priceStr = $state('');
	let mcapStr = $state('');
	let priceChange = $state(0);
	let athPriceStr = $state<string | null>(null);
	let athMcapStr = $state<string | null>(null);
	let callCount = $state(0);
	let buys = $state(0);
	let sells = $state(0);
	let volStr = $state('');

	let socialLinks = $state<{ website?: string | null; twitter?: string | null; twitterHandle?: string | null; telegram?: string | null; instagram?: string | null; discord?: string | null } | null>(null);
	let aiNarrative = $state<string | null>(null);
	let isMayhem = $state(false);
	let cashbackPct = $state(0);
	let aiOpen = $state(false);
	const hasLinks = $derived(!!(socialLinks && (socialLinks.website || socialLinks.twitter || socialLinks.telegram || socialLinks.instagram || socialLinks.discord)));
	const hasMetaRow = $derived(hasLinks || !!aiNarrative || isMayhem || cashbackPct > 0);

	let copied = $state(false);

	let previewPos = $state<{ x: number; y: number } | null>(null);
	const PREVIEW_SIZE = 180;
	function showPreview(e: MouseEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		let x = r.left;
		let y = r.bottom + 8;
		if (x + PREVIEW_SIZE > window.innerWidth - 8) x = window.innerWidth - 8 - PREVIEW_SIZE;
		if (y + PREVIEW_SIZE > window.innerHeight - 8) y = r.top - 8 - PREVIEW_SIZE;
		previewPos = { x: Math.max(8, x), y: Math.max(8, y) };
	}
	function hidePreview() { previewPos = null; }

	function copyAddress() {
		navigator.clipboard?.writeText(popout.address).then(() => {
			copied = true;
			addToast('success', 'Address copied');
			setTimeout(() => (copied = false), 1500);
		}).catch(() => {});
	}

	let buyAmount = $state('');
	let sellPct = $state(50);

	const position = $derived(getTradeForToken(popout.chain, popout.address));
	const hasPosition = $derived(!!position && position.tokensRemaining > 0);
	// API pnl is gross; show net of fees.
	const netPnlUsd = $derived(position ? position.pnl.usd - (position.totalFees?.usd ?? 0) : 0);
	const netPnlNative = $derived(position ? position.pnl.native - (position.totalFees?.native ?? 0) : 0);
	const netPnlPct = $derived.by(() => {
		if (!position) return 0;
		const basis = position.totalBought?.usd ?? 0;
		return basis > 0 ? (netPnlUsd / basis) * 100 : position.pnl.pct;
	});
	const netPnlMultiplier = $derived.by(() => {
		if (!position) return 0;
		const basis = position.totalBought?.usd ?? 0;
		return basis > 0 ? Math.max(0, (basis + netPnlUsd) / basis) : position.pnl.multiplier;
	});
	const pnlColor = $derived(netPnlUsd < 0 ? 'text-red' : 'text-grn');

	const buyLoading = $derived(getQuickTradeLoading(popout.chain, popout.address));
	const tradeErr = $derived(getQuickTradeError(popout.chain, popout.address));

	let wsKey = '';
	$effect(() => {
		const chain = popout.chain;
		const address = popout.address;
		priceStr = '';
		mcapStr = '';
		if (wsKey) { unsubscribe(wsKey); wsKey = ''; }
		wsKey = subscribe(`token:${chain}:${address}:price`, (event, data) => {
			if (event !== 'TOKEN_PRICE') return;
			const p = data?.quote?.priceUsdStr ?? data?.quote?.priceUsd;
			const mc = data?.quote?.marketCapUsdStr ?? data?.quote?.marketCapUsd;
			const sym = data?.tokenSymbol;
			if (p != null) priceStr = String(p);
			if (mc != null) mcapStr = String(mc);
			const tf = data?.stats?.timeframes?.['1h'];
			if (typeof tf?.priceChangePct === 'number') priceChange = tf.priceChangePct;
			if (typeof tf?.buys === 'number') buys = tf.buys;
			if (typeof tf?.sells === 'number') sells = tf.sells;
			if (tf?.volumeStr != null) volStr = String(tf.volumeStr);
			if (sym) updatePopoutSymbol(popout.id, sym);
		});
		return () => { if (wsKey) { unsubscribe(wsKey); wsKey = ''; } };
	});

	onDestroy(() => { if (wsKey) unsubscribe(wsKey); dropPanel(popout.id); previewPos = null; });

	$effect(() => {
		const chain = popout.chain;
		const address = popout.address;
		let cancelled = false;
		athPriceStr = null;
		athMcapStr = null;
		callCount = 0;
		buys = 0;
		sells = 0;
		volStr = '';
		socialLinks = null;
		aiNarrative = null;
		isMayhem = false;
		cashbackPct = 0;
		aiOpen = false;
		(async () => {
			try {
				const { data } = await api.GET('/v2/token/{chain}/{address}', {
					params: { path: { chain, address } }
				});
				if (cancelled || !data) return;
				athPriceStr = data.athPriceUsdStr ?? null;
				athMcapStr = data.athMarketCapUsdStr ?? null;
				callCount = data.calls ?? 0;
				const tf = data.stats?.timeframes?.['1h'];
				if (tf) { buys = tf.buys ?? 0; sells = tf.sells ?? 0; volStr = tf.volumeStr ?? ''; }
				if (!priceStr && data.quote?.priceUsdStr) priceStr = data.quote.priceUsdStr;
				if (!mcapStr && data.quote?.marketCapUsdStr) mcapStr = data.quote.marketCapUsdStr;
				if (data.tokenSymbol) updatePopoutSymbol(popout.id, data.tokenSymbol);
				const l = data.socials?.links;
				socialLinks = l ? {
					website: l.website ?? null,
					twitter: l.twitter?.url ?? null,
					twitterHandle: l.twitter?.handle ?? null,
					telegram: l.telegram ?? null,
					instagram: l.instagram ?? null,
					discord: l.discord ?? null
				} : null;
				aiNarrative = data.socials?.aiNarrative?.trim() || null;
				const pf = data.launchPad?.pumpfun ?? null;
				isMayhem = pf?.isMayhem ?? false;
				cashbackPct = pf?.cashbackPct ?? 0;
			} catch {}
		})();
		return () => { cancelled = true; };
	});

	function focus() {
		focusPopout(popout.id);
		bringToFront(popout.id);
	}

	let dragging = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let dragOrigin = { x: 0, y: 0 };

	function onDragMove(ev: MouseEvent) {
		if (!dragging) return;
		const nx = Math.max(0, Math.min(window.innerWidth - 120, dragOrigin.x + ev.clientX - dragStartX));
		const ny = Math.max(48, Math.min(window.innerHeight - 40, dragOrigin.y + ev.clientY - dragStartY));
		setPopoutPos(popout.id, nx, ny);
	}

	function onDragUp() {
		dragging = false;
		window.removeEventListener('mousemove', onDragMove);
		window.removeEventListener('mouseup', onDragUp);
		document.body.style.userSelect = '';
	}

	function onDragDown(ev: MouseEvent) {
		if ((ev.target as HTMLElement).closest('[data-no-drag]')) return;
		focus();
		dragging = true;
		dragStartX = ev.clientX;
		dragStartY = ev.clientY;
		dragOrigin = { x: popout.x, y: popout.y };
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', onDragMove);
		window.addEventListener('mouseup', onDragUp);
	}

	onMount(() => {
		bringToFront(popout.id);
		if (!winEl) return;
		const el = winEl;
		const ro = new ResizeObserver(() => {
			if (el.offsetWidth > 0 && el.offsetHeight > 0) {
				setPopoutSize(popout.id, el.offsetWidth, el.offsetHeight);
				chartHeight = Math.max(140, el.offsetHeight - 340);
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	async function doBuy() {
		const amt = parseFloat(buyAmount);
		if (isNaN(amt) || amt <= 0) return;
		await quickBuy(popout.chain, popout.address, amt, isUsd() ? 'USD' : 'NATIVE');
		if (!getQuickTradeError(popout.chain, popout.address)) buyAmount = '';
	}

	async function doSell() {
		await quickSell(popout.chain, popout.address, sellPct);
	}

	function restoreToTab() {
		const { chain, address } = popout;
		closePopout(popout.id);
		if (getMultiTab()) {
			suppressPopoutRedirect();
			goto(`/?chain=${chain}&token=${address}`);
		}
	}
</script>

<div
	bind:this={winEl}
	class="fixed flex flex-col overflow-hidden rounded-xl border bg-s2 shadow-2xl glass-strong {focused ? 'border-grn/40' : 'border-bd'}"
	style="left: {popout.x}px; top: {popout.y}px; width: {popout.w}px; height: {popout.h}px; z-index: {getPanelZ(popout.id)}; resize: both; min-width: 320px; min-height: 320px;"
	role="dialog"
	tabindex="-1"
	onmousedown={focus}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex shrink-0 cursor-grab items-center gap-2 border-b border-bd bg-s1 px-2.5 py-1.5 active:cursor-grabbing"
		onmousedown={onDragDown}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center" onmouseenter={showPreview} onmouseleave={hidePreview}>
			<img src={tokenImage(popout.chain, popout.address)} alt="" class="h-4 w-4 rounded-[4px]" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
		</span>
		<span class="truncate text-xs font-semibold text-tx">{popout.symbol || popout.address.slice(0, 6)}</span>
		{#if priceStr}
			<span class="text-[11px] font-medium text-g8">{@html formatPrice(priceStr)}</span>
		{/if}
		{#if mcapStr}
			<span class="text-[10px] text-g5">MC {formatMarketCap(mcapStr)}</span>
		{/if}
		{#if priceChange !== 0}
			<span class="text-[10px] font-semibold {priceChange > 0 ? 'text-grn' : 'text-red'}">{priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%</span>
		{/if}
		<button
			data-no-drag
			onclick={restoreToTab}
			class="ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-g5 transition-colors hover:bg-s7 hover:text-tx"
			title="Put back into tab"
		>
			<PanelTop class="h-3.5 w-3.5" />
		</button>
		<button
			data-no-drag
			onclick={() => closePopoutAndTab(popout.id)}
			class="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-g5 transition-colors hover:bg-s7 hover:text-tx"
			title="Close"
		>
			<X class="h-3.5 w-3.5" />
		</button>
	</div>

	{#if hasMetaRow}
		<div data-no-drag class="shrink-0 border-b border-bd bg-s1/60 px-2.5 py-1">
			<div class="flex flex-wrap items-center gap-1.5">
				{#if socialLinks?.website}
					<a href={socialLinks.website} target="_blank" rel="noopener" title="Website" class="text-g5 transition-colors hover:text-grn"><Globe class="h-3 w-3" strokeWidth={2.5} /></a>
				{/if}
				{#if socialLinks?.twitter}
					<a href={socialLinks.twitter} target="_blank" rel="noopener" title={socialLinks.twitterHandle ? `@${socialLinks.twitterHandle}` : 'Twitter'} class="text-g5 transition-colors hover:text-grn"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg></a>
				{/if}
				{#if socialLinks?.telegram}
					<a href={socialLinks.telegram} target="_blank" rel="noopener" title="Telegram" class="text-g5 transition-colors hover:text-grn"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siTelegram.path}/></svg></a>
				{/if}
				{#if socialLinks?.instagram}
					<a href={socialLinks.instagram} target="_blank" rel="noopener" title="Instagram" class="text-g5 transition-colors hover:text-grn"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siInstagram.path}/></svg></a>
				{/if}
				{#if socialLinks?.discord}
					<a href={socialLinks.discord} target="_blank" rel="noopener" title="Discord" class="text-g5 transition-colors hover:text-grn"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siDiscord.path}/></svg></a>
				{/if}
				{#if aiNarrative}
					<button onclick={() => (aiOpen = !aiOpen)} title="AI summary" class="text-g5 transition-colors hover:text-grn {aiOpen ? 'text-grn' : ''}"><Sparkles class="h-3 w-3" /></button>
				{/if}
				{#if isMayhem}
					<span class="text-org" title="Mayhem"><Flame class="h-3 w-3" /></span>
				{/if}
				{#if cashbackPct > 0}
					<span class="flex items-center gap-0.5 text-grn" title="Cashback {cashbackPct}%"><Coins class="h-3 w-3" /></span>
				{/if}
			</div>
			{#if aiNarrative && aiOpen}
				<p class="mt-1 text-[10px] leading-relaxed text-g8">{aiNarrative}</p>
			{/if}
		</div>
	{/if}

	<div data-no-drag class="flex shrink-0 items-center gap-2 border-b border-bd bg-s1/60 px-2.5 py-1 text-[10px]">
		<button onclick={copyAddress} class="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 font-mono text-g6 transition-colors hover:bg-s7 hover:text-tx" title="Copy address">
			{shortAddress(popout.address)}
			{#if copied}<Check class="h-3 w-3 text-grn" />{:else}<Copy class="h-3 w-3" />{/if}
		</button>
		<span class="flex items-center gap-1 text-g5">
			<span class="rounded bg-s4 px-1 py-px font-semibold text-g8">{callCount}</span> calls
		</span>
		<div class="ml-auto flex items-center gap-2">
			<span class="text-grn">B <span class="font-semibold text-tx">{buys}</span></span>
			<span class="text-red">S <span class="font-semibold text-tx">{sells}</span></span>
			{#if volStr}<span class="text-g5">Vol <span class="font-semibold text-g8">{formatUsd(volStr)}</span></span>{/if}
		</div>
	</div>

	<div bind:this={chartWrapEl} class="shrink-0 overflow-hidden p-1.5" style="height: {chartHeight + 58}px;">
		{#if TokenChart}
			{#key popout.chain + ':' + popout.address}
				<TokenChart chain={popout.chain} address={popout.address} chartHeight={chartHeight} athPrice={athPriceStr} athMcap={athMcapStr} />
			{/key}
		{:else}
			<div class="flex h-full items-center justify-center text-g5"><LoaderCircle class="h-5 w-5 animate-spin" /></div>
		{/if}
	</div>

	<div data-no-drag class="flex min-h-0 flex-1 flex-col justify-start overflow-y-auto border-t border-bd px-2.5 py-2">
		{#if hasPosition && position}
			<div class="rounded-lg border border-bd bg-s1 p-2.5">
				<div class="flex items-center justify-between">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Position</span>
					<span class="text-[11px] font-semibold {pnlColor}">{netPnlPct.toFixed(1)}% {#if position.pnl.multiplier}<span class="text-yel">{netPnlMultiplier.toFixed(2)}x</span>{/if}</span>
				</div>
				<div class="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
					<div>
						<div class="text-[9px] uppercase tracking-wider text-g5">Value</div>
						<div class="text-xs font-semibold text-tx">{fmtVal(String(position.currentValue.usd), String(position.currentValue.native), position.chain)}</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider text-g5">PnL</div>
						<div class="text-xs font-semibold {pnlColor}">{fmtVal(String(netPnlUsd), String(netPnlNative), position.chain)}</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider text-g5">Holding</div>
						<div class="text-xs font-semibold text-tx">{formatNumber(String(position.tokensRemaining))} {position.tokenSymbol}</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider text-g5">Avg Entry</div>
						<div class="text-xs font-semibold text-tx">{@html formatPrice(String(position.avgEntryPrice.usd))}</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center gap-1 py-3 text-center">
				<span class="text-xs font-medium text-g6">No tokens held</span>
				<span class="text-[10px] text-g5">Buy below to open a position</span>
			</div>
		{/if}
	</div>

	<div data-no-drag class="shrink-0 border-t border-bd bg-s0 p-2">
		{#if !getIsLoggedIn()}
			<div class="py-1 text-center text-[11px] text-g5">Connect wallet to trade</div>
		{:else}
			{#if tradeErr}
				<div class="mb-1.5 rounded bg-red/10 px-2 py-1 text-[10px] text-red">{tradeErr}</div>
			{/if}
			<div class="flex items-center gap-1.5">
				<div class="relative flex-1">
					<input
						type="number"
						bind:value={buyAmount}
						placeholder="0.0"
						class="w-full rounded-lg border border-bd bg-s4 px-2 py-1.5 pr-10 text-xs text-tx outline-none"
					/>
					<span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center text-[10px] font-bold text-g5">{#if isUsd()}USD{:else}<ChainIcon chain={popout.chain} class="h-3.5 w-3.5 text-g5" />{/if}</span>
				</div>
				<button
					onclick={doBuy}
					disabled={buyLoading || !buyAmount}
					class="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-50"
				>
					{#if buyLoading}<LoaderCircle class="h-3 w-3 animate-spin" />{/if}
					Buy
				</button>
			</div>
			{#if hasPosition}
				<div class="mt-1.5 flex items-center gap-1.5">
					<div class="flex flex-1 gap-1">
						{#each [25, 50, 100] as p}
							<button
								onclick={() => (sellPct = p)}
								class="flex-1 cursor-pointer rounded-md border py-1 text-[10px] font-semibold transition-colors {sellPct === p ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}"
							>{p}%</button>
						{/each}
					</div>
					<button
						onclick={doSell}
						disabled={buyLoading}
						class="btn-danger-outline px-3 py-1.5 text-xs disabled:opacity-50"
					>
						Sell {sellPct}%
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>

{#if previewPos}
	<div
		use:portal
		class="pointer-events-none fixed z-[300] rounded-xl border border-bd bg-s4 p-1 shadow-2xl"
		style="left: {previewPos.x}px; top: {previewPos.y}px; width: {PREVIEW_SIZE}px; height: {PREVIEW_SIZE}px;"
	>
		<img src={tokenImage(popout.chain, popout.address)} alt="" class="h-full w-full rounded-lg object-cover" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
	</div>
{/if}
