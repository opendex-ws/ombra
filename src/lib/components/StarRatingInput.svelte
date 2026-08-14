<script lang="ts">
	import Star from 'lucide-svelte/icons/star';

	let { value = 0, size = 12, onselect }: { value?: number; size?: number; onselect?: (star: number) => void } = $props();
</script>

{#each [1, 2, 3, 4, 5] as s}
	<button onclick={() => onselect?.(s)} class="cursor-pointer">
		<Star {size} fill={s <= value ? 'var(--t-yel)' : 'var(--t-bd2)'} color={s <= value ? 'var(--t-yel)' : 'var(--t-g3)'} strokeWidth={s <= value ? 0 : 1.5} />
	</button>
{/each}
