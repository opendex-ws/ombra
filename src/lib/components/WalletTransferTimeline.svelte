<script lang="ts">
	import type { Chain } from '$lib/api/types';
	import {
		loadWalletTransfers,
		type WalletTransferEvent,
		type WalletTransferHistoryResponse
	} from '$lib/source-transfers';
	import { explorerAddressUrl, explorerTxUrl, fullDateTime, shortAddress } from '$lib/utils/format';
	import ArrowDownLeft from 'lucide-svelte/icons/arrow-down-left';
	import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import History from 'lucide-svelte/icons/history';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Repeat2 from 'lucide-svelte/icons/repeat-2';

	let { chain, walletAddress }: { chain: Chain; walletAddress: string } = $props();

	let expanded = $state(false);
	let result: WalletTransferHistoryResponse | null = $state(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state('');
	let requestId = 0;
	let loadedTarget = '';
	let targetKey = $derived(`${chain}:${walletAddress}`);
	let supported = $derived(String(chain).toUpperCase() === 'SOL');

	function isCurrent(target: string, id: number) {
		return targetKey === target && requestId === id;
	}

	async function load(reset: boolean) {
		if (!supported) return;
		const target = targetKey;
		const cursor = reset ? undefined : result?.nextCursor;
		if (!reset && (!cursor || loadingMore)) return;
		const id = ++requestId;
		if (reset) loading = true;
		else loadingMore = true;
		error = '';
		try {
			const page = await loadWalletTransfers(chain, walletAddress, cursor);
			if (!isCurrent(target, id)) return;
			result = reset
				? page
				: {
						...page,
						coverageStart: result?.coverageStart ?? page.coverageStart,
						items: [...(result?.items ?? []), ...page.items]
					};
			loadedTarget = target;
		} catch (cause) {
			if (!isCurrent(target, id)) return;
			error = cause instanceof Error ? cause.message : 'Failed to load wallet transfer history.';
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
		if (expanded && supported && loadedTarget !== targetKey && !loading) void load(true);
	}

	function directionLabel(item: WalletTransferEvent) {
		if (item.direction === 'incoming') return 'Received';
		if (item.direction === 'outgoing') return 'Sent';
		return 'Self transfer';
	}

	function counterparty(item: WalletTransferEvent) {
		if (item.direction === 'incoming') return item.sourceAddress || item.sourceTokenAccount;
		if (item.direction === 'outgoing') return item.destinationAddress || item.destinationTokenAccount;
		return walletAddress;
	}

	function assetLabel(item: WalletTransferEvent) {
		return item.asset.symbol || shortAddress(item.asset.mint || item.asset.assetKind);
	}

	function readableClass(value: string) {
		return value.replaceAll('_', ' ');
	}

	$effect(() => {
		targetKey;
		requestId++;
		expanded = false;
		result = null;
		error = '';
		loading = false;
		loadingMore = false;
		loadedTarget = '';
	});
</script>

<section class="my-3 overflow-hidden rounded-2xl border border-bd bg-s1" aria-label="Wallet transfer history">
	<button type="button" class="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-wh/5" onclick={toggle} aria-expanded={expanded}>
		<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-org/10 text-org"><History class="h-4 w-4" /></span>
		<span class="min-w-0 flex-1">
			<span class="block text-xs font-semibold text-tx">Transfer history</span>
			<span class="block truncate text-[10px] text-g5">All retained wallet transfer classes · seven-day ledger</span>
		</span>
		{#if result}<span class="rounded bg-s7 px-2 py-1 text-[9px] text-g6">{result.items.length} loaded</span>{/if}
		<ChevronDown class="h-4 w-4 shrink-0 text-g5 transition-transform {expanded ? 'rotate-180' : ''}" />
	</button>

	{#if expanded}
		<div class="border-t border-bd p-3">
			{#if !supported}
				<div class="rounded-xl border border-bd bg-s2 p-4 text-center text-xs text-g6">Transfer history is currently available for Solana wallets.</div>
			{:else if loading}
				<div class="flex items-center justify-center gap-2 py-8 text-xs text-g6"><LoaderCircle class="h-4 w-4 animate-spin" /> Loading transfer history…</div>
			{:else if error && !result}
				<div class="rounded-xl border border-red/20 bg-red/10 p-3 text-xs text-red">
					<div>{error}</div>
					<button type="button" class="btn-secondary mt-2 px-2.5 py-1 text-[10px]" onclick={() => load(true)}>Try again</button>
				</div>
			{:else if result}
				<div class="mb-3 flex items-center gap-2 rounded-xl border border-bd bg-s2 px-3 py-2 text-[9px] text-g5">
					<span>Coverage begins {fullDateTime(result.coverageStart.timestamp)} · retained for {result.retentionDays} days</span>
					<button type="button" class="ml-auto cursor-pointer rounded p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-tx" onclick={() => load(true)} aria-label="Refresh transfer history" title="Refresh transfer history"><RefreshCw class="h-3.5 w-3.5" /></button>
				</div>

				{#if result.items.length === 0}
					<div class="rounded-xl border border-bd bg-s2 py-6 text-center text-xs text-g6">No transfers in the retained window.</div>
				{:else}
					<div class="overflow-hidden rounded-xl border border-bd bg-s2">
						{#each result.items as item, index (item.id)}
							{@const party = counterparty(item)}
							<div class="relative flex items-start gap-3 p-3 {index > 0 ? 'border-t border-bd' : ''}">
								<span class="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full {item.direction === 'incoming' ? 'bg-grn/10 text-grn' : item.direction === 'outgoing' ? 'bg-red/10 text-red' : 'bg-blu/10 text-blu'}">
									{#if item.direction === 'incoming'}<ArrowDownLeft class="h-3.5 w-3.5" />{:else if item.direction === 'outgoing'}<ArrowUpRight class="h-3.5 w-3.5" />{:else}<Repeat2 class="h-3.5 w-3.5" />{/if}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="text-[11px] font-semibold text-tx">{directionLabel(item)}</span>
										<a href={explorerAddressUrl(chain, party)} target="_blank" rel="noopener" class="truncate font-mono text-[10px] text-g7 transition-colors hover:text-blu">{shortAddress(party)}</a>
										<span class="rounded bg-s7 px-1.5 py-px text-[9px] capitalize text-g6">{readableClass(item.transferClass)}</span>
										{#if item.transactionActivity !== 'transfer'}<span class="rounded bg-blu/10 px-1.5 py-px text-[9px] capitalize text-blu">{readableClass(item.transactionActivity)}</span>{/if}
									</div>
									<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-g5">
										<span>{fullDateTime(item.blockTime.timestamp)}</span>
										<span>Slot {item.slot}</span>
										{#if item.parentProgram}<span class="font-mono">via {shortAddress(item.parentProgram)}</span>{/if}
									</div>
								</div>
								<div class="shrink-0 text-right">
									<div class="text-[11px] font-semibold {item.direction === 'incoming' ? 'text-grn' : item.direction === 'outgoing' ? 'text-red' : 'text-tx'}">{item.direction === 'incoming' ? '+' : item.direction === 'outgoing' ? '−' : ''}{item.amount} {assetLabel(item)}</div>
									<a href={explorerTxUrl(chain, item.transactionSignature)} target="_blank" rel="noopener" class="mt-1 inline-flex rounded p-1 text-g4 transition-colors hover:bg-s7 hover:text-tx" aria-label="Open transfer transaction in explorer"><ExternalLink class="h-3 w-3" /></a>
								</div>
							</div>
						{/each}
					</div>
					{#if error}<div class="mt-2 text-[10px] text-red">{error}</div>{/if}
					{#if result.nextCursor}
						<button type="button" class="btn-secondary mt-2 w-full px-3 py-1.5 text-[10px]" disabled={loadingMore} onclick={() => load(false)}>
							{#if loadingMore}<span class="inline-flex items-center gap-1"><LoaderCircle class="h-3 w-3 animate-spin" /> Loading more…</span>{:else}Load more transfers{/if}
						</button>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}
</section>
