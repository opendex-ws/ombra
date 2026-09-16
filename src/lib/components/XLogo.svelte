<script lang="ts">
	import { siX } from 'simple-icons';

	let { class: className = 'h-3.5 w-3.5' }: { class?: string } = $props();
</script>

<svg class={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
	<path d={siX.path} />
</svg>
