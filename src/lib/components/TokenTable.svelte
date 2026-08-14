<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { ScannerItem } from '$lib/api/types';
	import type { RowFlashType } from '$lib/utils/scanner-ws';
	import TokenRow from './TokenRow.svelte';
	import Inbox from 'lucide-svelte/icons/inbox';
	import { portal } from '$lib/actions/portal';
	import { afterNavigate } from '$app/navigation';

	type SortCol = { rankBy: string; label: string } | null;

	let { tokens = [], loading = false, rankBy = '', orderBy = '', rankOffset = 0, rowFlashes = new Map(), onsort, onselect }: {
		tokens: ScannerItem[];
		loading: boolean;
		rankBy?: string;
		orderBy?: string;
		rankOffset?: number;
		rowFlashes?: Map<string, RowFlashType>;
		onsort?: (rankBy: string, orderBy: string) => void;
		onselect?: (token: ScannerItem) => void;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let compact = $state(false);
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (!containerEl) return;
		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				compact = entry.contentRect.width < 1500;
			}
		});
		resizeObserver.observe(containerEl);
		return () => resizeObserver?.disconnect();
	});

	let scrollEl: HTMLDivElement | undefined = $state();
	let visibleRows = $state(new Set<string>());
	let observer: IntersectionObserver | null = null;
	let rowEls = new Map<string, HTMLElement>();

	function setupObserver() {
		observer?.disconnect();
		if (!scrollEl) return;
		observer = new IntersectionObserver((entries) => {
			const next = new Set(visibleRows);
			for (const e of entries) {
				const key = (e.target as HTMLElement).dataset.pair;
				if (!key) continue;
				if (e.isIntersecting) next.add(key);
				else next.delete(key);
			}
			visibleRows = next;
		}, { root: scrollEl, rootMargin: '200px 0px' });
		for (const el of rowEls.values()) observer.observe(el);
	}

	$effect(() => {
		if (scrollEl && tokens.length > 0 && !loading) setupObserver();
	});

	function observeRow(el: HTMLElement) {
		const key = el.dataset.pair;
		if (!key) return;
		rowEls.set(key, el);
		observer?.observe(el);
		return {
			destroy() {
				rowEls.delete(key);
				observer?.unobserve(el);
			}
		};
	}

	onDestroy(() => observer?.disconnect());

	// Pop-out: while a row is hovered, lift a clone that stays pinned in place
	// (with fresh data) while the real list keeps reordering underneath.
	let pinnedKey = $state<string | null>(null);
	let pinnedRank = $state(0);
	let pinRect = $state<{ left: number; top: number; width: number; height: number } | null>(null);
	const pinnedToken = $derived(pinnedKey ? tokens.find(t => t.pairAddress === pinnedKey) ?? null : null);

	const PIN_HOVER_DELAY = 200;
	let pinHoverTimer: ReturnType<typeof setTimeout> | null = null;
	let scheduledKey: string | null = null;
	function clearPinTimer() {
		if (pinHoverTimer) { clearTimeout(pinHoverTimer); pinHoverTimer = null; }
		scheduledKey = null;
	}
	// Pop out only when the cursor actually MOVES onto/over a row for 200ms.
	// Driven by mousemove (real motion) — not mouseenter — so that after a scroll
	// the row that happens to land under a stationary cursor is NOT portaled.
	function scheduledPin(e: MouseEvent, key: string, rank: number) {
		if (pinnedKey === key || scheduledKey === key) return;
		const host = e.currentTarget as HTMLElement;
		clearPinTimer();
		scheduledKey = key;
		pinHoverTimer = setTimeout(() => {
			pinHoverTimer = null;
			scheduledKey = null;
			const r = host.getBoundingClientRect();
			pinnedKey = key;
			pinnedRank = rank;
			pinRect = { left: r.left, top: r.top, width: r.width, height: r.height };
		}, PIN_HOVER_DELAY);
	}
	function cancelPin() {
		clearPinTimer();
	}
	function unpinRow() {
		clearPinTimer();
		pinnedKey = null;
		pinRect = null;
	}
	onDestroy(() => clearPinTimer());
	afterNavigate(() => unpinRow());
	// Wheeling over the pinned overlay must still scroll the list underneath:
	// forward the delta to the scroll container and drop the pin so subsequent
	// wheel events hit the list directly.
	function onPinWheel(e: WheelEvent) {
		if (scrollEl) scrollEl.scrollTop += e.deltaY;
		unpinRow();
	}
	// Any scroll (or resize) cancels a pending pin and closes an open one.
	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		const close = () => unpinRow();
		el.addEventListener('scroll', close, { passive: true });
		window.addEventListener('resize', close);
		return () => {
			el.removeEventListener('scroll', close);
			window.removeEventListener('resize', close);
		};
	});

	type ColDef = { key: string; label: string; align: string; compact?: boolean };

	const allCols: ColDef[] = [
		{ key: '', label: '#', align: 'text-center' },
		{ key: '', label: 'Token', align: 'pl-1' },
		{ key: 'age', label: 'Age', align: 'text-center' },
		{ key: 'mcap', label: 'MCap', align: 'text-right' },
		{ key: 'liquidity', label: 'Liq', align: 'text-right', compact: false },
		{ key: '', label: 'Price', align: 'text-right' },
		{ key: 'volume', label: 'Vol / Txns', align: 'text-right' },
		{ key: '', label: 'Fees', align: 'text-right', compact: false },
		{ key: '', label: 'Holders', align: 'text-right' },
		{ key: 'price5M', label: '5M', align: 'text-right' },
		{ key: 'price1H', label: '1H', align: 'text-right' },
		{ key: 'price6H', label: '6H', align: 'text-right', compact: false },
		{ key: 'price24H', label: '24H', align: 'text-right', compact: false },
		{ key: '', label: 'Top10', align: 'text-right', compact: false },
		{ key: '', label: 'Dev / Snp / Bnd', align: 'text-center' },
		{ key: '', label: '', align: 'text-center' },
		{ key: '', label: '', align: 'text-center' },
	];

	let sortableCols = $derived(compact ? allCols.filter(c => c.compact !== false) : allCols);

	function handleSort(key: string) {
		if (!key || !onsort) return;
		if (rankBy === key) {
			onsort(key, orderBy === 'desc' ? 'asc' : 'desc');
		} else {
			onsort(key, 'desc');
		}
	}

	const colsFull = '0.4fr 2.8fr 0.6fr 1.4fr 1.2fr 1.2fr 1.4fr 1.0fr 0.8fr 1.2fr 1.2fr 1.2fr 1.2fr 0.9fr 1.4fr 1.4fr 0.7fr';
	const colsCompact = '0.4fr 2.8fr 0.6fr 1.4fr 1.2fr 1.4fr 0.8fr 1.2fr 1.2fr 1.4fr 1.4fr 0.7fr';
	let cols = $derived(compact ? colsCompact : colsFull);
