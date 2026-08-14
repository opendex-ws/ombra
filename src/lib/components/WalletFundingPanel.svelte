<script lang="ts">
	import type { Chain } from '$lib/api/types';
	import { loadWalletFunding, type FundingEvent, type FundingSourceBreakdown, type WalletFundingResponse } from '$lib/source-funds';
	import { explorerAddressUrl, explorerTxUrl, fullDateTime, shortAddress } from '$lib/utils/format';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Landmark from 'lucide-svelte/icons/landmark';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Route from 'lucide-svelte/icons/route';
	import FundingEntityIcon from './FundingEntityIcon.svelte';

	let { chain, walletAddress }: { chain: Chain; walletAddress: string } = $props();

	let expanded = $state(false);
	let result: WalletFundingResponse | null = $state(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let showDeposits = $state(false);
	let error = $state('');
	let requestId = 0;
	let loadedTarget = '';
	let targetKey = $derived(`${chain}:${walletAddress}`);
	const sliceColors = ['var(--t-blu)', 'var(--t-grn)', 'var(--t-yel)', 'var(--t-org)', 'var(--t-pnk)', 'var(--t-g6)'];

	type SourceSlice = {
		key: string;
		name: string;
		sourceAddress: string | null;
		provider: string | null;
		entityType: string | null;
		isOther: boolean;
		transferCount: number;
		sourceCount: number;
		amounts: { amount: string; symbol: string }[];
		color: string;
	};

	let sourceSlices = $derived.by(() => buildSourceSlices(result?.summary?.sourceBreakdown ?? []));
	let totalTransfers = $derived(sourceSlices.reduce((total, slice) => total + slice.transferCount, 0));

	function isCurrent(target: string, id: number) {
		return targetKey === target && requestId === id;
	}

	async function load(reset: boolean) {
		const target = targetKey;
		const cursor = reset ? undefined : result?.nextCursor;
		if (!reset && (!cursor || loadingMore)) return;
		const id = ++requestId;
		if (reset) {
			loading = true;
			error = '';
		} else {
			loadingMore = true;
			error = '';
		}
		try {
			const page = await loadWalletFunding(chain, walletAddress, cursor);
			if (!isCurrent(target, id)) return;
			result = reset
				? page
				: {
						...page,
						summary: result?.summary ?? page.summary,
						items: [...(result?.items ?? []), ...page.items]
					};
			loadedTarget = target;
		} catch (cause) {
			if (!isCurrent(target, id)) return;
			error = cause instanceof Error ? cause.message : 'Failed to load wallet funding evidence.';
			if (reset) result = null;
		} finally {
			if (isCurrent(target, id)) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	function toggle() {
		expanded = !expanded;
		if (expanded && loadedTarget !== targetKey && !loading) void load(true);
	}

	function refresh() {
		void load(true);
	}

	function sourceName(item: FundingEvent) {
		return item.labelEvidence?.label || shortAddress(item.sourceAddress);
	}

	function assetName(item: FundingEvent) {
		return item.asset.symbol || shortAddress(item.asset.mint || '');
	}

	function buildSourceSlices(entries: FundingSourceBreakdown[]): SourceSlice[] {
		const grouped = new Map<string, Omit<SourceSlice, 'color'>>();
		for (const entry of entries) {
			const label = entry.label?.trim() || '';
			const provider = entry.provider?.trim() || '';
			const entityType = entry.entityType?.trim() || '';
			const knownGroup = Boolean(label || provider || entityType);
			const key = entry.isOther
				? '__other__'
				: knownGroup
					? `known:${label.toLocaleLowerCase()}|${provider.toLocaleLowerCase()}|${entityType.toLocaleLowerCase()}`
					: `direct:${entry.sourceAddress || '__unknown__'}`;
			const current = grouped.get(key) ?? {
				key,
				name: label || entityType || provider || (entry.sourceAddress ? shortAddress(entry.sourceAddress) : 'Unknown source'),
				sourceAddress: knownGroup ? null : entry.sourceAddress,
				provider: provider || null,
				entityType: entityType || null,
				isOther: entry.isOther,
				transferCount: 0,
				sourceCount: 0,
				amounts: []
			};
			current.transferCount += entry.transferCount;
			current.sourceCount = Math.max(current.sourceCount, entry.sourceCount);
			current.amounts.push({ amount: entry.amount, symbol: entry.asset.symbol || shortAddress(entry.asset.mint || '') });
			grouped.set(key, current);
		}

		const sorted = [...grouped.values()].sort((left, right) => right.transferCount - left.transferCount || left.name.localeCompare(right.name));
		if (sorted.length <= 5) {
			return sorted.map((slice, index) => ({ ...slice, color: sliceColors[index] }));
		}

		const visible = sorted.slice(0, 5);
		const remainder = sorted.slice(5);
		visible.push({
			key: '__remainder__',
			name: 'Other sources',
			sourceAddress: null,
			provider: null,
			entityType: null,
			isOther: true,
			transferCount: remainder.reduce((total, slice) => total + slice.transferCount, 0),
			sourceCount: remainder.reduce((total, slice) => total + Math.max(slice.sourceCount, 1), 0),
			amounts: remainder.flatMap((slice) => slice.amounts).slice(0, 6)
		});
		return visible.map((slice, index) => ({ ...slice, color: sliceColors[index] }));
	}

	function slicePercent(slice: SourceSlice) {
		return totalTransfers === 0 ? 0 : (slice.transferCount / totalTransfers) * 100;
	}

	function sliceOffset(index: number) {
		if (totalTransfers === 0) return 0;
		return sourceSlices.slice(0, index).reduce((total, slice) => total + slicePercent(slice), 0);
	}

	$effect(() => {
		targetKey;
		requestId++;
		expanded = false;
		result = null;
		error = '';
		loading = false;
		loadingMore = false;
		showDeposits = false;
		loadedTarget = '';
	});
</script>

<section class="my-3 overflow-hidden rounded-2xl border border-bd bg-s1" aria-label="Wallet funding evidence">
	<button type="button" class="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-wh/5" onclick={toggle} aria-expanded={expanded}>
		<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blu/10 text-blu"><Landmark class="h-4 w-4" /></span>
		<span class="min-w-0 flex-1">
			<span class="block text-xs font-semibold text-tx">Funding history</span>
			<span class="block truncate text-[10px] text-g5">Trace deposits to a known exchange or bridge</span>
		</span>
		{#if result?.summary?.attributedOrigin}
			<span class="hidden max-w-40 items-center gap-1.5 rounded-lg bg-s7 px-2 py-1 sm:inline-flex">
				<FundingEntityIcon label={result.summary.attributedOrigin.label} entityType={result.summary.attributedOrigin.entityType} class="h-4 w-4" />
				<span class="truncate text-[10px] font-medium text-g8">{result.summary.attributedOrigin.label || shortAddress(result.summary.attributedOrigin.address)}</span>
			</span>
		{/if}
		<ChevronDown class="h-4 w-4 shrink-0 text-g5 transition-transform {expanded ? 'rotate-180' : ''}" />
	</button>

	{#if expanded}
		<div class="border-t border-bd p-3">
			{#if loading}
				<div class="flex items-center justify-center gap-2 py-8 text-xs text-g6"><LoaderCircle class="h-4 w-4 animate-spin" /> Loading funding history…</div>
			{:else if error && !result}
				<div class="rounded-xl border border-red/20 bg-red/10 p-3 text-xs text-red">
					<div>{error}</div>
					<button type="button" class="btn-secondary mt-2 px-2.5 py-1 text-[10px]" onclick={refresh}>Try again</button>
				</div>
			{:else if result}
				{@const attributedSource = result.summary?.attributedSource}
				<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
					<div class="rounded-xl border border-bd bg-s2 p-3 sm:col-span-2 lg:col-span-1">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Best attributed source</div>
						{#if attributedSource}
							<div class="mt-2 flex items-start gap-2">
								<FundingEntityIcon label={attributedSource.label} entityType={attributedSource.entityType} class="h-7 w-7" />
								<div class="min-w-0 space-y-1">
									<div class="text-[9px] text-g5">{attributedSource.hopCount === 0 ? 'Direct sender' : `${attributedSource.hopCount} hop${attributedSource.hopCount === 1 ? '' : 's'} upstream`}</div>
									<a href={explorerAddressUrl(chain, attributedSource.attributedAddress || attributedSource.sourceAddress)} target="_blank" rel="noopener" class="block truncate text-xs font-semibold text-tx transition-colors hover:text-blu">{attributedSource.label || shortAddress(attributedSource.attributedAddress || attributedSource.sourceAddress)}</a>
									{#if attributedSource.attributedAddress && attributedSource.attributedAddress !== attributedSource.sourceAddress}
										<div class="truncate text-[9px] text-g5">via direct sender {shortAddress(attributedSource.sourceAddress)}</div>
									{/if}
									<div class="truncate text-[9px] capitalize text-g5">{[attributedSource.entityType, attributedSource.provider].filter(Boolean).join(' · ') || 'Known source'}</div>
								</div>
							</div>
						{:else if result.summary?.attributedOrigin}
							<div class="mt-2 flex items-center gap-2">
								<FundingEntityIcon label={result.summary.attributedOrigin.label} entityType={result.summary.attributedOrigin.entityType} class="h-7 w-7" />
								<div class="min-w-0">
									<a href={explorerAddressUrl(chain, result.summary.attributedOrigin.address)} target="_blank" rel="noopener" class="block truncate text-xs font-semibold text-tx transition-colors hover:text-blu">{result.summary.attributedOrigin.label || shortAddress(result.summary.attributedOrigin.address)}</a>
									<div class="mt-0.5 text-[9px] capitalize text-g5">Known source · path unavailable</div>
								</div>
							</div>
						{:else}
							<div class="mt-2 text-xs text-g6">No known origin</div>
						{/if}
					</div>
					<div class="rounded-xl border border-bd bg-s2 p-3">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Direct sources</div>
						<div class="mt-1 text-lg font-bold text-tx">{result.summary?.distinctSourceCount ?? '—'}</div>
						<div class="text-[9px] text-g5">Unique retained senders</div>
					</div>
					<div class="rounded-xl border border-bd bg-s2 p-3">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g5">First funding</div>
						<div class="mt-1 text-[11px] font-semibold text-tx">{result.summary?.firstFunding ? fullDateTime(result.summary.firstFunding.blockTime.timestamp) : '—'}</div>
						<div class="text-[9px] text-g5">Within retained history</div>
					</div>
					<div class="rounded-xl border border-bd bg-s2 p-3">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Latest funding</div>
						<div class="mt-1 text-[11px] font-semibold text-tx">{result.summary?.latestFunding ? fullDateTime(result.summary.latestFunding.blockTime.timestamp) : '—'}</div>
						<div class="text-[9px] text-g5">Within retained history</div>
					</div>
					<div class="rounded-xl border border-bd bg-s2 p-3">
						<div class="text-[9px] font-medium uppercase tracking-wider text-g5">Coverage begins</div>
						<div class="mt-1 text-[11px] font-semibold text-tx">{result.summary?.coverageStart ? fullDateTime(result.summary.coverageStart.timestamp) : '—'}</div>
						<div class="text-[9px] text-g5">Earlier activity may be absent</div>
					</div>
				</div>

				{#if sourceSlices.length > 0}
					<div class="mt-4 rounded-xl border border-bd bg-s2 p-3">
						<div class="mb-3 flex items-center gap-2">
							<Route class="h-3.5 w-3.5 text-g5" />
							<div>
								<h3 class="text-[10px] font-semibold uppercase tracking-wider text-g6">Funding distribution</h3>
								<div class="text-[9px] text-g5">Share of retained funding deposits by event count · latest 10k rows</div>
							</div>
							<button type="button" class="ml-auto cursor-pointer rounded p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-tx" onclick={refresh} aria-label="Refresh funding history" title="Refresh funding history"><RefreshCw class="h-3.5 w-3.5" /></button>
						</div>
						<div class="grid items-center gap-4 md:grid-cols-[9rem_1fr]">
							<div class="relative mx-auto h-32 w-32">
								<svg viewBox="0 0 42 42" class="h-full w-full -rotate-90" role="img" aria-label={`Funding distribution across ${sourceSlices.length} sources`}>
									<circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--t-s4)" stroke-width="5" />
									{#each sourceSlices as slice, index (slice.key)}
										<circle cx="21" cy="21" r="15.9155" fill="none" stroke={slice.color} stroke-width="5" pathLength="100" stroke-dasharray={`${slicePercent(slice)} ${100 - slicePercent(slice)}`} stroke-dashoffset={-sliceOffset(index)} />
									{/each}
								</svg>
								<div class="absolute inset-0 flex flex-col items-center justify-center text-center">
									<span class="text-lg font-bold text-tx">{totalTransfers}</span>
									<span class="text-[9px] text-g5">deposits</span>
								</div>
							</div>
							<div class="grid gap-1.5 sm:grid-cols-2">
								{#each sourceSlices as slice (slice.key)}
									<div class="flex min-w-0 items-center gap-2 rounded-lg bg-s1 px-2.5 py-2">
										<span class="h-2.5 w-2.5 shrink-0 rounded-full" style={`background: ${slice.color}`}></span>
										<FundingEntityIcon label={slice.name} entityType={slice.entityType} class="h-5 w-5" />
										<div class="min-w-0 flex-1">
											{#if slice.sourceAddress}
												<a href={explorerAddressUrl(chain, slice.sourceAddress)} target="_blank" rel="noopener" class="block truncate text-[10px] font-semibold text-tx transition-colors hover:text-blu">{slice.name}</a>
											{:else}
												<div class="truncate text-[10px] font-semibold text-tx">{slice.name}</div>
											{/if}
											<div class="truncate text-[9px] text-g5">
												{slice.transferCount} deposit{slice.transferCount === 1 ? '' : 's'}
												{#if slice.entityType || slice.provider} · {[slice.entityType, slice.provider].filter(Boolean).join(' · ')}{/if}
												{#if slice.amounts.length > 0} · {slice.amounts.map((amount) => `${amount.amount} ${amount.symbol}`).join(' · ')}{/if}
											</div>
										</div>
										<span class="shrink-0 text-[10px] font-semibold text-g8">{slicePercent(slice).toFixed(1)}%</span>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}

				{#if result.items.length === 0}
					<div class="mt-3 flex items-center justify-center gap-2 rounded-xl border border-bd bg-s2 py-6 text-xs text-g6">
						<span>No retained funding deposits for this wallet.</span>
						<button type="button" class="cursor-pointer rounded p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-tx" onclick={refresh} aria-label="Refresh funding history" title="Refresh funding history"><RefreshCw class="h-3.5 w-3.5" /></button>
					</div>
				{:else}
					<button type="button" class="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-bd bg-s2 px-3 py-2.5 text-left transition-colors hover:bg-wh/5" onclick={() => (showDeposits = !showDeposits)} aria-expanded={showDeposits}>
						<Route class="h-3.5 w-3.5 text-g5" />
						<span class="flex-1 text-[10px] font-semibold text-g8">Raw deposit evidence</span>
						<span class="text-[9px] text-g5">{result.items.length} loaded</span>
						<ChevronDown class="h-3.5 w-3.5 text-g5 transition-transform {showDeposits ? 'rotate-180' : ''}" />
					</button>
					{#if showDeposits}
					<div class="mt-2 overflow-hidden rounded-xl border border-bd bg-s2">
						{#each result.items as item, index (item.id)}
							<div class="flex items-start gap-3 p-3 {index > 0 ? 'border-t border-bd' : ''}">
								<FundingEntityIcon label={item.labelEvidence?.label} entityType={item.labelEvidence?.entityType} class="mt-0.5 h-6 w-6" />
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-1.5">
										<a href={explorerAddressUrl(chain, item.sourceAddress)} target="_blank" rel="noopener" class="truncate text-[11px] font-semibold text-tx transition-colors hover:text-blu" aria-label={`Open funding source ${sourceName(item)} in explorer`}>{sourceName(item)}</a>
										{#if item.labelEvidence?.entityType}<span class="rounded bg-blu/10 px-1.5 py-px text-[9px] capitalize text-blu">{item.labelEvidence.entityType}</span>{/if}
										{#if item.labelEvidence?.provider}<span class="rounded bg-s7 px-1.5 py-px text-[9px] text-g6">{item.labelEvidence.provider}</span>{/if}
									</div>
									<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-g5">
										<span>{fullDateTime(item.blockTime.timestamp)}</span>
										<span>Slot {item.slot}</span>
										<span class="font-mono">{shortAddress(item.transactionSignature)}</span>
									</div>
								</div>
								<div class="shrink-0 text-right">
									<div class="text-[11px] font-semibold text-tx">{item.amount} {assetName(item)}</div>
									<a href={explorerTxUrl(chain, item.transactionSignature)} target="_blank" rel="noopener" class="mt-1 inline-flex rounded p-1 text-g4 transition-colors hover:bg-s7 hover:text-tx" aria-label="Open funding transaction in explorer"><ExternalLink class="h-3 w-3" /></a>
								</div>
							</div>
						{/each}
					</div>
					{#if result.nextCursor}
						{#if error}<div class="mt-2 text-[10px] text-red">{error}</div>{/if}
						<button type="button" class="btn-secondary mt-2 w-full px-3 py-1.5 text-[10px]" disabled={loadingMore} onclick={() => load(false)}>
							{#if loadingMore}<span class="inline-flex items-center gap-1"><LoaderCircle class="h-3 w-3 animate-spin" /> Loading more…</span>{:else}Load more deposits{/if}
						</button>
					{/if}
					{/if}
				{/if}
			{/if}
		</div>
	{/if}
</section>
