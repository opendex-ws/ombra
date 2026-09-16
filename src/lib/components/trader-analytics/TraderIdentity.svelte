<script lang="ts">
	import type { Chain, TraderRankItem, WalletLabelSource } from '$lib/api/types';
	import { explorerAddressUrl, shortAddress } from '$lib/utils/format';
	import ChainIcon from '../ChainIcon.svelte';
	import FomoIcon from '../FomoIcon.svelte';
	import WalletIcon from '../WalletIcon.svelte';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Users from 'lucide-svelte/icons/users';

	let {
		item,
		onselect,
		compact = false,
		preferSource = ''
	}: {
		item: TraderRankItem;
		onselect: (item: TraderRankItem) => void;
		compact?: boolean;
		preferSource?: WalletLabelSource | '';
	} = $props();

	const labels = $derived(item.labels ?? []);
	const primary = $derived(
		(preferSource ? labels.find((label) => label.source === preferSource) : undefined) ?? labels[0]
	);
	const brand = $derived(
		((preferSource && labels.some((label) => label.source === preferSource) ? preferSource : null) ??
			labels.find((label) => label.source === 'FOMO')?.source ??
			labels.find((label) => label.source === 'PUMPFUN')?.source ??
			labels.find((label) => label.source === 'KOL')?.source ??
			null) as WalletLabelSource | null
	);
	const extras = $derived(labels.slice(1));
	const photoBox = $derived(compact ? 'h-8 w-8' : 'h-10 w-10');
	const badgeBox = $derived(compact ? 'h-3.5 w-3.5' : 'h-4 w-4');
</script>

{#snippet sourceMark(id: WalletLabelSource, size: string)}
	{#if id === 'FOMO'}
		<FomoIcon class={size} />
	{:else if id === 'PUMPFUN'}
		<img src="/entity-icons/pumpfun.webp" alt="" class="{size} object-cover" />
	{:else}
		<Users class={size} strokeWidth={2.5} />
	{/if}
{/snippet}

<div class="flex min-w-0 items-center gap-2">
	<div class="relative {photoBox} shrink-0">
		<WalletIcon
			address={item.walletAddress}
			photoId={primary?.photoId}
			size={compact ? 32 : 40}
			class="{photoBox} rounded-full"
		/>
		{#if brand}
			<span
				class="absolute -bottom-0.5 -left-0.5 flex {badgeBox} items-center justify-center overflow-hidden rounded-full bg-s6 ring-1 ring-s6"
				title={brand === 'FOMO' ? 'FOMO' : brand === 'PUMPFUN' ? 'Pump.fun' : 'KOL'}
			>
				{@render sourceMark(brand, 'h-full w-full')}
			</span>
		{/if}
	</div>
	<ChainIcon chain={item.chain as Chain} class="h-3.5 w-3.5 shrink-0 text-g6" />
	<div class="min-w-0 flex-1">
		<button
			type="button"
			class="block w-full cursor-pointer truncate text-left font-medium text-tx transition-colors hover:text-grn {compact ? 'text-xs' : 'text-sm'}"
			onclick={() => onselect(item)}
		>
			{primary?.label ?? shortAddress(item.walletAddress)}
		</button>
		{#if primary}
			<div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
				<span class="font-mono text-[10px] font-medium text-g7">{shortAddress(item.walletAddress)}</span>
				{#each extras as extra}
					<span class="rounded bg-blu/20 px-1.5 py-px text-[10px] font-medium text-blu">{extra.label}</span>
				{/each}
			</div>
		{/if}
	</div>
	<a
		href={explorerAddressUrl(item.chain, item.walletAddress)}
		target="_blank"
		rel="noopener"
		class="shrink-0 p-0.5 text-g4 transition-colors hover:text-tx"
		aria-label="Open wallet in explorer"
		onclick={(event) => event.stopPropagation()}
		onkeydown={(event) => event.stopPropagation()}
	>
		<ExternalLink class={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
	</a>
</div>
