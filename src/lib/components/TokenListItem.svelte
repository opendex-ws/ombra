<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import type { ScannerItem } from '$lib/api/types';
	import type { RowFlashType } from '$lib/utils/scanner-ws';
	import { formatPrice, formatPercent, formatMarketCap } from '$lib/utils/format';
	import { getRouterInfo } from '$lib/utils/routers';

	let { token, isSelected = false, rowFlash = undefined, onselect }: {
		token: ScannerItem;
		isSelected: boolean;
		rowFlash?: RowFlashType;
		onselect: () => void;
	} = $props();

	let migPct = $derived(token.launchPad?.bondingCurve?.progressPct ?? 0);
	let isGraduated = $derived(token.launchPad?.bondingCurve?.state === 'Migrated');
	let platformIcon = $derived(token.platformName ? getRouterInfo(token.platformName).icon : '');

	function percentColor(value: string | number | undefined | null): string {
		if (value === undefined || value === null) return 'text-g6';
		const num = typeof value === 'string' ? parseFloat(value) : value;
		if (isNaN(num)) return 'text-g6';
		return num > 0 ? 'text-grn' : num < 0 ? 'text-red' : 'text-g6';
	}

	let prev: Record<string, string> = {};
	let prevNum: Record<string, number> = {};
	let flashes: Record<string, 'up' | 'down'> = $state({});
	let timers: Record<string, ReturnType<typeof setTimeout>> = {};

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
			['pct', String(token.stats.timeframes['1h'].priceChangePct), formatPercent],
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
</script>

<button
	class="group flex w-full cursor-pointer items-start gap-2.5 border-l-2 px-3 py-2.5 text-left text-sm transition-all duration-150
		{isSelected
		? 'border-l-grn bg-grn/10'
		: 'border-l-transparent hover:bg-wh/5'} {rowFlash ? `row-flash-${rowFlash}` : ''}"
	onclick={onselect}
>
	<div
		class="relative mt-0.5 h-8 w-8 shrink-0 rounded-lg p-[2px]"
		style={isGraduated
			? 'background: var(--t-yel)'
			: migPct > 0
				? `background: conic-gradient(var(--t-grn) ${migPct * 3.6}deg, var(--t-bd2) ${migPct * 3.6}deg)`
				: 'background: var(--t-s5)'}
	>
		{#if token.tokenAddress}
			<img src={tokenImage(token.chain, token.tokenAddress)} alt="" class="h-full w-full rounded-[6px] object-cover" />
		{:else}
			<div class="flex h-full w-full items-center justify-center rounded-[6px] bg-s4 text-[11px] font-bold text-g6">
				{token.tokenSymbol?.[0] ?? '?'}
			</div>
		{/if}
		{#if isGraduated}
			<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-s6 px-0.5 py-px text-[7px] font-bold leading-none text-yel ring-1 ring-yel/20">GRAD</span>
		{:else if migPct > 0}
			<span class="absolute -bottom-1 -right-1 rounded bg-s6 px-0.5 py-px text-[7px] font-bold leading-none text-grn ring-1 ring-bd">{migPct.toFixed(0)}%</span>
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-1.5">
			{#if platformIcon}<img src={platformIcon} alt="" class="h-3.5 w-3.5 rounded" />{/if}
			<span class="font-semibold text-tx">{token.tokenSymbol}</span>
			<span class="truncate text-xs text-g5">{token.tokenName}</span>
		</div>
		<div class="mt-1 flex items-center justify-between text-xs">
			<span class="font-medium text-g9 {fc('price')}">{@html formatPrice(token.quote.priceUsdStr)}</span>
			<span class="font-medium {percentColor(token.stats.timeframes['1h'].priceChangePct)} {fc('pct')}">{formatPercent(token.stats.timeframes['1h'].priceChangePct)}</span>
		</div>
		<div class="mt-0.5 text-xs text-g6 {fc('mcap')}">MCap {formatMarketCap(token.quote.marketCapUsdStr)}</div>
	</div>
</button>
