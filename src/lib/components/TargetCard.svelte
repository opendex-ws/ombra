<script lang="ts">
	import type { SellTargetRow, SellTargetKind } from '$lib/stores/trade.svelte';
	import X from 'lucide-svelte/icons/x';

	let { target, triggerError, sellError, onupdate, onremove }: {
		target: SellTargetRow;
		triggerError?: string;
		sellError?: string;
		onupdate: (target: SellTargetRow) => void;
		onremove: () => void;
	} = $props();
</script>

<div class="group relative flex h-full flex-col overflow-hidden rounded-lg border bg-s1 {target.targetKind === 'STOP_LOSS' ? 'border-red/20' : 'border-grn/20'}">
	<div class="flex flex-1 flex-col justify-between px-2.5 py-2">
		<div class="mb-1.5 flex items-center justify-between">
			<button
				onclick={() => {
					if (target.targetKind === 'TAKE_PROFIT') onupdate({ ...target, targetKind: 'STOP_LOSS', mode: 'NORMAL' });
					else if (target.mode === 'NORMAL') onupdate({ ...target, mode: 'TRAILING' });
					else onupdate({ ...target, targetKind: 'TAKE_PROFIT', mode: 'NORMAL' });
				}}
				class="cursor-pointer rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide transition-colors {target.targetKind === 'STOP_LOSS' ? 'bg-red/20 text-red' : 'bg-grn/20 text-grn'}"
				title="Click to change target type"
			>
				{target.targetKind === 'TAKE_PROFIT' ? 'TAKE PROFIT' : target.mode === 'TRAILING' ? 'TRAILING SL' : 'STOP LOSS'}
			</button>
			<button
				onclick={onremove}
				aria-label="Remove target"
				class="cursor-pointer rounded p-0.5 text-g4 opacity-0 transition-all hover:bg-s7 hover:text-red group-hover:opacity-100 focus:opacity-100"
				title="Remove target"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
		<div class="flex items-end gap-2">
			<div class="flex-1">
				<div class="mb-0.5 flex items-center gap-1">
					<select
						value={target.kind}
						onchange={(e) => onupdate({ ...target, kind: (e.target as HTMLSelectElement).value as SellTargetKind })}
						class="cursor-pointer rounded border-none bg-transparent p-0 text-[10px] font-medium text-g6 outline-none" style="color-scheme:dark"
					>
						<option class="bg-s5 text-tx" value="MULTIPLE">Multiplier</option>
						<option class="bg-s5 text-tx" value="PERCENTAGE">% Change</option>
						<option class="bg-s5 text-tx" value="MARKETCAP">Market Cap</option>
						<option class="bg-s5 text-tx" value="USD">Price USD</option>
					</select>
				</div>
				<input
					type="text"
					inputmode="decimal"
					value={target.triggerValue}
					oninput={(e) => onupdate({ ...target, triggerValue: (e.target as HTMLInputElement).value })}
					placeholder={target.kind === 'MULTIPLE' ? '2x' : target.kind === 'PERCENTAGE' ? '100%' : '$0.00'}
					aria-invalid={!!triggerError}
					class="w-full rounded-md border bg-s4 px-2 py-1 text-sm font-semibold text-tx outline-none transition-colors focus:border-bd3 {triggerError ? 'border-red/40' : 'border-bd'} {target.targetKind === 'STOP_LOSS' ? 'placeholder-red/20' : 'placeholder-grn/20'}"
				/>
				{#if triggerError}<p class="mt-0.5 text-[9px] text-red">{triggerError}</p>{/if}
			</div>
			<div class="w-16">
				<div class="mb-0.5 text-[10px] font-medium text-g6">Sell %</div>
				<input
					type="text"
					inputmode="decimal"
					value={target.sellPercent}
					oninput={(e) => onupdate({ ...target, sellPercent: (e.target as HTMLInputElement).value })}
					placeholder={target.targetKind === 'STOP_LOSS' ? '100' : '50'}
					aria-invalid={!!sellError}
					class="w-full rounded-md border bg-s4 px-2 py-1 text-sm font-semibold text-tx outline-none transition-colors focus:border-bd3 {sellError ? 'border-red/40' : 'border-bd'}"
				/>
				{#if sellError}<p class="mt-0.5 text-[9px] text-red">{sellError}</p>{/if}
			</div>
		</div>
	</div>
</div>
