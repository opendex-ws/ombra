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
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import { portal } from '$lib/actions/portal';
	import X from 'lucide-svelte/icons/x';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import { siGithub } from 'simple-icons';

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

	let pingClass = $derived(
		tone === 'green' ? 'text-grn' : tone === 'yellow' ? 'text-yel' : 'text-red'
	);
	let pingDotClass = $derived(
		tone === 'green' ? 'bg-grn' : tone === 'yellow' ? 'bg-yel' : 'bg-red'
	);
	let mobileRailOpen = $state(false);
	let mobileRailPos = $state({ x: 0, y: 0, above: false });

	function openMobileRail(e: MouseEvent) {
		if (mobileRailOpen) {
			mobileRailOpen = false;
			return;
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const width = 208;
		const estimatedHeight = 280;
		// The rail lives in the bottom bar, so there is rarely room underneath.
		// Flipping anchors the popover's BOTTOM edge above the trigger, which needs
		// no measured height.
		const above = rect.bottom + estimatedHeight + 8 > window.innerHeight;
		mobileRailPos = {
			x: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
			y: above ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
			above
		};
		mobileRailOpen = true;
	}
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

{#snippet railDivider()}
	<span class="mx-1 h-3 w-px shrink-0 bg-bd2" aria-hidden="true"></span>
{/snippet}

{#snippet mobileRow(label: string, value: string, icon: string)}
	<div class="flex items-center gap-2 px-3 py-1.5">
		<ChainIcon chain={icon} class="h-3.5 w-3.5 shrink-0 text-grn" />
		<span class="flex-1 text-g6">{label}</span>
		<span class="font-mono {priceStale ? 'text-yel' : 'text-g9'}">{value}</span>
	</div>
{/snippet}

{#snippet statusGroup()}
	<div class="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={statusTitle} aria-label={statusTitle}>
		<span class="inline-flex items-center gap-1" title={priceStale ? 'Last accepted SOL/USD price is older than 60 seconds' : 'Live SOL/USD price'}>
			<ChainIcon chain="SOL" class="h-3 w-3 text-grn" />
			<span class="sr-only">SOL</span>
			<span class="font-mono {solPrice ? getPegFlash('SOL') : ''} {priceStale && solPrice ? 'text-yel' : solPrice ? 'text-g9' : 'text-g6'}">
				{solPrice ? formatUsd(solPrice) : '—'}
			</span>
		</span>
		{@render railDivider()}
		<span class="inline-flex items-center gap-1" title={statusTitle}>
			<span class="sr-only">{connectionLabel}</span>
			<span class="text-g5">RTT</span>
			<span class="font-mono {pingClass}">{rtt}</span>
			{#if diagnostics.lastPongRttMs !== undefined}<span class="{pingClass}">ms</span>{/if}
		</span>
		{@render railDivider()}
		<span class="inline-flex items-center gap-1" title="Rendering frames per second">
			<span class="text-g5">FPS</span>
			<span class="font-mono {fpsClass}">{fps || '—'}</span>
		</span>
		{@render railDivider()}
		<a
			href="https://portal.opendex.ws/docs"
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1 text-g6 transition-colors hover:text-tx"
			title="Docs"
		>
			<BookOpen class="h-3 w-3" strokeWidth={2} />
			<span>Docs</span>
		</a>
		<a
			href="https://github.com/opendex-ws/ombra"
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1 text-g6 transition-colors hover:text-tx"
			title="GitHub"
		>
			<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={siGithub.path} /></svg>
			<span>GitHub</span>
		</a>
	</div>
{/snippet}

{#if mobile}
	<!-- The full rail cannot fit a phone, so it collapses to the SOL price and
	     opens as rows where everything is actually readable. -->
	<div class="relative shrink-0">
		<button
			type="button"
			onclick={openMobileRail}
			class="cursor-pointer flex items-center gap-1 rounded-md border border-bd bg-s2/70 px-2 py-1 text-[10px] {mobileRailOpen ? 'text-tx' : ''}"
			title={statusTitle}
			aria-label="Market status"
		>
			<ChainIcon chain="SOL" class="h-3 w-3 text-grn" />
			<span class="font-mono {solPrice ? getPegFlash('SOL') : ''} {priceStale && solPrice ? 'text-yel' : solPrice ? 'text-g9' : 'text-g6'}">
				{solPrice ? formatUsd(solPrice) : '—'}
			</span>
			<span class="h-1.5 w-1.5 shrink-0 rounded-full {pingDotClass}" aria-hidden="true"></span>
			<ChevronDown class="h-3 w-3 text-g5 transition-transform {mobileRailOpen ? 'rotate-180' : ''}" />
		</button>
		{#if mobileRailOpen}
			<div use:portal class="fixed inset-0 z-[70]">
				<button type="button" aria-label="Close" class="absolute inset-0 cursor-default" onclick={() => (mobileRailOpen = false)}></button>
				<div
					class="absolute max-h-[70vh] w-52 overflow-y-auto rounded-lg border border-bd bg-s5 py-1 text-[11px] shadow-2xl"
					style="left: {mobileRailPos.x}px; {mobileRailPos.above
						? `bottom: ${mobileRailPos.y}px`
						: `top: ${mobileRailPos.y}px`}"
				>
					{@render mobileRow('SOL', solPrice ? formatUsd(solPrice) : '—', 'SOL')}
					<div class="my-1 border-t border-bd/40"></div>
					<div class="flex items-center gap-2 px-3 py-1.5">
						<span class="flex-1 text-g6">{connectionLabel}</span>
						<span class="font-mono {pingClass}">{rtt}{diagnostics.lastPongRttMs !== undefined ? ' ms' : ''}</span>
					</div>
					<div class="flex items-center gap-2 px-3 py-1.5">
						<span class="flex-1 text-g6">FPS</span>
						<span class="font-mono {fpsClass}">{fps || '—'}</span>
					</div>
					<div class="my-1 border-t border-bd/40"></div>
					<a href="https://portal.opendex.ws/docs" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 px-3 py-1.5 text-g7 transition-colors hover:bg-wh/5 hover:text-tx">
						<BookOpen class="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
						<span class="flex-1">Docs</span>
					</a>
					<a href="https://github.com/opendex-ws/ombra" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 px-3 py-1.5 text-g7 transition-colors hover:bg-wh/5 hover:text-tx">
						<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={siGithub.path} /></svg>
						<span class="flex-1">GitHub</span>
					</a>
				</div>
			</div>
		{/if}
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
						<span role="button" tabindex="0" onclick={(e) => onTabClose(e, tab)} onkeydown={(e) => { if (e.key === 'Enter') onTabClose(e as unknown as MouseEvent, tab); }} class="cursor-pointer shrink-0 rounded p-0.5 text-g5 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"><X class="h-2.5 w-2.5" /></span>
					</button>
				{/each}
			</div>
		{/if}
		<div class="ml-auto flex shrink-0 items-center">
			{@render statusGroup()}
		</div>
	</div>
{/if}
