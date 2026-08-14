<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { getNow } from '$lib/stores/tick.svelte';
	import { getPegAgeMs, getPegFlash, getPegPrices } from '$lib/stores/peg.svelte';
	import { formatUsd } from '$lib/utils/format';
	import { getWsHealthTone } from '$lib/utils/ws-health';
	import { getWsDiagnostics, observeWsDiagnostics, type WsDiagnostics } from '$lib/ws/client';
	import ChainIcon from './ChainIcon.svelte';
	import { page } from '$app/state';
	import { getIsDesktop } from '$lib/stores/viewport.svelte';
	import { getMultiTab } from '$lib/stores/feSettings.svelte';
	import { getTokenTabs, getPopouts, popoutToken, closeTokenTab, closePopout, type TokenTab } from '$lib/stores/tokenTabs.svelte';
	import PictureInPicture2 from 'lucide-svelte/icons/picture-in-picture-2';
	import X from 'lucide-svelte/icons/x';

	let { mobile = false }: { mobile?: boolean } = $props();

	// Token dock: shows every open token (tabs + floating windows, deduped) on
	// non-terminal pages (desktop, multiTab beta). Clicking one pops it out /
	// refocuses its floating window.
	const dockTokens = $derived.by(() => {
		const out: TokenTab[] = [];
		const seen = new Set<string>();
		for (const t of getTokenTabs()) {
			const k = `${t.chain}:${t.address}`;
			if (!seen.has(k)) { seen.add(k); out.push(t); }
		}
		for (const p of getPopouts()) {
			const k = `${p.chain}:${p.address}`;
			if (!seen.has(k)) { seen.add(k); out.push({ chain: p.chain, address: p.address, symbol: p.symbol }); }
		}
		return out;
	});
	const showDock = $derived(getMultiTab() && getIsDesktop() && page.url.pathname !== '/' && dockTokens.length > 0);
	function isPoppedOut(tab: TokenTab): boolean {
		return getPopouts().some((p) => p.chain === tab.chain && p.address === tab.address);
	}
	function onTabClick(tab: TokenTab) {
		popoutToken(tab.chain, tab.address, tab.symbol);
	}
	function onTabClose(e: MouseEvent, tab: TokenTab) {
		e.stopPropagation();
		const po = getPopouts().find((p) => p.chain === tab.chain && p.address === tab.address);
		if (po) closePopout(po.id);
		closeTokenTab(tab.chain, tab.address);
	}
	let diagnostics = $state<WsDiagnostics>(getWsDiagnostics());
	let now = $derived(getNow());
	let solPrice = $derived(getPegPrices().SOL);
	let priceAgeMs = $derived(getPegAgeMs('SOL', now));
	let priceStale = $derived(priceAgeMs === undefined || priceAgeMs > 60_000);
	let pongAgeMs = $derived(
		diagnostics.lastPongAtMs === undefined ? undefined : Math.max(0, now - diagnostics.lastPongAtMs)
	);

	$effect(() => {
		const stop = observeWsDiagnostics((next) => (diagnostics = next));
		return () => stop();
	});

	// Live FPS: count animation frames per ~1s window. Pauses while hidden.
	let fps = $state(0);
	$effect(() => {
		if (typeof requestAnimationFrame === 'undefined') return;
		let frames = 0;
		let last = performance.now();
		let raf = 0;
		const loop = (t: number) => {
			frames++;
			if (t - last >= 1000) {
				fps = Math.round((frames * 1000) / (t - last));
				frames = 0;
				last = t;
			}
			raf = requestAnimationFrame(loop);
		};
		const onVis = () => {
			if (document.visibilityState === 'hidden') { cancelAnimationFrame(raf); raf = 0; }
			else if (!raf) { frames = 0; last = performance.now(); raf = requestAnimationFrame(loop); }
		};
		raf = requestAnimationFrame(loop);
		document.addEventListener('visibilitychange', onVis);
		return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
	});
	let fpsClass = $derived(fps === 0 ? 'text-g6' : fps >= 50 ? 'text-grn' : fps >= 30 ? 'text-yel' : 'text-red');

	let tone = $derived.by(() => {
		return getWsHealthTone(diagnostics.state, pongAgeMs, diagnostics.lastPongRttMs);
	});

	let toneClass = $derived(
		tone === 'green'
			? 'bg-grn text-grn'
			: tone === 'yellow'
				? 'bg-yel text-yel'
				: 'bg-red text-red'
	);
	let rtt = $derived(
		diagnostics.lastPongRttMs === undefined ? '—' : `${Math.round(diagnostics.lastPongRttMs)}`
	);
	let connectionLabel = $derived(
		tone === 'red'
			? 'Connection degraded'
			: diagnostics.state === 'recovering'
				? 'Connection is stable; checking'
				: tone === 'yellow'
					? 'Connection recovering'
					: 'Connection is stable'
	);
	let statusTitle = $derived(
		`${connectionLabel}. ${diagnostics.lastPongRttMs === undefined ? 'RTT unavailable' : `Round-trip time ${rtt} ms`}${priceStale ? '. SOL price is stale.' : ''}`
	);

