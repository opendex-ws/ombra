<script lang="ts">
	import type { TraderRankItem, WalletTimeRange } from '$lib/api/types';
	import { ageFromSeconds, explorerAddressUrl, fmtVal, formatNumber, formatPercent, formatUsd, shortAddress } from '$lib/utils/format';
	import ChainIcon from '../ChainIcon.svelte';
	import WalletIcon from '../WalletIcon.svelte';
	import { valueColorClass, walletTimeRangeLabel } from './config';
	import ExternalLink from 'lucide-svelte/icons/external-link';

	let {
		items,
		timeRange,
		onselect
	}: {
		items: TraderRankItem[];
		timeRange: WalletTimeRange;
		onselect: (item: TraderRankItem) => void;
	} = $props();

</script>

<div class="overflow-auto rounded-xl border border-bd bg-s1">
	<table class="min-w-[1080px] w-full text-xs">
		<thead class="sticky top-0 z-10 bg-s0">
			<tr class="border-b border-bd text-g5">
				<th class="px-3 py-2 text-left font-medium">#</th>
				<th class="px-3 py-2 text-left font-medium">Wallet</th>
				<th class="px-3 py-2 text-right font-medium">PnL {walletTimeRangeLabel(timeRange)} / Total</th>
				<th class="px-3 py-2 text-right font-medium">Win rate</th>
				<th class="px-3 py-2 text-right font-medium">Transactions</th>
				<th class="px-3 py-2 text-right font-medium">Cost / Fees</th>
				<th class="px-3 py-2 text-right font-medium">Tokens</th>
				<th class="px-3 py-2 text-right font-medium">Balance</th>
				<th class="px-3 py-2 text-right font-medium">Latest swap</th>
			</tr>
		</thead>
		<tbody>
			{#each items as item, index (`${item.chain}:${item.walletAddress}`)}
				<tr class="border-b border-bd/30 transition-colors hover:bg-wh/5">
					<td class="px-3 py-3 text-g5">{index + 1}</td>
					<td class="px-3 py-3">
						<div class="flex items-center gap-2">
							<WalletIcon address={item.walletAddress} photoId={item.labels?.[0]?.photoId} size={20} class="h-5 w-5" />
							<ChainIcon chain={item.chain} class="h-3.5 w-3.5 text-g6" />
							{#if (item.labels ?? []).length > 0}
								<button type="button" class="cursor-pointer font-medium text-tx transition-colors hover:text-grn" onclick={() => onselect(item)}>{item.labels![0].label}</button>
								<span class="shrink-0 rounded bg-s7 px-1.5 py-px font-mono text-[10px] font-medium text-g7">{shortAddress(item.walletAddress)}</span>
							{:else}
								<button type="button" class="cursor-pointer font-medium text-tx transition-colors hover:text-grn" onclick={() => onselect(item)}>{shortAddress(item.walletAddress)}</button>
							{/if}
							<a
								href={explorerAddressUrl(item.chain, item.walletAddress)}
								target="_blank"
								rel="noopener"
								class="text-g4 transition-colors hover:text-tx"
								aria-label="Open wallet in explorer"
								onclick={(event) => event.stopPropagation()}
								onkeydown={(event) => event.stopPropagation()}
							>
								<ExternalLink class="h-3 w-3" />
							</a>
							{#each (item.labels ?? []).slice(1) as wl}
								<span class="shrink-0 rounded bg-blu/20 px-1.5 py-px text-[10px] font-medium text-blu">{wl.label}</span>
							{/each}
						</div>
					</td>
					<td class="px-3 py-3 text-right">
						<div class="font-bold {valueColorClass(item.stats.pnlUsd)}">{formatUsd(item.stats.pnlUsdStr)}</div>
						<div class="text-[10px] {valueColorClass(item.totalStats.pnlUsd)}">{formatUsd(item.totalStats.pnlUsdStr)}</div>
					</td>
					<td class="px-3 py-3 text-right font-medium text-tx">{formatPercent(item.stats.winRatePct)}</td>
					<td class="px-3 py-3 text-right">
						<div><span class="text-grn">{formatNumber(item.stats.buyCount)}</span> / <span class="text-red">{formatNumber(item.stats.sellCount)}</span></div>
						<div class="text-[10px] text-g5">{formatNumber(item.stats.tradeCount)} total</div>
					</td>
					<td class="px-3 py-3 text-right">
						<div class="text-tx">{formatUsd(item.stats.totalCostUsdStr)}</div>
						<div class="text-[10px] text-g5">{formatUsd(item.stats.totalFeesUsdStr)}</div>
					</td>
					<td class="px-3 py-3 text-right text-tx">{formatNumber(item.stats.uniqueTokensBought)}</td>
					<td class="px-3 py-3 text-right text-tx">{fmtVal(item.walletBalanceUsdStr, item.walletBalanceNativeStr, item.chain)}</td>
					<td class="px-3 py-3 text-right text-g6">{ageFromSeconds(item.latestSwapAgeSeconds)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
