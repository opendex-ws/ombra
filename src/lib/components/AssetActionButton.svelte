<script lang="ts">
	// Compact, always visible asset action: icon + letter (S = Sell, W = Withdraw), full name in the tooltip.
	// Each action is a fixed-width slot. With `available={false}` the slot keeps its size but is
	// invisible, so the buttons of every row line up in the same columns.
	import CircleDollarSign from 'lucide-svelte/icons/circle-dollar-sign';
	import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';

	let {
		kind,
		onclick,
		busy = false,
		available = true,
		testid
	}: {
		kind: 'sell' | 'withdraw';
		onclick?: (e: MouseEvent) => void;
		busy?: boolean;
		available?: boolean;
		testid?: string;
	} = $props();

	const label = $derived(kind === 'sell' ? 'Sell' : 'Withdraw');
	const slot = 'inline-flex h-5 w-9 shrink-0 items-center justify-center gap-0.5 rounded px-1.5 text-[10px] font-semibold';
</script>

{#if available}
	<button
		type="button"
		{onclick}
		disabled={busy}
		title={label}
		aria-label={label}
		data-testid={testid}
		class="{slot} cursor-pointer transition-colors disabled:opacity-50 {kind === 'sell'
			? 'bg-red/10 text-red hover:bg-red/20'
			: 'bg-s7 text-g7 hover:bg-s6 hover:text-tx'}"
	>
		{#if busy}
			<span>...</span>
		{:else}
			{#if kind === 'sell'}<CircleDollarSign size={11} />{:else}<ArrowUpRight size={11} />{/if}
			<span>{kind === 'sell' ? 'S' : 'W'}</span>
		{/if}
	</button>
{:else}
	<span aria-hidden="true" data-slot-placeholder={kind} class="{slot} invisible"></span>
{/if}
