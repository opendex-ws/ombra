<script lang="ts">
	let { chain, class: cls = 'h-3.5 w-3.5' }: { chain: string; class?: string } = $props();

	const c = $derived((chain ?? '').toUpperCase());
</script>

{#if c === 'SOL'}
	<svg class={cls} viewBox="0 0 101 88" fill="currentColor" aria-label="Solana">
		<path d="M100.48 69.38 83.81 86.8a2.6 2.6 0 0 1-1.9.8H1.94a.98.98 0 0 1-.72-1.63l16.69-17.42a2.6 2.6 0 0 1 1.88-.8h79.03a.98.98 0 0 1 .72 1.63ZM83.81 34.3a2.6 2.6 0 0 0-1.9-.8H1.94a.98.98 0 0 0-.72 1.63l16.69 17.42a2.6 2.6 0 0 0 1.88.8h79.03a.98.98 0 0 0 .72-1.63L83.81 34.3ZM1.94 21.79h79.03c.71 0 1.4-.29 1.9-.8L99.53 3.57a.98.98 0 0 0-.72-1.63H19.77c-.71 0-1.4.28-1.9.8L1.19 20.16a.98.98 0 0 0 .75 1.63Z" />
	</svg>
{:else if c === 'ETH'}
	<svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-label="Ethereum">
		<path d="M12 2 4.8 13 12 9.3 19.2 13 12 2Z" />
		<path d="M12 15.1 4.8 13.4 12 22 19.2 13.4 12 15.1Z" />
	</svg>
{:else if c === 'BASE'}
	<svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-label="Base">
		<rect x="3.5" y="3.5" width="17" height="17" rx="5" />
		<path d="M8.6 12h6.6" stroke-linecap="round" />
	</svg>
{:else if c === 'BSC'}
	<svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-label="BNB Chain">
		<path d="M12 3.2 8.5 6.7 10.3 8.5 12 6.8 13.7 8.5 15.5 6.7 12 3.2Z" />
		<path d="M12 15.5 10.3 17.3 12 19 13.7 17.3 12 15.5Z" />
		<path d="M6.3 9.4 4.5 11.2 6.3 13 8.1 11.2 6.3 9.4Z" />
		<path d="M17.7 9.4 15.9 11.2 17.7 13 19.5 11.2 17.7 9.4Z" />
		<path d="M12 9 9.2 11.8 12 14.6 14.8 11.8 12 9Z" />
	</svg>
{:else}
	<span class={cls} style="display:inline-flex;align-items:center;font-size:0.7em;font-weight:600;">{c}</span>
{/if}
