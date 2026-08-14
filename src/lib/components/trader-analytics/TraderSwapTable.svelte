<script lang="ts">
	import type { Chain, TraderTokenSwapEntry } from '$lib/api/types';
	import { explorerTxUrl, formatCompactNumber, formatPriceText, formatUsd, timeAgo, fullDateTime } from '$lib/utils/format';
	import { onMount } from 'svelte';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import { valueColorClass } from './config';

	let { swaps, chain, tokenSymbol = '', tokenName = '' }: { swaps: TraderTokenSwapEntry[]; chain: Chain; tokenSymbol?: string; tokenName?: string } = $props();

	let showToken = $derived(!tokenSymbol);
	let isDesktop = $state(false);
	// Grid template mirrors the old table columns; drops the Token column when a
	// single token is in view.
	let gridCols = $derived(
		showToken
			? 'grid-cols-[minmax(64px,0.9fr)_minmax(80px,1.1fr)_minmax(48px,0.7fr)_minmax(64px,0.9fr)_minmax(64px,0.9fr)_minmax(64px,0.9fr)_minmax(56px,0.8fr)_minmax(56px,0.8fr)]'
			: 'grid-cols-[minmax(64px,0.9fr)_minmax(48px,0.7fr)_minmax(64px,0.9fr)_minmax(64px,0.9fr)_minmax(64px,0.9fr)_minmax(56px,0.8fr)_minmax(56px,0.8fr)]'
	);

	onMount(() => {
		const media = window.matchMedia('(min-width: 768px)');
		const syncViewport = () => { isDesktop = media.matches; };
		syncViewport();
		media.addEventListener('change', syncViewport);
		return () => media.removeEventListener('change', syncViewport);
	});
</script>

<div class="overflow-hidden rounded-xl border border-bd bg-s1">
	{#if isDesktop}
		<div class="text-left">
			<div class="grid {gridCols} items-center gap-2 border-b border-bd bg-s2 px-2.5 py-2 text-[9px] font-medium uppercase tracking-wider text-g5">
				<span>Time</span>
				{#if showToken}<span>Token</span>{/if}
				<span>Side</span>
				<span class="text-right">Value</span>
				<span class="text-right">Tokens</span>
				<span class="text-right">Price</span>
				<span class="text-right">PnL</span>
				<span class="text-right">Fees</span>
			</div>
			{#each swaps as swap, index (`${swap.txHash}:${swap.token.address}:${index}`)}
				<div class="grid {gridCols} items-center gap-2 border-b border-bd/40 px-2.5 py-1.5 text-[11px] last:border-0 hover:bg-wh/5 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_34px]">
					<a href={explorerTxUrl(chain, swap.txHash)} target="_blank" rel="noopener" class="flex cursor-help items-center gap-1 truncate whitespace-nowrap text-g5 hover:text-tx" title={fullDateTime(swap.timestamp)}>
						{timeAgo(swap.timestamp)}
						<ExternalLink class="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
					</a>
					{#if showToken}
						<div class="min-w-0">
							<div class="truncate font-medium text-tx">{swap.token.symbol}</div>
							<div class="truncate text-[9px] text-g4">{swap.token.name}</div>
						</div>
					{/if}
					<div>
						<span class="rounded-md px-1.5 py-0.5 text-[9px] font-bold {swap.side === 'BUY' ? 'bg-grn/20 text-grn' : 'bg-red/20 text-red'}">{swap.side}</span>
					</div>
					<div class="truncate whitespace-nowrap text-right font-medium text-tx">{formatUsd(swap.amountUsdStr)}</div>
					<div class="truncate whitespace-nowrap text-right text-g7">{formatCompactNumber(swap.amountTokenStr)}</div>
					<div class="truncate whitespace-nowrap text-right text-g7">{formatPriceText(swap.priceUsdStr)}</div>
					<div class="truncate whitespace-nowrap text-right font-medium {valueColorClass(swap.profitUsd, 'text-g6')}">{swap.profitUsdStr === undefined ? '—' : formatUsd(swap.profitUsdStr)}</div>
					<div class="truncate whitespace-nowrap text-right text-g6">{formatUsd(swap.fees.totalFeeUsdStr)}</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="divide-y divide-bd/40">
			{#each swaps as swap, index (`mobile:${swap.txHash}:${swap.token.address}:${index}`)}
				<div class="p-3 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_92px]">
					<div class="flex items-start gap-2">
						<span class="rounded-md px-1.5 py-0.5 text-[9px] font-bold {swap.side === 'BUY' ? 'bg-grn/20 text-grn' : 'bg-red/20 text-red'}">{swap.side}</span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-xs font-medium text-tx">{#if showToken}{swap.token.symbol} · {/if}{formatUsd(swap.amountUsdStr)} <span class="font-normal text-g4">· <span class="cursor-help" title={fullDateTime(swap.timestamp)}>{timeAgo(swap.timestamp)}</span></span></div>
						</div>
						<a href={explorerTxUrl(chain, swap.txHash)} target="_blank" rel="noopener" class="p-1 text-g4 transition-colors hover:text-tx" aria-label="Open transaction in explorer">
							<ExternalLink class="h-3.5 w-3.5" />
						</a>
					</div>
					<div class="mt-2 grid grid-cols-4 gap-2 text-[10px]">
						<div><div class="text-g4">Tokens</div><div class="text-g7">{formatCompactNumber(swap.amountTokenStr)}</div></div>
						<div><div class="text-g4">Price</div><div class="text-g7">{formatPriceText(swap.priceUsdStr)}</div></div>
						<div><div class="text-g4">PnL</div><div class="font-medium {valueColorClass(swap.profitUsd, 'text-g6')}">{swap.profitUsdStr === undefined ? '—' : formatUsd(swap.profitUsdStr)}</div></div>
						<div class="text-right"><div class="text-g4">Fees</div><div class="text-g6">{formatUsd(swap.fees.totalFeeUsdStr)}</div></div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
