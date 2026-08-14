<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import type { ScannerItem } from '$lib/api/types';
	import { formatPrice, formatPercent, formatMarketCap, formatUsd, liveAge, pctColor, pctBg } from '$lib/utils/format';
	import { getRouterInfo, getRouterIconForChain } from '$lib/utils/routers';
	import { buildSparkline } from '$lib/utils/sparkline';
	import { getNow } from '$lib/stores/tick.svelte';

	let { token, onselect }: { token: ScannerItem; onselect?: (token: ScannerItem) => void } = $props();

	let migPct = $derived(token.launchPad?.bondingCurve?.progressPct ?? 0);
	let isGraduated = $derived(token.launchPad?.bondingCurve?.state === 'Migrated');
	let router = $derived(getRouterInfo(token.platformType ?? ''));
	let routerIcon = $derived(token.platformType ? getRouterIconForChain(token.platformType, token.chain ?? '') : router.icon);

	let pct1h = $derived(token.stats.timeframes['1h']?.priceChangePct);
	let tf5m = $derived(token.stats.timeframes['5m']?.priceChangePct);
	let tf6h = $derived(token.stats.timeframes['6h']?.priceChangePct);
	let tf24h = $derived(token.stats.timeframes['24h']?.priceChangePct);

	let spark = $derived(buildSparkline((token as any).sparkline, 200, 50, `msc-${token.pairAddress.slice(0, 8)}`));
</script>

<a
	href="/?chain={token.chain}&token={token.tokenAddress}"
	class="relative block overflow-hidden rounded-xl border border-bd bg-s1 p-3 transition-all active:bg-s4 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_112px]"
	onclick={(e) => { if (onselect) { e.preventDefault(); onselect(token); } }}
>
	{#if spark}
		<svg viewBox="0 0 {spark.w} {spark.h}" class="pointer-events-none absolute right-0 bottom-0 h-10 w-2/3" preserveAspectRatio="none" style="z-index: 0;">
			<defs>
				<linearGradient id={spark.gradId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color={spark.color} stop-opacity="0.3" />
					<stop offset="100%" stop-color={spark.color} stop-opacity="0.04" />
				</linearGradient>
				<linearGradient id="{spark.gradId}-h" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0%" stop-color={spark.color} stop-opacity="0" />
					<stop offset="30%" stop-color={spark.color} stop-opacity="1" />
				</linearGradient>
				<mask id="{spark.gradId}-m">
					<rect width="100%" height="100%" fill="url(#{spark.gradId}-h)" />
				</mask>
			</defs>
			<g mask="url(#{spark.gradId}-m)">
				<path d={spark.fillD} fill="url(#{spark.gradId})" />
				<path d={spark.d} fill="none" stroke={spark.color} stroke-width="1" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" stroke-opacity="0.4" />
			</g>
		</svg>
	{/if}
	<div class="relative flex items-start gap-3" style="z-index: 1;">
		<div
			class="relative h-10 w-10 shrink-0 rounded-xl p-[2px]"
			style={isGraduated
				? 'background: var(--t-yel)'
				: migPct > 0
					? `background: conic-gradient(var(--t-grn) ${migPct * 3.6}deg, var(--t-bd2) ${migPct * 3.6}deg)`
					: 'background: var(--t-s5)'}
		>
			<img src={tokenImage(token.chain, token.tokenAddress)} alt="" class="h-full w-full rounded-[9px] object-cover" />
			<span class="absolute -right-1.5 -top-1.5 inline-flex items-center" title={token.chain}>
				<img src="/icons/{token.chain?.toLowerCase()}.png" alt={token.chain} class="h-4 w-4 rounded-full ring-1 ring-s6" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
				{#if routerIcon}
					<img src={routerIcon} alt={router.name} title={router.name} class="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" />
				{/if}
			</span>
			{#if isGraduated}
				<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-s6 px-1 py-px text-[7px] font-bold text-yel ring-1 ring-yel/20">GRAD</span>
			{:else if migPct > 0}
				<span class="absolute -bottom-1 -right-1 rounded bg-s6 px-0.5 py-px text-[7px] font-bold text-grn ring-1 ring-bd">{migPct.toFixed(0)}%</span>
			{/if}
		</div>

		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-1.5">
				<span class="text-sm font-bold text-tx">{token.tokenSymbol}</span>
				<span class="truncate text-xs text-g4">{token.tokenName}</span>
			</div>
			<div class="mt-1 flex items-center gap-3 text-xs">
				<span class="font-medium text-g11">{@html formatPrice(token.quote.priceUsdStr)}</span>
				<span class="text-g5">MC {formatMarketCap(token.quote.marketCapUsdStr)}</span>
				<span class="text-g4">{liveAge(token.createdAtTimestamp, getNow())}</span>
			</div>
		</div>

		<div class="shrink-0 text-right">
			<div class="text-sm font-bold {pctColor(pct1h)}">{formatPercent(pct1h)}</div>
			<div class="text-[10px] text-g5">1H</div>
		</div>
	</div>

	<div class="relative mt-2 flex gap-1.5" style="z-index: 1;">
		<div class="flex-1 rounded-lg {pctBg(tf5m)} px-2 py-1 text-center">
			<div class="text-[9px] text-g5">5M</div>
			<div class="text-[11px] font-semibold {pctColor(tf5m)}">{formatPercent(tf5m)}</div>
		</div>
		<div class="flex-1 rounded-lg {pctBg(pct1h)} px-2 py-1 text-center">
			<div class="text-[9px] text-g5">1H</div>
			<div class="text-[11px] font-semibold {pctColor(pct1h)}">{formatPercent(pct1h)}</div>
		</div>
		<div class="flex-1 rounded-lg {pctBg(tf6h)} px-2 py-1 text-center">
			<div class="text-[9px] text-g5">6H</div>
			<div class="text-[11px] font-semibold {pctColor(tf6h)}">{formatPercent(tf6h)}</div>
		</div>
		<div class="flex-1 rounded-lg {pctBg(tf24h)} px-2 py-1 text-center">
			<div class="text-[9px] text-g5">24H</div>
			<div class="text-[11px] font-semibold {pctColor(tf24h)}">{formatPercent(tf24h)}</div>
		</div>
	</div>

	<div class="relative mt-2 flex items-center gap-3 text-[10px] text-g4" style="z-index: 1;">
		<span>Vol {formatUsd(token.stats.total.volumeStr)}</span>
		<span>Liq {formatMarketCap(token.quote.liquidityUsdStr)}</span>
		<span>Fees {formatUsd(token.stats.timeframes['24h'].fees.totalFeeUsdStr)}</span>
		{#if token.stats.total.buys || token.stats.total.sells}
			<span><span class="text-grn">{token.stats.total.buys}</span>/<span class="text-red">{token.stats.total.sells}</span></span>
		{/if}

	</div>
</a>
