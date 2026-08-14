<script lang="ts">
	import Star from 'lucide-svelte/icons/star';

	let { score = 0, max = 30, size = 10 }: { score?: number; max?: number; size?: number } = $props();

	let stars = $derived(Math.min(score / (max / 5), 5));
	let full = $derived(Math.floor(stars));
	let partial = $derived(stars - full);
</script>

<span class="shrink-0 flex items-center gap-px">
	{#each Array(5) as _, ci}
		{#if ci < full}
			<Star {size} fill="var(--t-yel)" color="var(--t-yel)" strokeWidth={0} />
		{:else if ci === full && partial > 0}
			<span class="relative inline-flex">
				<Star {size} fill="var(--t-bd2)" color="var(--t-g3)" strokeWidth={1.5} />
				<span class="absolute inset-0 overflow-hidden" style="width: {partial * 100}%">
					<Star {size} fill="var(--t-yel)" color="var(--t-yel)" strokeWidth={0} />
				</span>
			</span>
		{:else}
			<Star {size} fill="var(--t-bd2)" color="var(--t-g3)" strokeWidth={1.5} />
		{/if}
	{/each}
</span>
