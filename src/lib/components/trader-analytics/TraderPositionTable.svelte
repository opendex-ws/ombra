<script lang="ts">
	import type { Chain, TraderTokenPnlItem } from '$lib/api/types';
	import { formatCompactNumber, formatPercent, formatPriceText, formatUsd } from '$lib/utils/format';
	import { onMount } from 'svelte';
	import { valueColorClass } from './config';
	import { closeTraderPortfolio } from '$lib/stores/traderAnalytics.svelte';

	let { items, chain }: { items: TraderTokenPnlItem[]; chain: Chain } = $props();

	let isDesktop = $state(false);

	function tokenHref(item: TraderTokenPnlItem): string {
		return `/?chain=${chain}&token=${encodeURIComponent(item.tokenAddress)}`;
	}

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
	<div class="overflow-x-auto">
		<table class="w-full min-w-[940px] border-collapse text-left">
			<thead>
				<tr class="border-b border-bd bg-s2 text-[9px] font-medium uppercase tracking-wider text-g5">
					<th class="px-3 py-2">Token</th>
					<th class="px-3 py-2">Status</th>
					<th class="px-3 py-2 text-right">Bought / Sold</th>
					<th class="px-3 py-2 text-right">Realized PnL</th>
					<th class="px-3 py-2 text-right">Unrealized</th>
					<th class="px-3 py-2 text-right">Balance</th>
					<th class="px-3 py-2 text-right">Avg cost</th>
					<th class="px-3 py-2 text-right">Price / MC</th>
					<th class="px-3 py-2 text-right">Fees</th>
				</tr>
			</thead>
			<tbody>
				{#each items as item, index (`${item.tokenAddress}:${index}`)}
					<tr class="border-b border-bd/40 text-[11px] last:border-0 hover:bg-wh/5">
						<td class="max-w-44 px-3 py-2">
							<a href={tokenHref(item)} class="block truncate font-medium text-tx hover:text-grn" onclick={closeTraderPortfolio}>{item.tokenSymbol}</a>
							<div class="truncate text-[9px] text-g4">{item.tokenName}</div>
						</td>
						<td class="px-3 py-2"><span class="rounded-md px-1.5 py-0.5 text-[9px] font-bold {item.status === 'ACTIVE' ? 'bg-grn/20 text-grn' : 'bg-yel/20 text-yel'}">{item.status}</span></td>
						<td class="whitespace-nowrap px-3 py-2 text-right"><span class="text-grn">{formatUsd(item.boughtUsdStr)}</span><span class="text-g4"> / </span><span class="text-red">{item.soldUsdStr ? formatUsd(item.soldUsdStr) : '—'}</span><div class="text-[9px] text-g4">{item.buys}B · {item.sells}S</div></td>
						<td class="whitespace-nowrap px-3 py-2 text-right font-medium {valueColorClass(item.profitUsd)}">{formatUsd(item.profitUsdStr)}<div class="text-[9px]">{item.profitPct === undefined ? '—' : formatPercent(item.profitPct)}</div></td>
						<td class="whitespace-nowrap px-3 py-2 text-right font-medium {valueColorClass(item.unrealizedProfitUsd)}">{formatUsd(item.unrealizedProfitUsdStr)}<div class="text-[9px]">{formatPercent(item.unrealizedProfitPct)}</div></td>
						<td class="whitespace-nowrap px-3 py-2 text-right text-g7">{formatUsd(item.balanceUsdStr)}<div class="text-[9px] text-g4">{formatCompactNumber(item.remainingTokensStr)} tokens</div></td>
						<td class="whitespace-nowrap px-3 py-2 text-right text-g7">{formatPriceText(item.avgCostBoughtStr)}<div class="text-[9px] text-g4">{item.avgCostSoldStr ? formatPriceText(item.avgCostSoldStr) : '—'}</div></td>
						<td class="whitespace-nowrap px-3 py-2 text-right text-g7">{formatPriceText(item.currentPriceUsdStr)}<div class="text-[9px] text-g4">{formatUsd(item.currentMarketCapUsdStr)}</div></td>
						<td class="whitespace-nowrap px-3 py-2 text-right text-g6">{formatUsd(item.totalFeesUsdStr)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{:else}
	<div class="divide-y divide-bd/40">
		{#each items as item, index (`mobile:${item.tokenAddress}:${index}`)}
			<div class="p-3">
				<div class="flex items-center gap-2">
					<a href={tokenHref(item)} class="min-w-0 flex-1 truncate text-xs font-medium text-tx" onclick={closeTraderPortfolio}>{item.tokenSymbol} <span class="font-normal text-g4">{item.tokenName}</span></a>
					<span class="rounded-md px-1.5 py-0.5 text-[9px] font-bold {item.status === 'ACTIVE' ? 'bg-grn/20 text-grn' : 'bg-yel/20 text-yel'}">{item.status}</span>
				</div>
				<div class="mt-2 grid grid-cols-3 gap-2 text-[10px]">
					<div><div class="text-g4">Realized</div><div class="font-medium {valueColorClass(item.profitUsd)}">{formatUsd(item.profitUsdStr)}</div><div class={valueColorClass(item.profitUsd)}>{item.profitPct === undefined ? '—' : formatPercent(item.profitPct)}</div></div>
					<div><div class="text-g4">Unrealized</div><div class="font-medium {valueColorClass(item.unrealizedProfitUsd)}">{formatUsd(item.unrealizedProfitUsdStr)}</div><div class={valueColorClass(item.unrealizedProfitUsd)}>{formatPercent(item.unrealizedProfitPct)}</div></div>
					<div class="text-right"><div class="text-g4">Balance</div><div class="font-medium text-tx">{formatUsd(item.balanceUsdStr)}</div><div class="text-g5">{formatCompactNumber(item.remainingTokensStr)}</div></div>
				</div>
				<div class="mt-2 flex items-center gap-3 border-t border-bd/40 pt-2 text-[9px] text-g5">
					<span><span class="text-grn">{item.buys} buys</span> · <span class="text-red">{item.sells} sells</span></span>
					<span>Price <span class="text-g8">{formatPriceText(item.currentPriceUsdStr)}</span></span>
					<span class="ml-auto">Fees <span class="text-g8">{formatUsd(item.totalFeesUsdStr)}</span></span>
				</div>
			</div>
		{/each}
	</div>
	{/if}
</div>
