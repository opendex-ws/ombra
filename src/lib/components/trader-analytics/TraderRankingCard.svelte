<script lang="ts">
	import type { TraderRankItem, WalletTimeRange } from '$lib/api/types';
	import { ageFromSeconds, explorerAddressUrl, fmtVal, formatNumber, formatPercent, formatUsd, shortAddress } from '$lib/utils/format';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import ChainIcon from '../ChainIcon.svelte';
	import WalletIcon from '../WalletIcon.svelte';
	import { valueColorClass, walletTimeRangeLabel } from './config';

	let { item, rank, timeRange, onselect }: { item: TraderRankItem; rank: number; timeRange: WalletTimeRange; onselect: (item: TraderRankItem) => void } = $props();

</script>

<div class="w-full rounded-xl border border-bd bg-s1 p-3 text-left transition-colors hover:bg-wh/5">
	<div class="flex items-center gap-2">
		<span class="w-6 text-xs text-g5">#{rank}</span>
		<WalletIcon address={item.walletAddress} photoId={item.labels?.[0]?.photoId} size={24} class="h-6 w-6" />
		<ChainIcon chain={item.chain} class="h-3.5 w-3.5 text-g6" />
		<button type="button" class="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium text-tx transition-colors hover:text-grn" onclick={() => onselect(item)}>{(item.labels ?? []).length > 0 ? item.labels![0].label : shortAddress(item.walletAddress)}</button>
		<a
			href={explorerAddressUrl(item.chain, item.walletAddress)}
			target="_blank"
			rel="noopener"
			class="p-1 text-g4 transition-colors hover:text-tx"
			aria-label="Open wallet in explorer"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => event.stopPropagation()}
		>
			<ExternalLink class="h-3.5 w-3.5" />
		</a>
	</div>
	{#if (item.labels ?? []).length > 0}
		<div class="mt-1.5 flex flex-wrap items-center gap-1 pl-8">
			<span class="rounded bg-s7 px-1.5 py-px font-mono text-[10px] font-medium text-g7">{shortAddress(item.walletAddress)}</span>
			{#each (item.labels ?? []).slice(1) as wl}
				<span class="rounded bg-blu/20 px-1.5 py-px text-[10px] font-medium text-blu">{wl.label}</span>
			{/each}
		</div>
	{/if}

	<div class="mt-3 grid grid-cols-3 gap-2">
		<div>
			<div class="text-[9px] font-medium uppercase tracking-wider text-g5">PnL {walletTimeRangeLabel(timeRange)}</div>
			<div class="text-sm font-bold {valueColorClass(item.stats.pnlUsd)}">{formatUsd(item.stats.pnlUsdStr)}</div>
			<div class="text-[10px] text-g5">Total {formatUsd(item.totalStats.pnlUsdStr)}</div>
		</div>
		<div>
			<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Win rate</div>
			<div class="text-sm font-bold text-tx">{formatPercent(item.stats.winRatePct)}</div>
		</div>
		<div class="text-right">
			<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Balance</div>
			<div class="text-sm font-bold text-tx">{fmtVal(item.walletBalanceUsdStr, item.walletBalanceNativeStr, item.chain)}</div>
		</div>
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-bd/40 pt-2 text-[10px] text-g5">
		<span><span class="text-grn">{formatNumber(item.stats.buyCount)} buys</span> / <span class="text-red">{formatNumber(item.stats.sellCount)} sells</span></span>
		<span>{formatNumber(item.stats.uniqueTokensBought)} tokens</span>
		<span>Cost <span class="text-g8">{formatUsd(item.stats.totalCostUsdStr)}</span></span>
		<span>Fees <span class="text-g8">{formatUsd(item.stats.totalFeesUsdStr)}</span></span>
		<span class="ml-auto">{ageFromSeconds(item.latestSwapAgeSeconds)}</span>
	</div>
</div>
