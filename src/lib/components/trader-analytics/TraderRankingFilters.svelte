<script lang="ts">
	import type { Chain, WalletTimeRange } from '$lib/api/types';
	import { WALLET_TIME_RANGE_OPTIONS, type TraderRankingFilterKey, type TraderRankingFilterValues } from './config';
	import Filter from 'lucide-svelte/icons/funnel';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import X from 'lucide-svelte/icons/x';

	let {
		chain,
		timeRange,
		filters,
		onchainchange,
		ontimechange,
		onfilterchange,
		onapply,
		onreset,
		appliedFilterCount
	}: {
		chain: Chain;
		timeRange: WalletTimeRange;
		filters: TraderRankingFilterValues;
		onchainchange: (chain: Chain) => void;
		ontimechange: (timeRange: WalletTimeRange) => void;
		onfilterchange: (key: TraderRankingFilterKey, value?: number) => void;
		onapply: () => void;
		onreset: () => void;
		appliedFilterCount: number;
	} = $props();

	let open = $state(false);
	const chains: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];

	function numberValue(value: string): number | undefined {
		if (value.trim() === '') return undefined;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<div class="flex gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
		{#each chains as option}
			<button
				type="button"
				class="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors {chain === option ? 'bg-wh/10 text-tx' : 'text-g5 hover:text-g9'}"
				onclick={() => onchainchange(option)}
			>
				{option}
			</button>
		{/each}
	</div>

	<div class="flex gap-0.5 rounded-xl border border-bd bg-s4 p-0.5">
		{#each WALLET_TIME_RANGE_OPTIONS as option}
			<button
				type="button"
				class="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors {timeRange === option.value ? 'bg-wh/10 text-tx' : 'text-g5 hover:text-g9'}"
				onclick={() => ontimechange(option.value)}
			>
				{option.label}
			</button>
		{/each}
	</div>

	<div class="relative ml-auto">
		<button
			type="button"
			class="flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors {appliedFilterCount > 0 ? 'border-grn/40 bg-grn/10 text-grn' : open ? 'border-g1 bg-s4 text-tx' : 'border-bd bg-s4 text-g7 hover:border-g1 hover:text-tx'}"
			onclick={() => (open = !open)}
		>
			<Filter class="h-3.5 w-3.5" strokeWidth={1.5} />
			Filters
			{#if appliedFilterCount > 0}
				<span class="rounded-full bg-grn/20 px-1.5 text-[10px] font-bold text-grn">{appliedFilterCount}</span>
			{/if}
		</button>

		{#if open}
			<div class="fixed inset-0 z-[90] md:absolute md:inset-auto md:right-0 md:top-full md:mt-1 md:w-[34rem]">
				<button type="button" class="absolute inset-0 bg-s0/50 md:hidden" aria-label="Close filters" onclick={() => (open = false)}></button>
				<div class="glass-strong absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-bd bg-s2 p-4 md:relative md:inset-auto md:max-h-none md:rounded-2xl md:border md:bg-s5 md:shadow-2xl md:backdrop-blur-xl">
					<div class="mb-4 flex items-center justify-between">
						<div>
							<div class="text-sm font-bold text-tx">Trader filters</div>
							<div class="text-[11px] text-g5">All values are applied by the ranking API.</div>
						</div>
						<button type="button" class="cursor-pointer text-g4 transition-colors hover:text-tx" onclick={() => (open = false)} aria-label="Close">
							<X class="h-4 w-4" />
						</button>
					</div>

					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{@render rangeField('PnL', 'USD', 'pnlUsdMin', 'pnlUsdMax')}
						{@render rangeField('Win rate', '%', 'winRatePctMin', 'winRatePctMax')}
						{@render rangeField('Buys', '', 'buyCountMin', 'buyCountMax')}
						{@render rangeField('Sells', '', 'sellCountMin', 'sellCountMax')}
						{@render rangeField('Latest swap age', 'min', 'latestSwapAgeMinutesMin', 'latestSwapAgeMinutesMax')}
					</div>

					<div class="mt-4 flex items-center gap-2">
						<button
							type="button"
							class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-bd bg-s4 px-3 py-2 text-xs text-g7 transition-colors hover:text-tx"
							onclick={onreset}
						>
							<RotateCcw class="h-3.5 w-3.5" /> Reset
						</button>
						<button
							type="button"
							class="ml-auto cursor-pointer rounded-lg bg-grn px-5 py-2 text-xs font-bold text-s0"
							onclick={() => {
								onapply();
								open = false;
							}}
						>
							Apply filters
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

{#snippet rangeField(label: string, unit: string, minKey: TraderRankingFilterKey, maxKey: TraderRankingFilterKey)}
	<div>
		<div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-g5">{label}</div>
		<div class="flex items-center gap-1.5">
			<div class="flex min-w-0 flex-1 items-center rounded-lg border border-bd bg-s4">
				<input
					type="number"
					placeholder="Min"
					value={filters[minKey] ?? ''}
					class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx outline-none"
					oninput={(event) => onfilterchange(minKey, numberValue(event.currentTarget.value))}
				/>
				{#if unit}<span class="pr-2 text-[10px] text-g4">{unit}</span>{/if}
			</div>
			<span class="text-g3">–</span>
			<div class="flex min-w-0 flex-1 items-center rounded-lg border border-bd bg-s4">
				<input
					type="number"
					placeholder="Max"
					value={filters[maxKey] ?? ''}
					class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx outline-none"
					oninput={(event) => onfilterchange(maxKey, numberValue(event.currentTarget.value))}
				/>
				{#if unit}<span class="pr-2 text-[10px] text-g4">{unit}</span>{/if}
			</div>
		</div>
	</div>
{/snippet}
