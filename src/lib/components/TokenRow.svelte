<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy } from 'svelte';
	import type { ScannerItem } from '$lib/api/types';
	import { formatPrice, formatMarketCap, formatPercent, formatNumber, liveAge, fmtVal, fmtPriceHtml, pctColor } from '$lib/utils/format';
	import { getRouterInfo, getRouterIconForChain } from '$lib/utils/routers';
	import { siX, siTelegram, siDiscord, siInstagram } from 'simple-icons';
	import { getNow } from '$lib/stores/tick.svelte';
	import Globe from 'lucide-svelte/icons/globe';
	import Heart from 'lucide-svelte/icons/heart';
	import Flame from 'lucide-svelte/icons/flame';
	import Coins from 'lucide-svelte/icons/coins';
	import DexPaidIcon from './DexPaidIcon.svelte';
	import { buildSparkline } from '$lib/utils/sparkline';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { getFavourites, addFavourite, removeFavourite } from '$lib/stores/settings.svelte';
	import { portal } from '$lib/actions/portal';

	import type { RowFlashType } from '$lib/utils/scanner-ws';

	let { token, rank = 0, selected = false, cols = '', compact = false, rowFlash = undefined, showImage = true, onselect }: { token: ScannerItem; rank?: number; selected?: boolean; cols?: string; compact?: boolean; rowFlash?: RowFlashType; showImage?: boolean; onselect?: (token: ScannerItem) => void } = $props();

	function fmtHolderPct(value: string | null | undefined): string {
		if (!value) return '—';
		const num = parseFloat(value);
		if (isNaN(num)) return '—';
		return `${num.toFixed(1)}%`;
	}

	function holderPctColor(value: string | null | undefined): string {
		if (!value) return 'text-g6';
		const num = parseFloat(value);
		if (isNaN(num)) return 'text-g6';
		if (num > 50) return 'text-red';
		if (num > 30) return 'text-yel';
		return 'text-g7';
	}

	function handleClick(e: MouseEvent) {
		if (onselect) {
			e.preventDefault();
			onselect(token);
		}
	}

	function openSocial(e: MouseEvent, url: string | null) {
		e.preventDefault();
		e.stopPropagation();
		if (url) window.open(url, '_blank');
	}

	const createdMs = $derived(token.createdAtTimestampStr ? Date.parse(token.createdAtTimestampStr) : NaN);

	let prev: Record<string, string> = {};
	let prevNum: Record<string, number> = {};
	let flashes: Record<string, 'up' | 'down'> = $state({});
	let timers: Record<string, ReturnType<typeof setTimeout>> = {};

	onDestroy(() => {
		for (const key in timers) clearTimeout(timers[key]);
	});

	function flash(key: string, oldNum: number, newNum: number) {
		const dir = newNum > oldNum ? 'up' : 'down';
		flashes = { ...flashes, [key]: dir };
		clearTimeout(timers[key]);
		timers[key] = setTimeout(() => {
			const { [key]: _, ...rest } = flashes;
			flashes = rest;
		}, 800);
	}

	function fc(key: string): string {
		const f = flashes[key];
		if (!f) return '';
		return f === 'up' ? 'flash-up' : 'flash-down';
	}

	$effect(() => {
		const entries: [string, string | undefined | null, (v: string | number | undefined | null) => string][] = [
			['price', token.quote.priceUsdStr, formatPrice],
			['mcap', token.quote.marketCapUsdStr, formatMarketCap],
			['liq', token.quote.liquidityUsdStr, formatMarketCap],
			['vol', token.stats.total.volumeStr, formatMarketCap],
			['holders', String(token.holders?.holderCount ?? ''), formatNumber],
			['d5m', String(token.stats.timeframes['5m'].priceChangePct), formatPercent],
			['d1h', String(token.stats.timeframes['1h'].priceChangePct), formatPercent],
			['d6h', String(token.stats.timeframes['6h'].priceChangePct), formatPercent],
			['d24h', String(token.stats.timeframes['24h'].priceChangePct), formatPercent],
		];
		for (const [key, raw, fmt] of entries) {
			const num = parseFloat(raw ?? '');
			const display = fmt(raw);
			if (!isNaN(num) && prev[key] !== undefined && display !== prev[key]) {
				flash(key, prevNum[key], num);
			}
			if (!isNaN(num)) {
				prev[key] = display;
				prevNum[key] = num;
			}
		}
	});

	let sparklineData = $derived(buildSparkline(token.sparkline, 100, 36, `sg-${token.pairAddress.slice(0, 8)}`));

	let router = $derived(getRouterInfo(token.platformType ?? ''));
	let routerIcon = $derived(token.platformType ? getRouterIconForChain(token.platformType, token.chain ?? '') : router.icon);
	let migPct = $derived(token.launchPad?.bondingCurve?.progressPct ?? 0);
	let isGraduated = $derived(token.launchPad?.bondingCurve?.state === 'Migrated');
	let migratedFromIcon = $derived.by(() => {
		const bc = token.launchPad?.bondingCurve;
		if (bc?.state !== 'Migrated' || !bc.migratedFromPlatformType) return '';
		return getRouterIconForChain(bc.migratedFromPlatformType, token.chain ?? '');
	});
	let sec = $derived(token.audit);
	let h = $derived(token.holders);
	// Flatten the new nested social links to the URL strings the row displays.
	let soc = $derived.by(() => {
		const l = token.socials?.links;
		return {
			website: l?.website ?? null,
			twitter: l?.twitter?.url ?? null,
			telegram: l?.telegram ?? null,
			discord: l?.discord ?? null,
			instagram: l?.instagram ?? null
		};
	});
	let pumpfun = $derived(token.launchPad?.pumpfun ?? null);
	let isMayhem = $derived(pumpfun?.isMayhem ?? false);
	let cashbackPct = $derived(pumpfun?.cashbackPct ?? 0);
	let isFav = $derived(getFavourites().some((f: { token: { chain: string; address: string } }) => f.token.chain === token.chain && f.token.address === token.tokenAddress));
	let favToggling = $state(false);

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
	onDestroy(() => { previewPos = null; });

	async function toggleFav(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (favToggling || !getIsLoggedIn()) return;
		favToggling = true;
		try {
			if (isFav) await removeFavourite(token.chain as any, token.tokenAddress);
			else await addFavourite(token.chain as any, token.tokenAddress);
		} finally { favToggling = false; }
	}
