<script lang="ts">
	import { getEntityIcon, getExecutionProgramIcon } from '$lib/utils/entity-icons';
	import Landmark from 'lucide-svelte/icons/landmark';
	import Repeat2 from 'lucide-svelte/icons/repeat-2';
	import Server from 'lucide-svelte/icons/server';
	import Waypoints from 'lucide-svelte/icons/waypoints';

	let {
		label,
		entityType,
		programId,
		class: className = 'h-4 w-4'
	}: {
		label?: string | null;
		entityType?: string | null;
		programId?: string | null;
		class?: string;
	} = $props();

	function initials(value: string): string {
		const words = value
			.replace(/[^a-z0-9]+/gi, ' ')
			.trim()
			.split(/\s+/)
			.filter((word) => word && !/^\d+$/.test(word));
		if (words.length === 0) return '';
		if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
		return `${words[0][0]}${words[1][0]}`.toUpperCase();
	}

	let monogram = $derived(initials(label || ''));
	let brand = $derived(getExecutionProgramIcon(programId) ?? getEntityIcon(label));
	// Execution attribution is part of a live trade row. Its assets are local,
	// tiny, and should be visible in the same render as the trade rather than
	// waiting for the browser's lazy-image queue.
	let isExecutionProgram = $derived(Boolean(programId));
	let Fallback = $derived(
		entityType?.toLowerCase() === 'cex'
			? Landmark
			: entityType?.toLowerCase() === 'bridge'
				? Waypoints
				: entityType?.toLowerCase() === 'dex'
					? Repeat2
					: Server
	);
	let iconName = $derived(brand?.slug || entityType?.toLowerCase() || 'service');
</script>

<span class={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-s7 text-g8 ${brand ? '' : 'p-0.5'} ${className}`} data-funding-icon={iconName} aria-hidden="true">
	{#if brand}
		<img
			src={brand.url}
			alt=""
			class="h-full w-full rounded-full object-contain"
			loading={isExecutionProgram ? 'eager' : 'lazy'}
			decoding={isExecutionProgram ? 'sync' : 'async'}
		/>
	{:else if monogram}
		<span class="font-mono text-[0.5em] font-bold leading-none" aria-hidden="true">{monogram}</span>
	{:else}
		<Fallback class="h-full w-full" />
	{/if}
</span>
