<script lang="ts">
	import type { Chain } from '$lib/api/types';
	import type { FundingSourcePreview } from '$lib/source-funds';
	import { explorerAddressUrl, explorerTxUrl, fullDateTime, shortAddress, timeAgo } from '$lib/utils/format';
	import { getNow } from '$lib/stores/tick.svelte';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import FundingEntityIcon from './FundingEntityIcon.svelte';

	let {
		chain,
		fundingSource,
		compact = false
	}: {
		chain: Chain | string;
		fundingSource: FundingSourcePreview | null;
		compact?: boolean;
	} = $props();

	const componentId = $props.id();
	let attributedUpstream = $derived(
		!!fundingSource?.attributedAddress && fundingSource.attributedAddress !== fundingSource.sourceAddress
	);
	let sourceAddress = $derived(fundingSource?.attributedAddress || fundingSource?.sourceAddress || '');
	let sourceLabel = $derived(fundingSource?.label || (fundingSource ? shortAddress(sourceAddress) : '—'));
	let assetLabel = $derived(
		fundingSource ? fundingSource.asset.symbol || shortAddress(fundingSource.asset.mint || '') : ''
	);
	let tooltipId = $derived(fundingSource ? `${componentId}-funding-source` : undefined);
	let detailLabel = $derived.by(() => {
		if (!fundingSource) return 'Funding source unavailable';
		const parts = [
			`Funded by ${sourceLabel}`,
			attributedUpstream ? `via ${shortAddress(fundingSource.sourceAddress)}` : null,
			`${fundingSource.amount} ${assetLabel}`,
			`${fundingSource.hopCount} hop${fundingSource.hopCount === 1 ? '' : 's'}`,
			fullDateTime(fundingSource.fundingTime.timestamp)
		];
		return parts.filter(Boolean).join(', ');
	});
</script>

{#if !fundingSource}
	<span class="text-g6" aria-label="Funding source unavailable" title="Funding source unavailable">—</span>
{:else}
	<div
		class="group/funding relative inline-flex max-w-full items-center rounded-lg border border-bd bg-s2 text-left {compact ? 'gap-1.5 px-1.5 py-0.5' : 'gap-2 px-2 py-1'}"
		aria-label={detailLabel}
	>
		<FundingEntityIcon label={fundingSource.label} entityType={fundingSource.entityType} class={compact ? 'h-4 w-4' : 'h-5 w-5'} />
		<div class="min-w-0">
			<div class="flex min-w-0 items-center gap-1.5">
				<a
					href={explorerAddressUrl(chain, sourceAddress)}
					target="_blank"
					rel="noopener"
					class="truncate text-[11px] font-semibold text-tx transition-colors hover:text-blu"
					aria-label={`Open funding source ${sourceLabel} in explorer`}
					aria-describedby={tooltipId}
					title={detailLabel}
					onclick={(event) => event.stopPropagation()}
				>{sourceLabel}</a>
				{#if fundingSource.hopCount > 0}
					<span class="shrink-0 rounded bg-blu/10 px-1 py-px text-[9px] font-medium text-blu">{fundingSource.hopCount} hop{fundingSource.hopCount === 1 ? '' : 's'}</span>
				{/if}
			</div>
			<div class="flex items-center gap-1 text-[9px] text-g5">
				<span class="truncate text-g8">{fundingSource.amount} {assetLabel}</span>
				<span aria-hidden="true">·</span>
				<span class="shrink-0" title={fullDateTime(fundingSource.fundingTime.timestamp)}>{timeAgo(fundingSource.fundingTime.timestamp, getNow())}</span>
			</div>
		</div>
		{#if !compact}
			<a
				href={explorerTxUrl(chain, fundingSource.transactionSignature)}
				target="_blank"
				rel="noopener"
				class="shrink-0 rounded p-1 text-g4 transition-colors hover:bg-s7 hover:text-tx"
				aria-label="Open funding transaction in explorer"
				aria-describedby={tooltipId}
				title="Open funding transaction"
				onclick={(event) => event.stopPropagation()}
			><ExternalLink class="h-3 w-3" /></a>
		{/if}
		<div id={tooltipId} class="pointer-events-none absolute top-full right-0 z-50 mt-1.5 hidden w-64 rounded-xl border border-bd bg-s5 p-3 text-left text-[10px] shadow-2xl group-hover/funding:block group-focus-within/funding:block" role="tooltip">
			<div class="flex items-center gap-2">
				<FundingEntityIcon label={fundingSource.label} entityType={fundingSource.entityType} class="h-6 w-6" />
				<div class="min-w-0">
					<div class="truncate font-semibold text-tx">{sourceLabel}</div>
					<div class="text-g5">{fundingSource.entityType || 'Funding source'}</div>
				</div>
			</div>
			<div class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-bd pt-2 text-g5">
				{#if attributedUpstream}<span>Via wallet</span><span class="truncate text-right font-mono text-g8">{shortAddress(fundingSource.sourceAddress)}</span>{/if}
				<span>Provider</span><span class="truncate text-right text-g8">{fundingSource.provider || '—'}</span>
				<span>Path</span><span class="text-right text-g8">{fundingSource.hopCount} hop{fundingSource.hopCount === 1 ? '' : 's'}</span>
				<span>Amount</span><span class="truncate text-right text-g8">{fundingSource.amount} {assetLabel}</span>
				<span>Funded</span><span class="text-right text-g8">{fullDateTime(fundingSource.fundingTime.timestamp)}</span>
			</div>
		</div>
	</div>
{/if}
