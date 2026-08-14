<script lang="ts">
	import type { TokenSnapshot, TokenMarketTimeframeStats } from '$lib/api/types';
	import { formatUsd, formatPercent, formatNumber } from '$lib/utils/format';

	let { token }: { token: TokenSnapshot | null } = $props();

	let statsTimeframe: string = $state('5m');
	let hovered: boolean = $state(false);

	function percentColor(value: string | number | undefined | null): string {
		if (value === undefined || value === null) return 'text-g7';
		const num = typeof value === 'string' ? parseFloat(value) : value;
		if (isNaN(num)) return 'text-g7';
		return num > 0 ? 'text-grn' : num < 0 ? 'text-red' : 'text-g7';
	}

	function getStats(tf: string): TokenMarketTimeframeStats | null {
		if (!token?.stats?.timeframes) return null;
		return (token.stats.timeframes as Record<string, TokenMarketTimeframeStats>)[tf] ?? null;
	}

	function getDiff(tf: string): number | undefined {
		const s = getStats(tf);
		return s?.priceChangePct;
	}

	function buyPct(tf: string): number {
		const s = getStats(tf);
		if (!s) return 50;
		return Math.max(5, Math.min(95, s.buyVolumePct));
	}

	const timeframes = ['5m', '1h', '6h', '24h'];
</script>

{#if token?.stats}
	{@const s = getStats(statsTimeframe)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative border-b border-bd px-2.5 py-1.5"
		onmouseenter={() => (hovered = true)}
		onmouseleave={() => (hovered = false)}
	>
		{#if hovered}
			<div class="absolute inset-0 z-10 flex items-center bg-s5 px-1">
				{#each timeframes as tf}
					{@const diff = getDiff(tf)}
					<button
						class="flex-1 cursor-pointer rounded-md px-1 py-1.5 text-center transition-all {statsTimeframe === tf
							? 'bg-s7 ring-1 ring-bd'
							: 'hover:bg-wh/5'}"
						onclick={() => (statsTimeframe = tf)}
					>
						<div class="text-[11px] font-medium {statsTimeframe === tf ? 'text-tx' : 'text-g5'}">{tf.toUpperCase()}</div>
						<div class="text-xs font-bold {percentColor(diff)}">{formatPercent(diff)}</div>
					</button>
				{/each}
			</div>
		{/if}

		{#if s}
			<div class="grid grid-cols-5 gap-1 text-[10px]">
				<div>
					<div class="text-g4">{statsTimeframe.toUpperCase()} Vol</div>
					<div class="font-semibold text-tx truncate">{formatUsd(s.volumeStr)}</div>
				</div>
				<div>
					<div class="text-grn">Buys <span class="text-tx font-semibold">{s.buys ?? 0}</span></div>
					<div class="font-semibold text-tx truncate">{formatUsd(s.buyVolumeStr)}</div>
				</div>
				<div>
					<div class="text-red">Sells <span class="text-tx font-semibold">{s.sells ?? 0}</span></div>
					<div class="font-semibold text-tx truncate">{formatUsd(s.sellVolumeStr)}</div>
				</div>
				<div>
					<div class="text-g4">Net Vol.</div>
					<div class="font-semibold {percentColor(s.netVolume)} truncate">{formatUsd(s.netVolumeStr)}</div>
				</div>
				<div>
					<div class="text-g4">Fees</div>
					<div class="font-semibold text-tx truncate">{formatUsd(s.fees.totalFeeUsdStr)}</div>
				</div>
			</div>
			<div class="mt-1 flex h-1 overflow-hidden rounded-full bg-s7">
				<div class="bg-grn transition-all duration-300" style="width:{buyPct(statsTimeframe)}%"></div>
				<div class="bg-red transition-all duration-300" style="width:{100 - buyPct(statsTimeframe)}%"></div>
			</div>
		{:else}
			<div class="py-1 text-center text-xs text-g6">No stats</div>
		{/if}
	</div>
{/if}