</script>

<a
	href="/?chain={token.chain}&token={token.tokenAddress}"
	class="group grid h-[72px] items-center gap-x-2 border-b border-bd/40 px-4 transition-colors duration-75 hover:bg-wh/5 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_72px] {selected ? 'bg-wh/5' : ''} {rowFlash ? `row-flash-${rowFlash}` : ''}"
	style:grid-template-columns={cols}
	onclick={handleClick}
>
	<div class="text-center text-sm text-g6">{rank}</div>

	<div class="flex items-center gap-2.5 pl-1 overflow-visible">
		<div
			class="relative h-9 w-9 shrink-0 rounded-xl p-[2px]"
			onmouseenter={showImage && token.tokenAddress ? showPreview : undefined}
			onmouseleave={hidePreview}
			role="presentation"
		style={isGraduated
			? 'background: var(--t-yel)'
			: migPct > 0
				? `background: conic-gradient(var(--t-grn) ${migPct * 3.6}deg, var(--t-bd2) ${migPct * 3.6}deg)`
				: 'background: var(--t-bd)'}
		>
			{#if showImage && token.tokenAddress}
				<img src={tokenImage(token.chain, token.tokenAddress)} alt="" class="h-full w-full rounded-[10px] object-cover" />
			{:else}
				<div class="flex h-full w-full items-center justify-center rounded-[10px] bg-s7 text-xs font-bold text-g6">
					{token.tokenSymbol?.[0] ?? '?'}
				</div>
			{/if}
			<span class="absolute -right-1.5 -top-1.5 inline-flex items-center" title={token.chain}>
				<img src="/icons/{token.chain?.toLowerCase()}.png" alt={token.chain} class="h-4 w-4 rounded-full ring-1 ring-s6" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
				{#if routerIcon}
					<img src={routerIcon} alt={router.name} title={router.name} class="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" />
				{/if}
				{#if migratedFromIcon}
					<img src={migratedFromIcon} alt="Migrated from" class="absolute -top-1 left-0 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" title="Migrated from {(token.launchPad?.bondingCurve as any)?.migratedFromPlatformName ?? ''}" />
				{/if}
			</span>
			{#if isGraduated}
				<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-s6 px-1 py-px text-[8px] font-bold leading-none text-yel ring-1 ring-yel/20">GRAD</span>
			{:else if migPct > 0}
				<span class="absolute -bottom-1 -right-1 rounded bg-s6 px-0.5 py-px text-[8px] font-bold leading-none text-grn ring-1 ring-bd">{migPct.toFixed(0)}%</span>
			{/if}
		</div>
		<div class="min-w-0">
			<div class="flex items-center gap-1.5">
				<span class="truncate text-[15px] font-semibold text-tx group-hover:text-wh">{token.tokenSymbol}</span>
				{#if token.calls > 0}
					<span class="rounded bg-wh/10 px-1 py-px text-[10px] font-medium text-tx">{token.calls}</span>
				{/if}
			{#if token.audit?.dexScreenerPaid}
				<span title="DexScreener Paid"><DexPaidIcon /></span>
			{/if}
			{#if isMayhem}
				<span class="text-org" title="Mayhem"><Flame class="h-3 w-3" /></span>
			{/if}
			{#if cashbackPct > 0}
				<span class="text-grn" title="Cashback {cashbackPct}%"><Coins class="h-3 w-3" /></span>
			{/if}
			</div>
			<div class="mt-0.5 flex items-center gap-1">
				{#if soc.twitter}
					<button onclick={(e) => openSocial(e, soc.twitter)} class="cursor-pointer text-g5 transition-colors hover:text-grn" title="Twitter"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg></button>
				{/if}
				{#if soc.telegram}
					<button onclick={(e) => openSocial(e, soc.telegram)} class="cursor-pointer text-g5 transition-colors hover:text-grn" title="Telegram"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siTelegram.path}/></svg></button>
				{/if}
				{#if soc.instagram}
					<button onclick={(e) => openSocial(e, soc.instagram)} class="cursor-pointer text-g5 transition-colors hover:text-grn" title="Instagram"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siInstagram.path}/></svg></button>
				{/if}
				{#if soc.discord}
					<button onclick={(e) => openSocial(e, soc.discord)} class="cursor-pointer text-g5 transition-colors hover:text-grn" title="Discord"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siDiscord.path}/></svg></button>
				{/if}
				{#if soc.website}
					<button onclick={(e) => openSocial(e, soc.website)} class="cursor-pointer text-g5 transition-colors hover:text-grn" title="Website"><Globe class="h-3 w-3" strokeWidth={2.5} /></button>
				{/if}
			</div>
		</div>
		{#if getIsLoggedIn()}
			<div
				onclick={toggleFav}
				onkeydown={(e) => { if (e.key === 'Enter') toggleFav(e as any); }}
				role="button"
				tabindex="0"
				class="ml-auto shrink-0 cursor-pointer transition-colors hover:text-pnk {isFav ? 'text-pnk' : 'text-g7'} {favToggling ? 'opacity-50' : ''}"
				title={isFav ? 'Remove from favourites' : 'Add to favourites'}
			>
				<Heart class="h-3.5 w-3.5" fill={isFav ? 'currentColor' : 'none'} />
			</div>
		{/if}
	</div>

	<div class="text-center text-[15px] text-g7">{liveAge(createdMs, getNow())}</div>

	<div class="text-right">
		<div class="text-[15px] font-medium text-tx"><span class={fc('mcap')}>{formatMarketCap(token.quote.marketCapUsdStr)}</span></div>
		<div class="text-xs text-g6">{formatMarketCap(token.quote.fullyDilutedValueStr)}</div>
	</div>

	{#if !compact}
		<div class="text-right">
			<div class="text-[15px] text-tx"><span class={fc('liq')}>{fmtVal(token.quote.liquidityUsdStr, token.quote.liquidityNativeStr, token.chain)}</span></div>
			<div class="text-xs text-g6">{formatMarketCap(token.quote.marketCapInitialUsdStr)}</div>
		</div>
	{/if}

	<div class="text-right text-[15px] font-medium text-tx"><span class={fc('price')}>{@html fmtPriceHtml(token.quote.priceUsdStr, token.quote.priceNativeStr, token.chain)}</span></div>

	<div class="text-right">
		<div class="text-[15px] text-g7"><span class={fc('vol')}>{token.stats.total.volume ? formatMarketCap(token.stats.total.volumeStr) : '—'}</span></div>
		<div class="text-xs"><span class="text-grn">{token.stats.timeframes['24h'].buys}</span> <span class="text-bd3">/</span> <span class="text-red">{token.stats.timeframes['24h'].sells}</span></div>
	</div>

	{#if !compact}
		<div class="text-right text-[15px] text-g7">{formatMarketCap(token.stats.timeframes['24h'].fees.totalFeeUsdStr)}</div>
	{/if}

	<div class="text-right text-[15px] text-g7"><span class={fc('holders')}>{h?.holderCount != null ? formatNumber(h.holderCount) : '—'}</span></div>

	<div class="text-right text-[15px] font-medium {pctColor(token.stats.timeframes['5m'].priceChangePct)}"><span class={fc('d5m')}>{formatPercent(token.stats.timeframes['5m'].priceChangePct)}</span></div>
	<div class="text-right text-[15px] font-medium {pctColor(token.stats.timeframes['1h'].priceChangePct)}"><span class={fc('d1h')}>{formatPercent(token.stats.timeframes['1h'].priceChangePct)}</span></div>
	{#if !compact}
		<div class="text-right text-[15px] font-medium {pctColor(token.stats.timeframes['6h'].priceChangePct)}"><span class={fc('d6h')}>{formatPercent(token.stats.timeframes['6h'].priceChangePct)}</span></div>
		<div class="text-right text-[15px] font-medium {pctColor(token.stats.timeframes['24h'].priceChangePct)}"><span class={fc('d24h')}>{formatPercent(token.stats.timeframes['24h'].priceChangePct)}</span></div>

		<div class="text-right text-[15px] {holderPctColor(String(h?.top10Pct))}">{fmtHolderPct(String(h?.top10Pct ?? ''))}</div>
	{/if}

	<div class="text-center">
		<div class="text-[13px] {holderPctColor(String(h?.devPct))}" title="Dev">{fmtHolderPct(String(h?.devPct ?? ''))}</div>
		<div class="text-xs"><span class="text-yel" title="Snipers">{h?.snipers ?? 0}</span> <span class="text-bd3">/</span> <span class="text-red" title="Bundlers">{h?.bundlers ?? 0}</span></div>
	</div>

	<div class="flex items-center justify-center">
		{#if sparklineData}
			<svg viewBox="0 0 {sparklineData.w} {sparklineData.h}" class="h-10 w-full" preserveAspectRatio="none">
				<defs>
					<linearGradient id={sparklineData.gradId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color={sparklineData.color} stop-opacity="0.15" />
						<stop offset="100%" stop-color={sparklineData.color} stop-opacity="0" />
					</linearGradient>
				</defs>
				<path d={sparklineData.fillD} fill="url(#{sparklineData.gradId})" />
				<path d={sparklineData.d} fill="none" stroke={sparklineData.color} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
			</svg>
		{:else}
			<span class="text-[10px] text-g1">—</span>
		{/if}
	</div>

	<div class="flex items-center justify-center gap-1">
		<span class="inline-block h-2.5 w-2.5 rounded-full {!sec?.mintable ? 'bg-grn' : 'bg-red'}" title="Mint {!sec?.mintable ? 'disabled' : 'enabled'}"></span>
		<span class="inline-block h-2.5 w-2.5 rounded-full {!sec?.freezable ? 'bg-grn' : 'bg-red'}" title="Freeze {!sec?.freezable ? 'disabled' : 'enabled'}"></span>
		<span class="inline-block h-2.5 w-2.5 rounded-full {sec?.lpLocked ? 'bg-grn' : 'bg-red'}" title="{sec?.lpLocked ? 'LP locked' : 'LP not locked'}"></span>
		<span class="inline-block h-2.5 w-2.5 rounded-full {sec?.honeypot ? 'bg-red' : 'bg-grn'}" title="{sec?.honeypot ? 'Honeypot detected' : 'Not a honeypot'}"></span>
	</div>


</a>

{#if previewPos && showImage && token.tokenAddress}
	<div
		use:portal
		class="pointer-events-none fixed z-[300] rounded-xl border border-bd bg-s4 p-1 shadow-2xl"
		style="left: {previewPos.x}px; top: {previewPos.y}px; width: {PREVIEW_SIZE}px; height: {PREVIEW_SIZE}px;"
	>
		<img src={tokenImage(token.chain, token.tokenAddress)} alt="" class="h-full w-full rounded-lg object-cover" />
	</div>
{/if}
