<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChainIcon from './ChainIcon.svelte';
	import { chainBrandArt } from '$lib/utils/chain-brand';

	let {
		chain,
		class: cls = 'h-3.5 w-3.5',
		children
	}: { chain: string; class?: string; children?: Snippet } = $props();

	/**
	 * Two deliberately different treatments:
	 * - On a token avatar the chain is an identity mark, so it uses the brand
	 *   artwork in full colour.
	 * - Everywhere else (inline with text, pickers, the status rail) `ChainIcon`
	 *   stays monochrome `currentColor` so it inherits the surrounding type.
	 *
	 * A chain with no brand asset falls back to the monochrome mark rather than
	 * rendering nothing.
	 */
	const brand = $derived(chainBrandArt(chain));
</script>

<span
	class="absolute -right-1.5 -top-1.5 inline-flex items-center justify-center rounded-full bg-s6 text-tx ring-1 ring-s6 {brand
		? ''
		: 'p-0.5'}"
	title={chain}
>
	{#if brand}
		<img src={brand} alt={chain} class="{cls} rounded-full object-cover" loading="lazy" />
	{:else}
		<ChainIcon {chain} class={cls} />
	{/if}
	{@render children?.()}
</span>
