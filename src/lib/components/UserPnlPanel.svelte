<script lang="ts">
	import { untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import { formatUsd } from '$lib/utils/format';
	import { getRouterInfo } from '$lib/utils/routers';
	import ChainIcon from './ChainIcon.svelte';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import {
		PNL_RANGES,
		chainRows,
		dexRows,
		historyIsPartial,
		launchpadRows,
		seriesPoints,
		sortByImpact,
		totalSeries,
		type PnlRange,
		type UserPnlResponse
	} from '$lib/utils/user-pnl';

	let range = $state<PnlRange>('30d');
	let data = $state<UserPnlResponse | null>(null);
	let loading = $state(true);
	/** 503 while the backend is still building history is a normal state here. */
	let unavailable = $state(false);
	let breakdown = $state<'chain' | 'launchpad' | 'dex'>('launchpad');
	let requestId = 0;

	async function load(next: PnlRange) {
		const id = ++requestId;
		loading = true;
		unavailable = false;
		try {
			const { data: body, response } = await api.GET('/v2/user/pnl', {
				params: { query: { range: next } }
			});
			if (id !== requestId) return;
			if (response.status === 503) {
				unavailable = true;
				data = null;
				return;
			}
			data = body ?? null;
		} catch {
			if (id === requestId) unavailable = true;
		} finally {
			if (id === requestId) loading = false;
		}
	}

	$effect(() => {
		const next = range;
		untrack(() => void load(next));
	});

	const totals = $derived(data?.totals ?? null);
	const points = $derived(totalSeries(data));
	const partial = $derived(historyIsPartial(data));
	const rows = $derived(
		sortByImpact(
			breakdown === 'chain' ? chainRows(data) : breakdown === 'dex' ? dexRows(data) : launchpadRows(data)
		)
	);

	const CHART_W = 320;
	const CHART_H = 48;
	const line = $derived(seriesPoints(points, CHART_W, CHART_H));
	const up = $derived((totals?.totalPnlUsd ?? 0) >= 0);

	function signed(n: number): string {
		return `${n >= 0 ? '+' : ''}${formatUsd(n)}`;
	}
</script>

<div class="rounded-xl border border-bd bg-s1 p-3 md:p-4">
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Realized &amp; open P&amp;L</span>
		<div class="ml-auto flex gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
			{#each PNL_RANGES as r}
				<button
					type="button"
					onclick={() => (range = r.value)}
					class="cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors {range === r.value
						? 'bg-wh/10 text-tx'
						: 'text-g5 hover:text-g9'}"
					aria-pressed={range === r.value}
				>
					{r.label}
				</button>
			{/each}
		</div>
	</div>

	{#if unavailable}
		<div class="flex items-center gap-2 py-6 text-xs text-g5">
			<TriangleAlert class="h-4 w-4 shrink-0 text-yel" />
			P&amp;L is still being built for this account. Check back shortly.
		</div>
	{:else if loading && !data}
		<div class="space-y-2 py-3">
			<div class="skeleton h-8 w-40 rounded"></div>
			<div class="skeleton h-12 rounded"></div>
		</div>
	{:else if data && totals}
		<div class="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
			<div>
				<div class="text-2xl font-bold {up ? 'text-grn' : 'text-red'}">{signed(totals.totalPnlUsd)}</div>
				<div class="text-[10px] text-g5">Total</div>
			</div>
			<!-- Open positions keep their lifetime P&L, so the split matters: a good
			     total can be one unrealised bag rather than trading well. -->
			<div class="rounded-lg bg-s2 px-2.5 py-1.5">
				<div class="text-sm font-bold {totals.closedPnlUsd >= 0 ? 'text-grn' : 'text-red'}">
					{signed(totals.closedPnlUsd)}
				</div>
				<div class="text-[10px] text-g5">Closed</div>
			</div>
			<div class="rounded-lg bg-s2 px-2.5 py-1.5">
				<div class="text-sm font-bold {totals.activePnlUsd >= 0 ? 'text-grn' : 'text-red'}">
					{signed(totals.activePnlUsd)}
				</div>
				<div class="text-[10px] text-g5">Open</div>
			</div>
		</div>

		{#if line}
			<svg
				class="mt-3 w-full"
				viewBox="0 0 {CHART_W} {CHART_H}"
				preserveAspectRatio="none"
				height={CHART_H}
				aria-hidden="true"
			>
				<polyline
					points={line}
					fill="none"
					stroke={up ? 'var(--t-grn)' : 'var(--t-red)'}
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
		{/if}

		{#if partial}
			<div class="mt-1.5 flex items-center gap-1.5 text-[10px] text-g5">
				<TriangleAlert class="h-3 w-3 shrink-0 text-yel" />
				Open-position history is incomplete for this range, so the line has gaps.
			</div>
		{/if}

		{#if rows.length > 0}
			<div class="mt-3 flex gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
				{#each [['launchpad', 'Launchpad'], ['dex', 'DEX'], ['chain', 'Chain']] as [value, label]}
					<button
						type="button"
						onclick={() => (breakdown = value as typeof breakdown)}
						class="flex-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors {breakdown ===
						value
							? 'bg-wh/10 text-tx'
							: 'text-g5 hover:text-g9'}"
						aria-pressed={breakdown === value}
					>
						{label}
					</button>
				{/each}
			</div>
			<div class="mt-1.5 space-y-px overflow-hidden rounded-lg">
				{#each rows as row (row.key)}
					{@const info = row.platform ? getRouterInfo(row.platform) : null}
					<div class="flex items-center gap-2 bg-s2 px-2.5 py-1.5">
						{#if info?.icon}
							<img src={info.icon} alt="" class="h-4 w-4 shrink-0 rounded-full" loading="lazy" />
						{:else}
							<ChainIcon chain={row.label} class="h-4 w-4 shrink-0 text-g6" />
						{/if}
						<span class="min-w-0 flex-1 truncate text-[11px] text-g8">{info?.name ?? row.label}</span>
						<span class="shrink-0 text-[11px] font-semibold tabular-nums {row.metrics.totalPnlUsd >= 0 ? 'text-grn' : 'text-red'}">
							{signed(row.metrics.totalPnlUsd)}
						</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if loading}
			<div class="mt-2 flex justify-center"><LoaderCircle class="h-3 w-3 animate-spin text-g5" /></div>
		{/if}
	{:else}
		<div class="py-6 text-center text-xs text-g5">No P&amp;L recorded yet.</div>
	{/if}
</div>
