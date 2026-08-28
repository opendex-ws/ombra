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
	<div class="flex flex-1 flex-col gap-1 px-2 py-1.5">
		<div class="flex items-center justify-between gap-1">
			<button
				onclick={() => {
					if (target.targetKind === 'TAKE_PROFIT') onupdate({ ...target, targetKind: 'STOP_LOSS', mode: 'NORMAL' });
					else if (target.mode === 'NORMAL') onupdate({ ...target, mode: 'TRAILING' });
					else onupdate({ ...target, targetKind: 'TAKE_PROFIT', mode: 'NORMAL' });
				}}
				class="cursor-pointer rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide transition-colors {target.targetKind === 'STOP_LOSS' ? 'bg-red/20 text-red' : 'bg-grn/20 text-grn'}"
				title="Click to change target type"
			>
				{target.targetKind === 'TAKE_PROFIT' ? 'TP' : target.mode === 'TRAILING' ? 'TRAIL SL' : 'SL'}
			</button>
			<!-- The type select doubles as the field label, which removes a whole row. -->
			<select
				value={target.kind}
				onchange={(e) => onupdate({ ...target, kind: (e.target as HTMLSelectElement).value as SellTargetKind })}
				class="min-w-0 flex-1 cursor-pointer rounded border-none bg-transparent p-0 text-right text-[10px] font-medium text-g6 outline-none"
				style="color-scheme:dark"
			>
				<option class="bg-s5 text-tx" value="MULTIPLE">Multiplier</option>
				<option class="bg-s5 text-tx" value="PERCENTAGE">% Change</option>
				<option class="bg-s5 text-tx" value="MARKETCAP">Market Cap</option>
				<option class="bg-s5 text-tx" value="USD">Price USD</option>
			</select>
			<button
				onclick={onremove}
				aria-label="Remove target"
				class="cursor-pointer rounded p-0.5 text-g4 opacity-0 transition-all hover:bg-s7 hover:text-red group-hover:opacity-100 focus:opacity-100"
				title="Remove target"
			>
				<X class="h-3 w-3" />
			</button>
		</div>
		<div class="flex items-center gap-1">
			<input
				type="text"
				inputmode="decimal"
				value={target.triggerValue}
				oninput={(e) => onupdate({ ...target, triggerValue: (e.target as HTMLInputElement).value })}
				placeholder={target.kind === 'MULTIPLE' ? '2x' : target.kind === 'PERCENTAGE' ? '100%' : '$0.00'}
				aria-invalid={!!triggerError}
				title={triggerError}
				class="min-w-0 flex-1 rounded-md border bg-s4 px-1.5 py-0.5 text-sm font-semibold text-tx outline-none transition-colors focus:border-bd3 {triggerError ? 'border-red/40' : 'border-bd'} {target.targetKind === 'STOP_LOSS' ? 'placeholder-red/20' : 'placeholder-grn/20'}"
			/>
			<div class="relative w-14 shrink-0">
				<input
					type="text"
					inputmode="decimal"
					value={target.sellPercent}
					oninput={(e) => onupdate({ ...target, sellPercent: (e.target as HTMLInputElement).value })}
					placeholder={target.targetKind === 'STOP_LOSS' ? '100' : '50'}
					aria-invalid={!!sellError}
					title={sellError}
					aria-label="Sell percent"
					class="w-full rounded-md border bg-s4 py-0.5 pl-1.5 pr-4 text-sm font-semibold text-tx outline-none transition-colors focus:border-bd3 {sellError ? 'border-red/40' : 'border-bd'}"
				/>
				<span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-g5">%</span>
			</div>
		</div>
	</div>
</div>
