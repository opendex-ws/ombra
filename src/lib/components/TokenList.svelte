<script lang="ts">
	import type { ScannerItem } from '$lib/api/types';
	import type { RowFlashType } from '$lib/utils/scanner-ws';
	import TokenListItem from './TokenListItem.svelte';
	import Search from 'lucide-svelte/icons/search';

	let { tokens = [], loading = false, selectedAddress = '', rowFlashes = new Map(), onselect }: {
		tokens: ScannerItem[];
		loading: boolean;
		selectedAddress?: string;
		rowFlashes?: Map<string, RowFlashType>;
		onselect: (token: ScannerItem) => void;
	} = $props();
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	{#if loading}
		<div class="space-y-0.5 p-2">
			{#each Array(12) as _, i}
				<div class="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
					<div class="skeleton h-8 w-8 shrink-0 rounded-full"></div>
					<div class="flex-1 space-y-1.5">
						<div class="skeleton h-3 w-20 rounded"></div>
						<div class="skeleton h-2.5 w-32 rounded"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if tokens.length === 0}
		<div class="flex h-32 flex-col items-center justify-center gap-2 text-center">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-s4 ring-1 ring-bd">
				<Search class="h-5 w-5 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-xs text-g5">No tokens found</span>
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto">
			{#each tokens as token (token.pairAddress)}
				<TokenListItem
					{token}
					isSelected={selectedAddress === token.tokenAddress}
					rowFlash={rowFlashes.get(token.pairAddress)}
					onselect={() => onselect(token)}
				/>
			{/each}
		</div>
	{/if}
</div>
