<script lang="ts">
	import type { Chain, TokenSwap } from '$lib/api/types';
	import { getNow } from '$lib/stores/tick.svelte';
	import { calculateTradeFees } from '$lib/utils/trade-fees';
	import { explorerAddressUrl, explorerTxUrl, formatNumber, fullDateTime, shortAddress, timeAgo } from '$lib/utils/format';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Filter from 'lucide-svelte/icons/funnel';
	import CurrencyValue from './CurrencyValue.svelte';
	import TradeExecutionMeta from './TradeExecutionMeta.svelte';
	import TradeFeeAmount from './TradeFeeAmount.svelte';

	let {
		trade,
		chain,
		mobile = false,
		filteredMaker = '',
		onOpenTrader,
		onFilterMaker
	}: {
		trade: TokenSwap;
		chain: Chain | string;
		mobile?: boolean;
		filteredMaker?: string;
		onOpenTrader: (walletAddress: string) => void;
		onFilterMaker: (walletAddress: string) => void;
	} = $props();

	let fees = $derived(calculateTradeFees(trade));
</script>

{#if mobile}
	<div class="h-[52px] overflow-hidden border-b border-bd/20 px-3 py-2 [contain:layout_paint_style]">
		<div class="flex items-center gap-2">
			<span class="shrink-0 text-xs font-bold {trade.side === 'BUY' ? 'text-grn' : 'text-red'}">{trade.side ?? '—'}</span>
			<TradeExecutionMeta {trade} section="attribution" />
			<CurrencyValue usd={trade.amountUsdStr ?? String(trade.amountUsd)} native={trade.amountNativeStr ?? String(trade.amountNative)} {chain} mode="value" class="text-xs text-tx font-medium" iconClass="h-3 w-3 text-tx" />
			<span class="ml-auto max-w-[100px] truncate text-right text-xs text-g7">{formatNumber(trade.amountTokenStr ?? String(trade.amountToken))}</span>
			<span class="shrink-0 cursor-help text-[11px] text-g5" title={fullDateTime(trade.timestamp)}>{timeAgo(trade.timestamp, getNow())}</span>
		</div>
		<div class="mt-0.5 flex items-center gap-3 text-[11px]">
			<div class="flex min-w-0 items-center gap-1">
				<button type="button" class="min-w-0 cursor-pointer truncate text-left transition-colors hover:text-tx {(trade.labels ?? []).length > 0 ? 'font-medium text-blu' : trade.isDev ? 'font-medium text-yel' : 'text-g5'}" onclick={() => onOpenTrader(trade.walletAddress ?? '')}>{(trade.labels ?? []).length > 0 ? trade.labels![0].label : trade.isDev ? 'Dev' : shortAddress(trade.walletAddress ?? '')}</button>
				<button type="button" class="shrink-0 cursor-pointer p-0.5 text-g2 transition-colors hover:text-grn {filteredMaker === trade.walletAddress ? 'text-grn' : ''}" onclick={() => onFilterMaker(trade.walletAddress ?? '')}><Filter class="h-2.5 w-2.5" /></button>
				<a href={explorerAddressUrl(chain as string, trade.walletAddress ?? '')} target="_blank" rel="noopener" class="shrink-0 p-0.5 text-g4 transition-colors hover:text-tx" aria-label="Open wallet in explorer" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><ExternalLink class="h-3 w-3" /></a>
			</div>
			<div class="flex items-center gap-1">
				{#if fees.total > 0}<span class="text-g5">fee</span>{/if}
				<TradeExecutionMeta {trade} section="details" showMevAmount={false} />
				<TradeFeeAmount {fees} showMev={trade.isBuilder === true} />
			</div>
			{#if trade.txHash}<a href={explorerTxUrl(chain as string, trade.txHash)} target="_blank" rel="noopener" class="ml-auto text-g5 hover:text-g9">{shortAddress(trade.txHash)}</a>{/if}
		</div>
	</div>
{:else}
	<div class="grid h-[33px] grid-cols-[minmax(70px,1fr)_minmax(70px,1fr)_minmax(70px,1fr)_minmax(60px,1fr)_minmax(90px,1.2fr)_minmax(60px,0.9fr)_minmax(60px,0.9fr)_minmax(50px,0.8fr)] items-center gap-2 border-b border-bd/20 px-1 transition-colors hover:bg-wh/5 [contain:layout_paint_style]">
		<div class="flex items-center gap-1.5 {trade.side === 'BUY' ? 'text-grn' : 'text-red'}">
			<span>{trade.side ?? '—'}</span>
			<TradeExecutionMeta {trade} section="attribution" />
		</div>
		<div class="text-right text-tx"><CurrencyValue usd={trade.priceUsdStr ?? String(trade.priceUsd)} native={trade.priceNativeStr ?? String(trade.priceNative)} {chain} mode="price" class="justify-end text-tx" iconClass="h-3 w-3 text-tx" /></div>
		<div class="text-right text-tx"><CurrencyValue usd={trade.amountUsdStr ?? String(trade.amountUsd)} native={trade.amountNativeStr ?? String(trade.amountNative)} {chain} mode="value" class="justify-end text-tx" iconClass="h-3 w-3 text-tx" /></div>
		<div class="truncate text-right text-g7">{formatNumber(trade.amountTokenStr ?? String(trade.amountToken))}</div>
		<div class="flex items-center justify-end gap-1">
			<button type="button" class="min-w-0 cursor-pointer truncate transition-colors hover:text-tx {(trade.labels ?? []).length > 0 ? 'font-medium text-blu' : trade.isDev ? 'font-medium text-yel' : 'text-g7'}" onclick={() => onOpenTrader(trade.walletAddress ?? '')}>{(trade.labels ?? []).length > 0 ? trade.labels![0].label : trade.isDev ? 'Dev' : shortAddress(trade.walletAddress ?? '')}</button>
			<button type="button" class="shrink-0 cursor-pointer p-0.5 text-g2 transition-colors hover:text-grn {filteredMaker === trade.walletAddress ? 'text-grn' : ''}" onclick={(event) => { event.stopPropagation(); onFilterMaker(trade.walletAddress ?? ''); }} title="Filter by this maker"><Filter class="h-2.5 w-2.5" /></button>
			<a href={explorerAddressUrl(chain as string, trade.walletAddress ?? '')} target="_blank" rel="noopener" class="shrink-0 p-0.5 text-g4 transition-colors hover:text-tx" aria-label="Open wallet in explorer" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><ExternalLink class="h-3 w-3" /></a>
		</div>
		<div class="relative flex items-center justify-end gap-1 text-g6">
			<TradeExecutionMeta {trade} section="details" showMevAmount={false} />
			<TradeFeeAmount {fees} showMev={trade.isBuilder === true} />
		</div>
		<div class="truncate text-right">
			{#if trade.txHash}
				<a href={explorerTxUrl(chain as string, trade.txHash)} target="_blank" rel="noopener" class="text-g6 hover:text-g11">{shortAddress(trade.txHash)}</a>
			{:else}
				<span class="text-g6">—</span>
			{/if}
		</div>
		<div class="truncate text-right text-g6 cursor-help" title={fullDateTime(trade.timestamp)}>{timeAgo(trade.timestamp, getNow())}</div>
	</div>
{/if}
