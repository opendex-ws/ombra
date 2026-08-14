<script lang="ts">
	import type { TokenSwap } from '$lib/api/types';
	import { formatPriceText } from '$lib/utils/format';
	import Blocks from 'lucide-svelte/icons/blocks';
	import Zap from 'lucide-svelte/icons/zap';
	import FundingEntityIcon from './FundingEntityIcon.svelte';

	type ExecutionTrade = Pick<TokenSwap, 'txPlacePercent' | 'isBuilder'> & {
		platformType?: TokenSwap['platformType'];
		executionProgram?: TokenSwap['executionProgram'];
		fees?: Pick<NonNullable<TokenSwap['fees']>, 'mevFeeUsd' | 'mevFeeUsdStr'>;
	};

	let {
		trade,
		section = 'all',
		showMevAmount = true
	}: {
		trade: ExecutionTrade;
		section?: 'all' | 'attribution' | 'details';
		showMevAmount?: boolean;
	} = $props();
	let mevFeeUsd = $derived(Number(trade.fees?.mevFeeUsdStr ?? trade.fees?.mevFeeUsd ?? 0));
	let hasMevFee = $derived(Number.isFinite(mevFeeUsd) && mevFeeUsd > 0);
	let showAttribution = $derived(section !== 'details');
	let showDetails = $derived(section !== 'attribution');
	let hasAttribution = $derived(
		Boolean(
			trade.executionProgram &&
				trade.executionProgram.kind !== 'UNKNOWN' &&
				trade.executionProgram.name.trim().toUpperCase() !== 'OTHER'
		)
	);
	let hasVisibleMev = $derived(hasMevFee && (showMevAmount || trade.isBuilder === true));
	let hasDetails = $derived(trade.txPlacePercent != null || trade.isBuilder === true || hasVisibleMev);
	let executionName = $derived(
		trade.executionProgram?.name === 'GENERIC BOT' ? 'GENERIC' : (trade.executionProgram?.name ?? '')
	);
	let executionTone = $derived(
		trade.executionProgram?.kind === 'INTERFACE'
			? 'text-blu'
			: trade.executionProgram?.kind === 'AGGREGATOR'
				? 'text-pnk'
				: trade.executionProgram?.kind === 'DEX'
					? 'text-g9'
					: 'text-g5'
	);
</script>

{#if (showAttribution && hasAttribution) || (showDetails && hasDetails)}
	<span class="inline-flex shrink-0 items-center gap-1 rounded bg-s4 px-1 py-px text-[9px] text-g6" aria-label="Trade execution metadata">
		{#if showAttribution && hasAttribution && trade.executionProgram}
			<span
				class="inline-flex items-center gap-0.5 {executionTone}"
				title={`Via ${executionName} · ${trade.executionProgram.id}`}
				aria-label={`Execution via ${executionName}`}
			>
				<FundingEntityIcon
					label={executionName}
					entityType={trade.executionProgram.kind}
					programId={trade.executionProgram.id}
					class="h-3 w-3"
				/>
				<span class="font-semibold">{executionName}</span>
			</span>
		{/if}
		{#if showDetails && trade.txPlacePercent != null}
			<span
				class="inline-flex items-center gap-0.5"
				title={`Transaction position: ${trade.txPlacePercent}% through block`}
				aria-label={`Transaction position: ${trade.txPlacePercent}% through block`}
			>
				<Blocks class="h-2.5 w-2.5" />
				<span class="font-mono">{trade.txPlacePercent}%</span>
			</span>
		{/if}
		{#if showDetails && trade.isBuilder === true}
			<span
				class="inline-flex items-center gap-0.5 text-yel"
				title={hasMevFee ? `Builder/Jito activity detected · priority and Jito fees ${formatPriceText(mevFeeUsd)}` : 'Builder/Jito activity detected'}
				aria-label={hasMevFee ? `Builder or Jito activity detected with ${formatPriceText(mevFeeUsd)} in priority and Jito fees` : 'Builder or Jito activity detected'}
			>
				<Zap class="h-2.5 w-2.5" />
				{#if hasMevFee && showMevAmount}<span>{formatPriceText(mevFeeUsd)}</span>{/if}
			</span>
		{:else if showDetails && hasMevFee && showMevAmount}
			<span class="inline-flex items-center gap-0.5 text-org" title={`Priority/Jito fee: ${formatPriceText(mevFeeUsd)}`} aria-label={`Priority or Jito fee: ${formatPriceText(mevFeeUsd)}`}>
				<Zap class="h-2.5 w-2.5" />
				{#if showMevAmount}<span>{formatPriceText(mevFeeUsd)}</span>{/if}
			</span>
		{/if}
	</span>
{/if}