</script>

{#snippet statusGroup()}
	<div class="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={statusTitle} aria-label={statusTitle}>
		<ChainIcon chain="SOL" class="h-3 w-3 text-grn" />
		<span class="font-semibold text-g6">SOL</span>
		<span class="{solPrice ? getPegFlash('SOL') : ''} {priceStale && solPrice ? 'text-yel' : solPrice ? 'text-g9' : 'text-g6'}" title={priceStale ? 'Last accepted SOL/USD price is older than 60 seconds' : 'Live SOL/USD price'}>
			{solPrice ? formatUsd(solPrice) : '—'}
		</span>
		<span class="mx-1 h-3 w-px bg-bd" aria-hidden="true"></span>
		<span class="inline-flex items-center gap-1" title={statusTitle}>
			<span class="h-1.5 w-1.5 rounded-full {toneClass.split(' ')[0]}" aria-hidden="true"></span>
			<span class="sr-only">{connectionLabel}</span>
			<span class="text-g5">RTT</span>
			<span class="font-mono text-g8">{rtt}</span>
			{#if diagnostics.lastPongRttMs !== undefined}<span class="text-g5">ms</span>{/if}
		</span>
		<span class="mx-1 h-3 w-px bg-bd" aria-hidden="true"></span>
		<span class="inline-flex items-center gap-1" title="Rendering frames per second">
			<span class="text-g5">FPS</span>
			<span class="font-mono {fpsClass}">{fps || '—'}</span>
		</span>
	</div>
{/snippet}

{#if mobile}
	<div class="ml-auto flex min-w-0 shrink-0 items-center rounded-md border border-bd/60 bg-s2/70 px-2 py-1 text-[10px]">
		{@render statusGroup()}
	</div>
{:else}
	<div class="fixed inset-x-0 bottom-0 z-40 hidden h-7 items-center gap-2 border-t border-bd bg-s0/90 px-4 text-[10px] backdrop-blur-md md:flex">
		{#if showDock}
			<div class="flex min-w-0 items-center gap-1 overflow-x-auto">
				{#each dockTokens as tab (tab.chain + ':' + tab.address)}
					{@const open = isPoppedOut(tab)}
					<button
						type="button"
						onclick={() => onTabClick(tab)}
						title={open ? 'Focus floating window' : 'Open floating window'}
						class="group flex shrink-0 cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 transition-colors {open ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd bg-s2 text-g7 hover:border-bd3 hover:text-tx'}"
					>
						<img src={tokenImage(tab.chain, tab.address)} alt="" class="h-3 w-3 shrink-0 rounded-full object-cover" />
						<span class="max-w-[80px] truncate font-medium">{tab.symbol || tab.address.slice(0, 4)}</span>
						{#if open}<PictureInPicture2 class="h-2.5 w-2.5 shrink-0 opacity-70" />{/if}
						<span role="button" tabindex="0" onclick={(e) => onTabClose(e, tab)} onkeydown={(e) => { if (e.key === 'Enter') onTabClose(e as unknown as MouseEvent, tab); }} class="shrink-0 rounded p-0.5 text-g5 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"><X class="h-2.5 w-2.5" /></span>
					</button>
				{/each}
			</div>
		{/if}
		<div class="ml-auto flex shrink-0 items-center">
			{@render statusGroup()}
		</div>
	</div>
{/if}
