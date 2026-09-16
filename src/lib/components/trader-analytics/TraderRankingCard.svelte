<script lang="ts">
	import type { TraderRankItem, WalletLabelSource, WalletTimeRange } from '$lib/api/types';
	import { ageFromSeconds, fmtVal, formatNumber, formatPercent, formatUsd } from '$lib/utils/format';
	import { valueColorClass, walletTimeRangeLabel } from './config';
	import TraderIdentity from './TraderIdentity.svelte';

	let {
		item,
		rank,
		timeRange,
		onselect,
		preferSource = ''
	}: {
		item: TraderRankItem;
		rank: number;
		timeRange: WalletTimeRange;
		onselect: (item: TraderRankItem) => void;
		preferSource?: WalletLabelSource | '';
	} = $props();
</script>

<div class="w-full rounded-xl border border-bd bg-s1 p-3 text-left transition-colors hover:bg-wh/5">
	<div class="flex items-center gap-2.5">
		<span
			class="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-lg bg-s4 px-1 text-[11px] font-bold tabular-nums text-g6"
			>{rank}</span
		>
		<div class="min-w-0 flex-1">
			<TraderIdentity {item} {onselect} {preferSource} />
		</div>
	</div>

	<!-- PnL is the reason to look at this card, so it leads on its own line and
	     everything else reads as supporting facts rather than equal columns. -->
	<div class="mt-3">
		<div class="text-[10px] font-medium uppercase tracking-wider text-g5">
			PnL {walletTimeRangeLabel(timeRange)}
		</div>
		<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
			<span class="text-xl font-bold {valueColorClass(item.stats.pnlUsd)}">
				{formatUsd(item.stats.pnlUsdStr)}
			</span>
			<span class="text-[11px] text-g5">
				Total <span class="font-medium text-g8">{formatUsd(item.totalStats.pnlUsdStr)}</span>
			</span>
		</div>
	</div>

	<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-g5">
		<span>Win <span class="font-medium text-tx">{formatPercent(item.stats.winRatePct)}</span></span>
		<span class="text-g3">·</span>
		<span>
			Balance
			<span class="font-medium text-tx">
				{fmtVal(item.walletBalanceUsdStr, item.walletBalanceNativeStr, item.chain)}
			</span>
		</span>
		<span class="text-g3">·</span>
		<span><span class="font-medium text-g8">{formatNumber(item.stats.uniqueTokensBought)}</span> tokens</span>
	</div>

	<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-bd/40 pt-2 text-[11px] text-g5">
		<span class="font-medium text-grn">{formatNumber(item.stats.buyCount)} buys</span>
		<span class="text-g3">/</span>
		<span class="font-medium text-red">{formatNumber(item.stats.sellCount)} sells</span>
		<span class="text-g3">·</span>
		<span>Cost <span class="font-medium text-g8">{formatUsd(item.stats.totalCostUsdStr)}</span></span>
		<span class="text-g3">·</span>
		<span>Fees <span class="font-medium text-g8">{formatUsd(item.stats.totalFeesUsdStr)}</span></span>
		<span class="ml-auto">{ageFromSeconds(item.latestSwapAgeSeconds)}</span>
	</div>
</div>
