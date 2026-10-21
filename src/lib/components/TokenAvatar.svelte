<script lang="ts">
	import { tokenImage } from '$lib/api/config';

	let {
		chain,
		address,
		symbol = '',
		class: imgClass = 'h-full w-full object-cover',
		fallbackClass = 'bg-s7 text-sm font-bold text-g6',
		letters = 1,
		size,
	}: {
		chain: string;
		address?: string | null;
		symbol?: string | null;
		class?: string;
		fallbackClass?: string;
		letters?: number;
		size?: number;
	} = $props();

	// A 404 leaves the browser's broken-image icon in the frame. Remember the
	// src that failed so a later token in the same slot tries its own image.
	let failedSrc = $state('');
	const src = $derived(address ? tokenImage(chain, address, size) : '');
	const showImage = $derived(!!src && failedSrc !== src);
	const mark = $derived((symbol ?? '').trim().slice(0, letters) || '?');
</script>

{#if showImage}
	<img {src} alt="" class={imgClass} onerror={() => (failedSrc = src)} />
{:else}
	<div class="flex h-full w-full items-center justify-center {fallbackClass}">{mark}</div>
{/if}
