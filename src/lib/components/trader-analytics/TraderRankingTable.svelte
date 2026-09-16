<script lang="ts">
	import type { TraderRankItem, WalletLabelSource, WalletTimeRange } from '$lib/api/types';
	import { ageFromSeconds, fmtVal, formatNumber, formatPercent, formatUsd } from '$lib/utils/format';
	import { valueColorClass, walletTimeRangeLabel } from './config';
	import TraderIdentity from './TraderIdentity.svelte';

	let {
		items,
		timeRange,
		onselect,
		preferSource = ''
	}: {
		items: TraderRankItem[];
		timeRange: WalletTimeRange;
		onselect: (item: TraderRankItem) => void;
		preferSource?: WalletLabelSource | '';
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
				<tr class="border-b border-bd/40 transition-colors hover:bg-wh/5">
					<td class="px-3 py-3 text-g5">{index + 1}</td>
					<td class="px-3 py-3">
						<TraderIdentity {item} {onselect} compact {preferSource} />
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
