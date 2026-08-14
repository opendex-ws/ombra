<script lang="ts">
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 28" class={className}>
	<defs>
		<linearGradient id="ombra-g" x1="0" y1="0" x2="34" y2="28" gradientUnits="userSpaceOnUse">
			<stop offset="0%" stop-color="var(--t-grn)" />
			<stop offset="100%" stop-color="var(--t-grn-dark)" />
		</linearGradient>
	</defs>
	<path fill-rule="evenodd" fill="url(#ombra-g)" d="
		M13,2.2 A12,12 0 1,1 13,26.2 A12,12 0 1,1 13,2.2 Z
		M20.2,1 A12,12 0 1,0 20.2,25 A12,12 0 1,0 20.2,1 Z
	"/>
</svg>
