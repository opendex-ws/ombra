<script lang="ts">
	import { isUsd } from '$lib/stores/currency.svelte';
	import { fmtValNum, fmtPriceNum, fmtPriceNumHtml } from '$lib/utils/format';
	import ChainIcon from './ChainIcon.svelte';

	let {
		usd,
		native,
		chain,
		mode = 'value',
		iconClass = 'h-3 w-3',
		class: cls = ''
	}: {
		usd: string | number | undefined | null;
		native: string | number | undefined | null;
		chain?: string;
		mode?: 'value' | 'price' | 'priceHtml';
		iconClass?: string;
		class?: string;
	} = $props();

	const text = $derived(
		mode === 'price' ? fmtPriceNum(usd, native)
		: mode === 'priceHtml' ? fmtPriceNumHtml(usd, native)
		: fmtValNum(usd, native)
	);
</script>

<span class="inline-flex items-center gap-1 {cls}">{#if mode === 'priceHtml'}{@html text}{:else}{text}{/if}{#if !isUsd()}<ChainIcon chain={chain ?? 'SOL'} class={iconClass} />{/if}</span>
