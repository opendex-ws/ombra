<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy } from 'svelte';
	import type { ScannerItem } from '$lib/api/types';
	import { formatPrice, formatMarketCap, formatPercent, formatUsd, liveAge, fmtVal, fmtPriceHtml } from '$lib/utils/format';
	import { getRouterInfo, getRouterIconForChain } from '$lib/utils/routers';
	import { getNow } from '$lib/stores/tick.svelte';
	import { siX, siTelegram, siDiscord, siInstagram } from 'simple-icons';
	import DexPaidIcon from './DexPaidIcon.svelte';
	import Globe from 'lucide-svelte/icons/globe';
	import Flame from 'lucide-svelte/icons/flame';
	import Coins from 'lucide-svelte/icons/coins';
	import SniperIcon from './SniperIcon.svelte';
	import BundlerIcon from './BundlerIcon.svelte';
	import InsiderIcon from './InsiderIcon.svelte';
	import type { RowFlashType } from '$lib/utils/scanner-ws';

	let { token, phase = 'new', rowFlash = undefined }: { token: ScannerItem; phase?: 'new' | 'graduating' | 'graduated'; rowFlash?: RowFlashType } = $props();

	function percentColor(value: string | number | undefined | null): string {
		if (value === undefined || value === null) return 'text-g6';
		const num = typeof value === 'string' ? parseFloat(value) : value;
		if (isNaN(num)) return 'text-g6';
		return num > 0 ? 'text-grn' : num < 0 ? 'text-red' : 'text-g6';
	}

	function openSocial(e: MouseEvent, url: string | null | undefined) {
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
		const entries: [string, string | undefined | null, (v: any) => string][] = [
			['price', token.quote.priceUsdStr, formatPrice],
			['mcap', token.quote.marketCapUsdStr, formatMarketCap],
			['liq', token.quote.liquidityUsdStr, formatMarketCap],
			['pct', String(token.stats.timeframes['5m'].priceChangePct), formatPercent],
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

	let displayRouter = $derived(getRouterInfo(token.platformType ?? ''));
	let routerIconUrl = $derived(token.platformType ? getRouterIconForChain(token.platformType, token.chain) : '');

	let gradPercent = $derived.by(() => {
		if (!token.launchPad?.bondingCurve) return null;
		return token.launchPad.bondingCurve.progressPct ?? 0;
	});

	let isGraduated = $derived(token.launchPad?.bondingCurve?.state === 'Migrated');
	let migratedFromIcon = $derived.by(() => {
		const bc = token.launchPad?.bondingCurve;
		if (bc?.state !== 'Migrated' || !bc.migratedFromPlatformType) return '';
		return getRouterIconForChain(bc.migratedFromPlatformType, token.chain);
	});
	// Flatten the new nested social links to URL strings.
	let soc = $derived.by(() => {
		const l = token.socials?.links;
		return { website: l?.website, twitter: l?.twitter?.url, telegram: l?.telegram, discord: l?.discord, instagram: l?.instagram };
	});
	let hasSocials = $derived(!!(soc.website || soc.twitter || soc.telegram || soc.discord || soc.instagram));

	let pumpfun = $derived(token.launchPad?.pumpfun ?? null);
	let isMayhem = $derived(pumpfun?.isMayhem ?? false);
	let cashbackPct = $derived(pumpfun?.cashbackPct ?? 0);

	let act5m = $derived(token.stats.timeframes['5m']);
	let act1h = $derived(token.stats.timeframes['1h']);
	let act6h = $derived(token.stats.timeframes['6h']);
	let act24h = $derived(token.stats.timeframes['24h']);
	let vol24h = $derived(act24h?.volume ?? 0);
	let sec = $derived(token.audit);
</script>

<a
	href="/?chain={token.chain}&token={token.tokenAddress}"
	class="group block rounded-xl border border-bd bg-s1 transition-all duration-200 hover:border-bd3 hover:bg-wh/5 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_120px] {rowFlash ? `card-flash-${rowFlash}` : ''}"
>
	<div class="flex items-start gap-2.5 p-3 pb-2">
		<div class="relative h-11 w-11 shrink-0 rounded-xl p-[2px]"
			style={isGraduated
				? 'background: var(--t-yel)'
				: gradPercent !== null && gradPercent > 0
					? `background: conic-gradient(var(--t-grn) ${gradPercent * 3.6}deg, var(--t-bd2) ${gradPercent * 3.6}deg)`
					: 'background: var(--t-s5)'}
		>
			{#if token.tokenAddress}
				<img src={tokenImage(token.chain, token.tokenAddress)} alt="" class="h-full w-full rounded-[10px] object-cover" />
			{:else}
				<div class="flex h-full w-full items-center justify-center rounded-[10px] bg-s7">
					<span class="text-sm font-bold text-g6">{token.tokenSymbol?.[0] ?? '?'}</span>
				</div>
			{/if}
			<span class="absolute -right-1.5 -top-1.5 inline-flex items-center" title={token.chain}>
				<img src="/icons/{token.chain?.toLowerCase()}.png" alt={token.chain} class="h-4 w-4 rounded-full ring-1 ring-s6" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
				{#if routerIconUrl}
					<img src={routerIconUrl} alt={displayRouter.name} title={displayRouter.name} class="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" />
				{/if}
				{#if migratedFromIcon}
					<img src={migratedFromIcon} alt="Migrated from" class="absolute -top-1 left-0 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" title="Migrated from {(token.launchPad?.bondingCurve as any)?.migratedFromPlatformName ?? ''}" />
				{/if}
			</span>
			<span class="absolute -bottom-1 -left-0.5 rounded-md bg-s6 px-1 py-0.5 text-[9px] font-bold leading-none text-g9 ring-1 ring-bd">{liveAge(createdMs, getNow())}</span>
		</div>

		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="text-sm font-bold text-tx">{token.tokenSymbol}</span>
				<span class="truncate text-xs text-g4">{token.tokenName}</span>
			</div>
			<div class="mt-0.5 flex items-center gap-1">
				{#if token.audit?.dexScreenerPaid}
					<DexPaidIcon />
				{/if}
				{#if isMayhem}
					<span class="text-org" title="Mayhem"><Flame class="h-3 w-3" /></span>
				{/if}
				{#if cashbackPct > 0}
					<span class="text-grn" title="Cashback {cashbackPct}%"><Coins class="h-3 w-3" /></span>
				{/if}
				{#if (token.holders?.snipers ?? 0) > 0}
					<span class="flex items-center gap-0.5 text-red"><SniperIcon class="h-3 w-3" /><span class="text-[10px]">{token.holders?.snipers}</span></span>
				{/if}
				{#if (token.holders?.bundlers ?? 0) > 0}
					<span class="flex items-center gap-0.5 text-yel"><BundlerIcon class="h-3 w-3" /><span class="text-[10px]">{token.holders?.bundlers}</span></span>
				{/if}
				{#if (token.holders?.insiders ?? 0) > 0}
					<span class="flex items-center gap-0.5 text-org"><InsiderIcon class="h-3 w-3" /><span class="text-[10px]">{token.holders?.insiders}</span></span>
				{/if}
				{#if hasSocials}
					<div class="ml-auto flex items-center gap-0.5">
						{#if soc.website}
							<button onclick={(e) => openSocial(e, soc.website)} class="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-g5 transition-colors hover:text-grn" title="Website">
								<Globe class="h-2.5 w-2.5" strokeWidth={2} />
							</button>
						{/if}
						{#if soc.twitter}
							<button onclick={(e) => openSocial(e, soc.twitter)} class="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-g5 transition-colors hover:text-grn" title="Twitter">
								<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg>
							</button>
						{/if}
						{#if soc.telegram}
							<button onclick={(e) => openSocial(e, soc.telegram)} class="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-g5 transition-colors hover:text-grn" title="Telegram">
								<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d={siTelegram.path}/></svg>
							</button>
						{/if}
						{#if soc.instagram}
							<button onclick={(e) => openSocial(e, soc.instagram)} class="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-g5 transition-colors hover:text-grn" title="Instagram">
								<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d={siInstagram.path}/></svg>
							</button>
						{/if}
						{#if soc.discord}
							<button onclick={(e) => openSocial(e, soc.discord)} class="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-g5 transition-colors hover:text-grn" title="Discord">
								<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d={siDiscord.path}/></svg>
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="flex items-baseline justify-between px-3 pb-1.5">
		<div class="flex items-baseline gap-3">
			<div>
				<span class="text-[9px] font-medium uppercase tracking-wider text-g5">MC</span>
				<span class="ml-1 text-sm font-bold text-tx {fc('mcap')}">{formatMarketCap(token.quote.marketCapUsdStr)}</span>
			</div>
			<div>
				<span class="text-[9px] font-medium uppercase tracking-wider text-g5">24h V</span>
				<span class="ml-1 text-xs text-g9">{formatMarketCap(vol24h)}</span>
			</div>
			<div>
				<span class="text-[9px] font-medium uppercase tracking-wider text-g5">24h F</span>
				<span class="ml-1 text-xs text-g9">{formatMarketCap(act24h?.fees?.totalFeeUsdStr)}</span>
			</div>
		</div>
		<span class="text-sm font-bold {percentColor(act5m?.priceChangePct)} {fc('pct')}">{formatPercent(act5m?.priceChangePct)} <span class="text-[9px] font-medium text-g5">5m</span></span>
	</div>

	{#if sec}
		<div class="flex items-center gap-2 border-t border-bd/50 px-3 py-1.5 text-[10px]">
			<span class="flex items-center gap-0.5" title="Mint {!sec.mintable ? 'disabled' : 'enabled'}">
				<span class="inline-block h-2 w-2 rounded-full {!sec.mintable ? 'bg-grn' : 'bg-red'}"></span>
				<span class="{!sec.mintable ? 'text-g7' : 'text-red'}">Mint</span>
			</span>
			<span class="flex items-center gap-0.5" title="Freeze {!sec.freezable ? 'disabled' : 'enabled'}">
				<span class="inline-block h-2 w-2 rounded-full {!sec.freezable ? 'bg-grn' : 'bg-red'}"></span>
				<span class="{!sec.freezable ? 'text-g7' : 'text-red'}">Freeze</span>
			</span>
			{#if sec.honeypot !== null && sec.honeypot !== undefined}
				<span class="flex items-center gap-0.5" title="{sec.honeypot ? 'Honeypot detected' : 'Not honeypot'}">
					<span class="inline-block h-2 w-2 rounded-full {sec.honeypot ? 'bg-red' : 'bg-grn'}"></span>
					<span class="{sec.honeypot ? 'text-red' : 'text-g7'}">HP</span>
				</span>
			{/if}
			{#if sec.renounced}
				<span class="font-bold text-grn">R</span>
			{/if}
			{#if sec.lpLocked}
				<span class="font-bold text-grn">LP</span>
			{/if}
			{#if sec.taxBuy || sec.taxSell}
				<span class="ml-auto text-yel">
					{#if sec.taxBuy}B:{sec.taxBuy.toFixed(1)}%{/if}
					{#if sec.taxSell} S:{sec.taxSell.toFixed(1)}%{/if}
				</span>
			{/if}
		</div>
	{/if}

	<div class="flex items-center gap-2.5 border-t border-bd/50 px-3 py-1.5 text-xs">
		{#if token.holders}
			<span class="flex items-center gap-1"><span class="text-g5">H</span><span class="rounded bg-grn/10 px-1.5 py-0.5 font-bold text-grn">{token.holders.holderCount ?? 0}</span></span>
			{#if token.holders.top10Pct}
				<span class="text-g9">T10 {token.holders.top10Pct.toFixed(0)}%</span>
			{/if}
		{/if}
		<div class="ml-auto flex items-center gap-2 text-[11px]">
			{#each [{ label: '5m', a: act5m }, { label: '1h', a: act1h }, { label: '6h', a: act6h }, { label: '24h', a: act24h }] as { label, a }}
				<span><span class="text-g4">{label}</span> <span class="text-grn">{a?.buys ?? 0}</span><span class="text-g3">/</span><span class="text-red">{a?.sells ?? 0}</span></span>
			{/each}
		</div>
	</div>


</a>
