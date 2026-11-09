<script lang="ts">
	import { poolSafetyView, type PoolAssessment } from '$lib/utils/pool-safety';

	let { assessment = null }: { assessment?: PoolAssessment | null } = $props();
	let open = $state(false);
	let view = $derived(poolSafetyView(assessment));
	// Hooks and their component review exist only for Uniswap V4 pools. Every
	// other RH venue has no hook, so the badge would only ever say "unknown".
	let isV4 = $derived(assessment?.pool?.protocol === 'UNISWAP_V4');
</script>

{#if isV4}
<details class="relative inline-block max-w-full text-left" bind:open>
	<summary
		class="inline-flex min-h-6 cursor-pointer list-none flex-wrap items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium hover:bg-s7 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bd/40 {view.chipClass}"
		title={view.title}
		aria-label={view.title}
		onclick={(event) => event.stopPropagation()}
	>
		<span class="h-1.5 w-1.5 shrink-0 rounded-full {view.dotClass}" aria-hidden="true"></span>
		<span>{view.label}</span>
		<span class="text-g6">{view.hookLabel}</span>
	</summary>
	{#if open}
		<div class="absolute left-0 top-full z-50 mt-1 max-h-[60dvh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-bd bg-s5 p-3 text-xs text-tx shadow-2xl">
			<dl class="space-y-2">
				{#each view.details as detail (detail.label)}
					<div>
						<dt class="text-[10px] font-medium uppercase tracking-wider text-g5">{detail.label}</dt>
						<dd class="break-all leading-relaxed">{detail.value}</dd>
					</div>
				{/each}
			</dl>
		</div>
	{/if}
</details>
{/if}
