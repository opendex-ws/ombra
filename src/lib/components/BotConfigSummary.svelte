<script lang="ts">
	import ChainIcon from './ChainIcon.svelte';
	import { getBotChain, summarizeBotConfig, type Bot } from '$lib/utils/bot-settings';

	let { bot }: { bot: Bot } = $props();
	let chain = $derived(getBotChain(bot));
	let summary = $derived(chain ? summarizeBotConfig(chain, bot.chainConfigs[chain], bot.source.type === 'WALLET') : null);
</script>

{#if summary}
	<div class="grid gap-2 border-b border-bd bg-s2 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
		<div>
			<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Chain</div>
			<div class="mt-1 flex items-center gap-1.5 font-medium text-tx"><ChainIcon chain={summary.chain} class="h-3.5 w-3.5 text-g6" />{summary.chain}</div>
		</div>
		<div>
			<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Buy sizing</div>
			<div class="mt-1 font-medium text-tx">{summary.buy}</div>
		</div>
		{#if summary.copySells !== null}
			<div>
				<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Copied sells</div>
				<div class="mt-1 font-medium {summary.copySells === 'Disabled' ? 'text-g6' : 'text-tx'}">{summary.copySells}</div>
				{#if summary.copySellCap}<div class="mt-0.5 text-[10px] text-g4">Capped by the remaining position</div>{/if}
				{#if summary.zeroCopySell}<div class="mt-1 rounded-md bg-yel/10 px-1.5 py-1 text-[10px] text-yel">No swap; copy-sell tracking ends as fully sold</div>{/if}
			</div>
		{/if}
		<div>
			<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Position targets</div>
			<div class="mt-1 font-medium text-tx">{summary.targetCount === 0 ? 'None' : `${summary.targetCount} configured`}</div>
			{#if summary.copySells !== null && summary.copySells !== 'Disabled' && summary.targetCount > 0}<div class="mt-0.5 text-[10px] text-g4">Independent from copied sells</div>{/if}
		</div>
	</div>
{/if}
