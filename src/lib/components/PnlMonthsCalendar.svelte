<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import { formatUsd } from '$lib/utils/format';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';

	type SparklineData = { pnlUsd: number[]; startsAtTimestamp: number; intervalSeconds: number };

	let { sparkline, numDays = 90, actions, single = false }: { sparkline: SparklineData; numDays?: number; actions?: Snippet; single?: boolean } = $props();

	let mobileMonthIdx = $state(-1);

	type DayCell = { date: Date; day: number; value: number; hasData: boolean };
	type MonthGroup = { key: string; label: string; lead: number; cells: DayCell[] };

	const calendar = $derived.by(() => {
		const byDate = new Map<string, number>();
		if (sparkline?.pnlUsd?.length) {
			const startMs = sparkline.startsAtTimestamp;
			const intervalMs = sparkline.intervalSeconds * 1000;
			let prev = 0;
			for (let i = 0; i < sparkline.pnlUsd.length; i++) {
				const d = new Date(startMs + i * intervalMs);
				const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
				byDate.set(key, (byDate.get(key) ?? 0) + (sparkline.pnlUsd[i] - prev));
				prev = sparkline.pnlUsd[i];
			}
		}

		const now = new Date();
		const days: DayCell[] = [];
		for (let i = numDays - 1; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			d.setHours(0, 0, 0, 0);
			const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
			const value = byDate.get(key) ?? 0;
			days.push({ date: d, day: d.getDate(), value, hasData: byDate.has(key) });
		}

		const months: MonthGroup[] = [];
		for (const d of days) {
			const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
			let g = months.length > 0 && months[months.length - 1].key === key ? months[months.length - 1] : null;
			if (!g) {
				g = { key, label: d.date.toLocaleString('en', { month: 'long', year: 'numeric' }), lead: (d.date.getDay() + 6) % 7, cells: [] };
				months.push(g);
			}
			g.cells.push(d);
		}

		let totalPnl = 0;
		let winDays = 0;
		let lossDays = 0;
		let maxAbs = 1;
		for (const d of days) {
			totalPnl += d.value;
			if (d.value > 0) winDays++;
			else if (d.value < 0) lossDays++;
			if (Math.abs(d.value) > maxAbs) maxAbs = Math.abs(d.value);
		}
		return { months, totalPnl, winDays, lossDays, maxAbs };
	});

	function cellStyle(value: number): string {
		if (value === 0) return '';
		const intensity = Math.min(Math.abs(value) / calendar.maxAbs, 1);
		const pct = Math.round((0.1 + intensity * 0.45) * 100);
		const color = value > 0 ? 'var(--t-grn)' : 'var(--t-red)';
		return `background: color-mix(in srgb, ${color} ${pct}%, transparent)`;
	}

	function tooltip(d: DayCell): string {
		const date = d.date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
		return d.hasData ? `${date}: ${d.value >= 0 ? '+' : ''}${formatUsd(d.value)}` : `${date}: no activity`;
	}

	const currentMobileIdx = $derived(
		mobileMonthIdx < 0 || mobileMonthIdx >= calendar.months.length
			? calendar.months.length - 1
			: mobileMonthIdx
	);
</script>

<div class="rounded-xl border border-bd bg-s1 p-3">
	<div class="mb-2 flex items-center justify-between">
		<span class="text-[9px] font-medium uppercase tracking-wider text-g5">Daily PnL &middot; last {numDays} days</span>
		<div class="flex items-center gap-2 text-[10px]">
			<span class="text-grn">{calendar.winDays}W</span>
			<span class="text-red">{calendar.lossDays}L</span>
			<span class="text-xs font-bold {calendar.totalPnl >= 0 ? 'text-grn' : 'text-red'}">{calendar.totalPnl >= 0 ? '+' : ''}{formatUsd(calendar.totalPnl)}</span>
			{#if actions}{@render actions()}{/if}
		</div>
	</div>
	{#if getIsDesktop() && !single}
		<div class="grid gap-3" style="grid-template-columns: repeat({Math.min(calendar.months.length, 4)}, minmax(0, 1fr))">
			{#each calendar.months as month (month.key)}
				<div>
					<div class="mb-1 text-center text-[9px] font-medium text-g6">{month.label}</div>
					{@render monthGrid(month, 'text-[8px]')}
				</div>
			{/each}
		</div>
	{:else if calendar.months.length > 0}
		{@const month = calendar.months[currentMobileIdx]}
		<div class="mx-auto w-full max-w-[24rem]">
		<div class="mb-1.5 flex items-center justify-between">
			<button
				type="button"
				class="cursor-pointer rounded-md p-1 text-g5 transition-colors hover:text-tx disabled:opacity-30"
				disabled={currentMobileIdx === 0}
				onclick={() => (mobileMonthIdx = currentMobileIdx - 1)}
				aria-label="Previous month"
			>
				<ChevronLeft class="h-4 w-4" />
			</button>
			<span class="text-[11px] font-medium text-g8">{month.label}</span>
			<button
				type="button"
				class="cursor-pointer rounded-md p-1 text-g5 transition-colors hover:text-tx disabled:opacity-30"
				disabled={currentMobileIdx === calendar.months.length - 1}
				onclick={() => (mobileMonthIdx = currentMobileIdx + 1)}
				aria-label="Next month"
			>
				<ChevronRight class="h-4 w-4" />
			</button>
		</div>
		{@render monthGrid(month, 'text-[10px]', true)}
		</div>
	{/if}
</div>

{#snippet monthGrid(month: MonthGroup, textSize: string, showValue: boolean = false)}
	<div class="grid grid-cols-7 gap-0.5">
		{#each Array(month.lead) as _}
			<div></div>
		{/each}
		{#each month.cells as d}
			<div
				class="flex aspect-square flex-col items-center justify-center rounded-[3px] bg-s4/40 {textSize}"
				style={cellStyle(d.value)}
				title={tooltip(d)}
			>
				<span class="{d.value !== 0 ? 'font-semibold text-tx' : 'text-g4'}">{d.day}</span>
				{#if showValue && d.value !== 0}
					<span class="text-[8px] font-bold leading-tight {d.value > 0 ? 'text-grn' : 'text-red'}">{d.value > 0 ? '+' : ''}{formatUsd(d.value)}</span>
				{/if}
			</div>
		{/each}
	</div>
{/snippet}
