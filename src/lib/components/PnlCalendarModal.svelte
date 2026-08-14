<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import X from 'lucide-svelte/icons/x';
	import CalendarDays from 'lucide-svelte/icons/calendar-days';
	import { formatUsd } from '$lib/utils/format';
	import OmbraLogo from './OmbraLogo.svelte';
	import type { components } from '$lib/api/v2.d.ts';

	type ProfitChartPoint = components['schemas']['ProfitChartPoint'];
	type SparklineData = { pnlUsd: number[]; startsAtTimestamp: number; intervalSeconds: number };

	let { show = $bindable(false), data = [], sparkline, title = 'PnL Calendar', numDays = 30 }: {
		show?: boolean;
		data?: ProfitChartPoint[];
		sparkline?: SparklineData;
		title?: string;
		numDays?: number;
	} = $props();

	function close() { show = false; }

	type DayCell = { date: Date; day: number; value: number; hasData: boolean };

	let calendarData = $derived.by(() => {
		const byDate = new Map<string, number>();

		if (sparkline && sparkline.pnlUsd.length > 0) {
			const startMs = sparkline.startsAtTimestamp;
			const intervalMs = sparkline.intervalSeconds * 1000;
			let prev = 0;
			for (let i = 0; i < sparkline.pnlUsd.length; i++) {
				const ts = startMs + i * intervalMs;
				const d = new Date(ts);
				const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
				const dailyPnl = sparkline.pnlUsd[i] - prev;
				byDate.set(key, (byDate.get(key) ?? 0) + dailyPnl);
				prev = sparkline.pnlUsd[i];
			}
		} else if (data && data.length > 0) {
			const sorted = [...data].sort((a, b) => a.dateTimestamp - b.dateTimestamp);
			for (let i = 0; i < sorted.length; i++) {
				const d = new Date(sorted[i].dateTimestamp);
				const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
				const dailyPnl = i === 0 ? sorted[i].valueUsd : sorted[i].valueUsd - sorted[i - 1].valueUsd;
				byDate.set(key, dailyPnl);
			}
		}

		if (byDate.size === 0) return { days: [] as DayCell[], totalPnl: 0, winDays: 0, lossDays: 0, currentStreak: 0, bestStreak: 0, maxWin: 0, maxLoss: 0 };

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

		let totalPnl = 0;
		let winDays = 0;
		let lossDays = 0;
		let maxWin = 0;
		let maxLoss = 0;
		let currentStreak = 0;
		let bestStreak = 0;
		let streak = 0;

		for (const day of days) {
			totalPnl += day.value;
			if (day.value > 0) {
				winDays++;
				streak++;
				if (streak > bestStreak) bestStreak = streak;
				if (day.value > maxWin) maxWin = day.value;
			} else if (day.value < 0) {
				lossDays++;
				streak = 0;
				if (day.value < maxLoss) maxLoss = day.value;
			} else {
				streak = 0;
			}
		}

		for (let i = days.length - 1; i >= 0; i--) {
			if (days[i].value > 0) currentStreak++;
			else break;
		}

		return { days, totalPnl, winDays, lossDays, currentStreak, bestStreak, maxWin, maxLoss };
	});

	let maxAbsValue = $derived(Math.max(1, ...calendarData.days.map(d => Math.abs(d.value))));

	function cellStyle(value: number): string {
		if (value === 0) return '';
		const intensity = Math.min(Math.abs(value) / maxAbsValue, 1);
		const alpha = (0.08 + intensity * 0.32).toFixed(2);
		const color = value > 0 ? 'var(--t-grn)' : 'var(--t-red)';
		return `background: color-mix(in srgb, ${color} ${Math.round(Number(alpha) * 100)}%, transparent)`;
	}

	function dayOfWeek(date: Date): number {
		return (date.getDay() + 6) % 7;
	}

	let progressPct = $derived(calendarData.totalPnl !== 0 && calendarData.winDays + calendarData.lossDays > 0
		? Math.round((calendarData.winDays / (calendarData.winDays + calendarData.lossDays)) * 100)
		: 0);
</script>

{#if show}
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={(e) => { if (e.key === 'Escape') close(); }}>
		<div class="relative mx-4 w-full max-w-3xl rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-bd px-5 py-3">
				<div class="flex items-center gap-2">
					<CalendarDays class="h-4 w-4 text-grn" />
					<h2 class="text-sm font-semibold text-tx">{title}</h2>
					<span class="text-xs text-g5">Last {numDays} days</span>
				</div>
				<button onclick={close} class="cursor-pointer text-g4 transition-colors hover:text-tx"><X class="h-4 w-4" /></button>
			</div>

			<div class="p-4 md:p-5">
				<div class="mb-3">
					<div class="flex items-center justify-between mb-1">
						<span class="text-sm font-bold {calendarData.totalPnl >= 0 ? 'text-grn' : 'text-red'}">{calendarData.totalPnl >= 0 ? '+' : ''}{formatUsd(calendarData.totalPnl)}</span>
					</div>
					<div class="h-2 w-full overflow-hidden rounded-full bg-s1">
						<div class="flex h-full">
							{#if calendarData.winDays > 0}
								<div class="h-full bg-grn transition-all" style="width: {progressPct}%"></div>
							{/if}
							{#if calendarData.lossDays > 0}
								<div class="h-full bg-red transition-all" style="width: {100 - progressPct}%"></div>
							{/if}
						</div>
					</div>
					<div class="mt-1 flex items-center justify-between text-[10px]">
						<span class="text-grn">{calendarData.winDays} / {formatUsd(calendarData.maxWin)}</span>
						<span class="text-red">{calendarData.lossDays} / {formatUsd(calendarData.maxLoss)}</span>
					</div>
				</div>

				<div class="grid grid-cols-7 gap-px text-center text-[10px] font-medium text-g5 mb-1">
					<div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div>
				</div>

				<div class="grid grid-cols-7 gap-1">
					{#if calendarData.days.length > 0}
						{#each Array(dayOfWeek(calendarData.days[0].date)) as _}
							<div></div>
						{/each}
					{/if}
					{#each calendarData.days as day}
						<div class="relative rounded-lg p-1.5 md:p-2 min-h-[52px] md:min-h-[64px] bg-s1 transition-colors" style={cellStyle(day.value)}>
							<div class="text-[9px] text-g5">{day.day}</div>
							{#if day.hasData}
								<div class="mt-0.5 text-[11px] md:text-xs font-bold {day.value >= 0 ? 'text-grn' : 'text-red'}">{day.value >= 0 ? '+' : ''}{formatUsd(day.value)}</div>
							{:else}
								<div class="mt-0.5 text-[11px] text-g3">$0</div>
							{/if}
						</div>
					{/each}
				</div>

				<div class="mt-3 flex flex-wrap items-center gap-2 md:gap-3">
					<span class="rounded-lg border border-bd bg-s1 px-2.5 py-1.5 text-[10px] md:text-[11px] text-g7">Current Streak: <span class="font-bold text-grn">{calendarData.currentStreak} {calendarData.currentStreak === 1 ? 'day' : 'days'}</span></span>
					<span class="rounded-lg border border-bd bg-s1 px-2.5 py-1.5 text-[10px] md:text-[11px] text-g7">Best Streak: <span class="font-bold text-grn">{calendarData.bestStreak} {calendarData.bestStreak === 1 ? 'day' : 'days'}</span></span>
					<div class="ml-auto flex items-center gap-1.5">
						<OmbraLogo class="h-4 w-4" />
						<span class="text-xs font-bold tracking-wider text-g5">OMBRA</span>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
