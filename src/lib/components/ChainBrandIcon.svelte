<script lang="ts">
	import ChainIcon from './ChainIcon.svelte';
	import { chainBrandArt } from '$lib/utils/chain-brand';

	let { chain, class: cls = 'h-4 w-4' }: { chain: string; class?: string } = $props();

	const brand = $derived(chainBrandArt(chain));
</script>

<!--
	The chain as an identity mark, in full colour: token headers and avatars.
	Use `ChainIcon` directly where the mark sits inline with text and should
	inherit its colour instead.
-->
{#if brand}
	<img src={brand} alt={chain} class="{cls} shrink-0 rounded-full object-cover" loading="lazy" />
{:else}
	<ChainIcon {chain} class={cls} />
{/if}
