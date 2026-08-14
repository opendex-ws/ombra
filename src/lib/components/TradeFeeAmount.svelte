<script lang="ts">
	import { formatPrice, formatPriceText } from '$lib/utils/format';

	type TradeFees = {
		gas: number;
		mev: number;
		platform: number;
		creator: number;
		cashback: number;
		total: number;
		net: number;
	};

	let { fees, showMev = false }: { fees: TradeFees; showMev?: boolean } = $props();
</script>

{#if fees.total > 0}
	<span class="group/fee relative inline-flex cursor-default items-center justify-end leading-none" aria-label={`Total fee ${formatPriceText(fees.total)}`}>
		<span class={showMev && fees.mev > 0 ? 'relative -translate-y-0.5' : ''}>{@html formatPrice(fees.total.toString())}</span>
		{#if showMev && fees.mev > 0}
			<span class="pointer-events-none absolute right-0 top-full -mt-px whitespace-nowrap text-[8px] leading-none text-org" data-mev-fee>
				MEV {@html formatPrice(fees.mev.toString())}
			</span>
		{/if}
		<div class="pointer-events-none absolute top-full right-0 z-50 mt-2 min-w-[180px] rounded-lg border border-bd bg-s5 p-2.5 text-left text-xs leading-normal opacity-0 shadow-2xl transition-opacity group-hover/fee:pointer-events-auto group-hover/fee:opacity-100">
			<div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-g6">Fee Breakdown</div>
			<div class="space-y-1">
				<div class="flex justify-between"><span class="text-g7">Gas</span><span class="text-tx">{@html formatPrice(fees.gas.toString())}</span></div>
				{#if fees.mev > 0}<div class="flex justify-between"><span class="text-g7">Priority/Jito</span><span class="text-tx">{@html formatPrice(fees.mev.toString())}</span></div>{/if}
				{#if fees.platform > 0}<div class="flex justify-between"><span class="text-g7">Platform</span><span class="text-tx">{@html formatPrice(fees.platform.toString())}</span></div>{/if}
				{#if fees.creator > 0}<div class="flex justify-between"><span class="text-g7">Creator</span><span class="text-tx">{@html formatPrice(fees.creator.toString())}</span></div>{/if}
				{#if fees.cashback > 0}<div class="flex justify-between"><span class="text-grn">Cashback</span><span class="text-grn">-{@html formatPrice(fees.cashback.toString())}</span></div>{/if}
				<div class="mt-1 flex justify-between border-t border-bd pt-1 font-medium"><span class="text-g7">Gross total</span><span class="text-tx">{@html formatPrice(fees.total.toString())}</span></div>
				{#if fees.cashback > 0}<div class="flex justify-between font-medium"><span class="text-g7">Net</span><span class="text-tx">{@html formatPrice(fees.net.toString())}</span></div>{/if}
			</div>
		</div>
	</span>
{/if}