</script>

<div class="flex flex-col overflow-hidden rounded-xl border border-bd bg-s1" bind:this={containerEl}>
	<div class="mobile-scroll-x">
	<div class="grid h-11 shrink-0 items-center gap-x-2 border-b border-bd bg-s0 px-4 text-xs font-semibold uppercase tracking-wider text-g6" style:grid-template-columns={cols}>
		{#each sortableCols as col}
			{#if col.key && onsort}
				<div
					class="{col.align} cursor-pointer select-none transition-colors hover:text-tx {rankBy === col.key ? 'text-grn' : ''}"
					onclick={() => handleSort(col.key)}
					onkeydown={(e) => e.key === 'Enter' && handleSort(col.key)}
					role="button"
					tabindex="0"
				>
					{col.label}{#if rankBy === col.key}<span class="ml-0.5 text-[9px]">{orderBy === 'asc' ? '▲' : '▼'}</span>{/if}
				</div>
			{:else}
				<div class={col.align}>{col.label}</div>
			{/if}
		{/each}
	</div>
	</div>

	<div class="flex-1 overflow-auto" bind:this={scrollEl}>
		{#if loading}
			{#each Array(12) as _, i}
				<div class="grid h-[72px] items-center gap-x-2 border-b border-bd/40 px-4" style:grid-template-columns={cols}>
					<div></div>
					<div class="flex items-center gap-2">
						<div class="skeleton h-9 w-9 rounded-full"></div>
						<div class="space-y-1.5">
							<div class="skeleton h-3.5 w-20 rounded"></div>
							<div class="skeleton h-2.5 w-14 rounded"></div>
						</div>
					</div>
					{#each Array(sortableCols.length - 2) as __}
						<div class="skeleton h-3.5 w-full rounded"></div>
					{/each}
				</div>
			{/each}
		{:else if tokens.length === 0}
			<div class="flex h-40 flex-col items-center justify-center gap-2">
				<Inbox class="h-9 w-8 text-bd2" strokeWidth={1.5} />
				<span class="text-sm text-g6">No tokens found</span>
			</div>
		{:else}
			{#each tokens as token, i (token.pairAddress)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					data-pair={token.pairAddress}
					use:observeRow
					onmousemove={(e) => scheduledPin(e, token.pairAddress, rankOffset + i + 1)}
					onmouseleave={cancelPin}
				>
					<TokenRow {token} rank={rankOffset + i + 1} {cols} {compact} rowFlash={rowFlashes.get(token.pairAddress)} showImage={visibleRows.has(token.pairAddress)} {onselect} />
				</div>
			{/each}
		{/if}
	</div>
</div>

{#if pinnedToken && pinRect}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div
		use:portal
		onmouseleave={unpinRow}
		onclick={unpinRow}
		onwheel={onPinWheel}
		class="fixed z-[120] origin-top overflow-hidden rounded-lg bg-s2 shadow-2xl ring-1 ring-bd3"
		style="left: {pinRect.left}px; top: {pinRect.top}px; width: {pinRect.width}px; height: {pinRect.height}px; transform: scale(1.02);"
	>
		<TokenRow token={pinnedToken} rank={pinnedRank} {cols} {compact} rowFlash={rowFlashes.get(pinnedToken.pairAddress)} showImage={true} {onselect} />
	</div>
{/if}
