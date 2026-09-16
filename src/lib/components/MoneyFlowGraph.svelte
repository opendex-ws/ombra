<script lang="ts">
	import { untrack, onDestroy } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	// Money flow: tokens as circles, each swap as a ribbon of volume. Buys arrive
	// from off-graph and point into the circle; sells leave the circle and trail
	// off. Nothing joins two tokens, and no wallet is identified anywhere.
	import { tokenImage } from '$lib/api/config';
	import { formatUsd } from '$lib/utils/format';
	import {
		assignSlots,
		buildMoneyFlow,
		tokenKey,
		nodeRadius,
		pulseIntensity,
		slotPosition,
		ribbonGeometry,
		ribbonWidth,
		type FlowSwap,
		type MoneyFlow
	} from '$lib/utils/money-flow';

	let {
		swaps,
		flow: flowProp = undefined,
		onselect = () => {}
	}: {
		swaps: readonly FlowSwap[];
		/** Session-wide totals. Falls back to the passed window when absent. */
		flow?: MoneyFlow;
		onselect?: (node: { chain: string; address: string }) => void;
	} = $props();

	const RIBBON_LEN = 56;
	const flow = $derived(flowProp ?? buildMoneyFlow(swaps));

	// Slots persist across recomputes so a token does not jump when ranking churns.
	let slots = $state.raw<Map<string, number>>(new Map());
	$effect(() => {
		const keys = flow.nodes.map((n) => n.key);
		// Reading `slots` here as a dependency would retrigger this effect on its
		// own write — capture the identity input, then mutate inside untrack.
		untrack(() => {
			slots = assignSlots(keys, slots);
		});
	});

	const placed = $derived(
		flow.nodes.map((node) => {
			const pos = slotPosition(slots.get(node.key) ?? 0);
			return { node, pos, r: nodeRadius(node.totalUsd, flow.maxNodeUsd) };
		})
	);

	/**
	 * Fit the viewBox to whatever is plotted, so adding tokens zooms out instead of
	 * cropping them. Rings grow without bound, so a fixed box would hide tokens.
	 */
	const box = $derived.by(() => {
		if (placed.length === 0) return { x: -160, y: -220, w: 320, h: 440 };
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const { pos, r } of placed) {
			const reach = r + RIBBON_LEN + 14;
			minX = Math.min(minX, pos.x - reach);
			minY = Math.min(minY, pos.y - reach);
			maxX = Math.max(maxX, pos.x + reach);
			maxY = Math.max(maxY, pos.y + reach);
		}
		// Keep a sane minimum so a single token is not blown up to fill the pane.
		const w = Math.max(maxX - minX, 300);
		const h = Math.max(maxY - minY, 420);
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		return { x: cx - w / 2, y: cy - h / 2, w, h };
	});

	let pan = $state({ x: 0, y: 0 });
	let zoom = $state(1);
	let dragging = $state(false);
	let svgEl = $state<SVGSVGElement | null>(null);
	let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };
	/** A drag that ends on a token must not also open that token. */
	let dragMoved = false;
	let captured = false;
	let activePointer = -1;
	let panFrame = 0;
	let panPending: { x: number; y: number } | null = null;

	const MIN_ZOOM = 0.4;
	const MAX_ZOOM = 4;

	/** Client coords -> viewBox user units, so zoom can anchor under the cursor. */
	function toUserSpace(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!svgEl?.getScreenCTM) return null;
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return null;
		const inv = ctm.inverse();
		return { x: clientX * inv.a + clientY * inv.c + inv.e, y: clientX * inv.b + clientY * inv.d + inv.f };
	}

	function zoomBy(factor: number, clientX?: number, clientY?: number) {
		const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
		if (next === zoom) return;
		const anchor =
			clientX !== undefined && clientY !== undefined
				? toUserSpace(clientX, clientY)
				: { x: box.x + box.w / 2, y: box.y + box.h / 2 };
		if (!anchor) {
			zoom = next;
			return;
		}
		// Keep whatever sits under the cursor pinned while the scale changes.
		const px = (anchor.x - pan.x) / zoom;
		const py = (anchor.y - pan.y) / zoom;
		pan = { x: anchor.x - next * px, y: anchor.y - next * py };
		zoom = next;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
	}

	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		// Ancestors (popout window drag, panel resize) also listen for pointer drags;
		// without this both engage and fight over the same gesture.
		e.stopPropagation();
		dragging = true;
		dragMoved = false;
		captured = false;
		activePointer = e.pointerId;
		dragStart = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging || e.pointerId !== activePointer) return;
		const dx = e.clientX - dragStart.x;
		const dy = e.clientY - dragStart.y;
		if (!dragMoved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
		if (!dragMoved) {
			dragMoved = true;
			// Capture only once this is a real drag. Capturing on pointerdown would
			// retarget the following `click` to the <svg>, so a plain click on a
			// token would never reach the token's own handler.
			try {
				svgEl?.setPointerCapture(e.pointerId);
				captured = true;
			} catch {
				/* dragging still works without capture */
			}
		}
		// Pointer moves fire far faster than frames; coalesce to one commit per frame
		// so a drag cannot outrun rendering.
		panPending = { x: dragStart.panX + dx, y: dragStart.panY + dy };
		if (panFrame) return;
		panFrame = requestAnimationFrame(() => {
			panFrame = 0;
			if (panPending) pan = panPending;
		});
	}

	function endDrag(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		activePointer = -1;
		if (captured) {
			try {
				svgEl?.releasePointerCapture(e.pointerId);
			} catch {
				/* ignore */
			}
			captured = false;
		}
		if (panFrame) {
			cancelAnimationFrame(panFrame);
			panFrame = 0;
		}
		if (panPending) pan = panPending;
		panPending = null;
	}

	const PULSE_MS = 1000;
	/** Swaps already accounted for, so switching to the view does not fire a burst. */
	let seenSwaps = new Set<string>();
	let primed = false;
	let pulses = $state.raw<{ key: string; line: string; buy: boolean; usd: number; intensity: number }[]>([]);
	let pulseSeq = 0;
	const pulseTimers = new Set<ReturnType<typeof setTimeout>>();

	$effect(() => {
		const list = swaps;
		untrack(() => {
			const lines = new Map<string, { inLine: string; outLine: string }>();
			for (const { node, pos, r } of placed) {
				lines.set(node.key, {
					inLine: ribbonGeometry(pos.x, pos.y, r, pos.angle, true, RIBBON_LEN).line,
					outLine: ribbonGeometry(pos.x, pos.y, r, pos.angle, false, RIBBON_LEN).line
				});
			}
			const fresh: { key: string; line: string; buy: boolean; usd: number; intensity: number }[] = [];
			const reference = flow.maxSwapUsd;
			for (const swap of list) {
				if (seenSwaps.has(swap.id)) continue;
				seenSwaps.add(swap.id);
				if (!primed) continue;
				const line = lines.get(tokenKey(swap.chain, swap.token.address));
				if (!line) continue;
				const buy = swap.side === 'BUY';
				const usd = Number(swap.amountUsd) || 0;
				fresh.push({
					key: `p${++pulseSeq}`,
					line: buy ? line.inLine : line.outLine,
					buy,
					usd,
					intensity: pulseIntensity(usd, reference)
				});
			}
			primed = true;
			// `seenSwaps` only has to cover the rendered window.
			if (seenSwaps.size > 4000) seenSwaps = new Set(list.map((s) => s.id));
			if (fresh.length === 0) return;
			pulses = [...pulses, ...fresh].slice(-60);
			const keys = new Set(fresh.map((f) => f.key));
			const timer = setTimeout(() => {
				pulseTimers.delete(timer);
				pulses = pulses.filter((p) => !keys.has(p.key));
			}, PULSE_MS);
			pulseTimers.add(timer);
		});
	});

	function resetView() {
		pan = { x: 0, y: 0 };
		zoom = 1;
	}

	function openToken(node: { chain: string; address: string }) {
		if (dragMoved) return;
		onselect(node);
	}

	onDestroy(() => {
		if (panFrame) cancelAnimationFrame(panFrame);
		for (const timer of pulseTimers) clearTimeout(timer);
	});

</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="flex shrink-0 items-center gap-2 border-b border-bd/40 px-2 py-1.5 text-[10px]">
		<span class="flex items-center gap-1 text-g5">
			<span class="h-1.5 w-3 rounded-full bg-grn"></span>
			In {formatUsd(flow.totalInUsd)}
		</span>
		<span class="flex items-center gap-1 text-g5">
			<span class="h-1.5 w-3 rounded-full bg-red"></span>
			Out {formatUsd(flow.totalOutUsd)}
		</span>
		<div class="ml-auto flex items-center gap-1.5">
			{#if flow.hiddenNodeCount > 0}
				<span class="text-g4">+{flow.hiddenNodeCount}</span>
			{/if}
			<button onclick={() => zoomBy(1 / 1.25)} class="cursor-pointer px-0.5 text-g4 transition-colors hover:text-g8" title="Zoom out" aria-label="Zoom out">&minus;</button>
			<button onclick={() => zoomBy(1.25)} class="cursor-pointer px-0.5 text-g4 transition-colors hover:text-g8" title="Zoom in" aria-label="Zoom in">+</button>
			{#if pan.x !== 0 || pan.y !== 0 || zoom !== 1}
				<button onclick={resetView} class="cursor-pointer text-g4 transition-colors hover:text-g8">reset</button>
			{/if}
		</div>
	</div>

	{#if flow.nodes.length === 0}
		<div class="flex flex-1 items-center justify-center px-4 text-center text-xs text-g5">
			No swaps to plot yet
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-hidden">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<svg
				bind:this={svgEl}
				viewBox="{box.x} {box.y} {box.w} {box.h}"
				class="h-full w-full touch-none select-none {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
				preserveAspectRatio="xMidYMid meet"
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={endDrag}
				onpointercancel={endDrag}
				onwheel={onWheel}
			>
				<defs>
					{#each placed as { node, pos, r } (node.key)}
						<clipPath id="mf-clip-{node.key}">
							<circle cx={pos.x} cy={pos.y} r={r} />
						</clipPath>
						{#if node.inUsd > 0}
							{@const g = ribbonGeometry(pos.x, pos.y, r, pos.angle, true)}
							<linearGradient id="mf-in-{node.key}" gradientUnits="userSpaceOnUse" x1={g.nodeX} y1={g.nodeY} x2={g.farX} y2={g.farY}>
								<stop offset="0" stop-color="var(--t-grn)" stop-opacity="0.12" />
								<stop offset="1" stop-color="var(--t-grn)" stop-opacity="0.8" />
							</linearGradient>
						{/if}
						{#if node.outUsd > 0}
							{@const g = ribbonGeometry(pos.x, pos.y, r, pos.angle, false)}
							<linearGradient id="mf-out-{node.key}" gradientUnits="userSpaceOnUse" x1={g.nodeX} y1={g.nodeY} x2={g.farX} y2={g.farY}>
								<stop offset="0" stop-color="var(--t-red)" stop-opacity="0.12" />
								<stop offset="1" stop-color="var(--t-red)" stop-opacity="0.8" />
							</linearGradient>
						{/if}
					{/each}
				</defs>

				<g transform="translate({pan.x} {pan.y}) scale({zoom})">
					{#each placed as { node, pos, r } (node.key)}
						{@const maxDir = Math.max(flow.maxNodeUsd, 1)}
						<g out:fade={{ duration: 220 }}>
							{#if node.inUsd > 0}
								{@const g = ribbonGeometry(pos.x, pos.y, r, pos.angle, true, RIBBON_LEN)}
								{@const w = ribbonWidth(node.inUsd, maxDir)}
								<path d={g.line} fill="none" stroke="url(#mf-in-{node.key})" stroke-width={w} stroke-linecap="round" />
							{/if}
							{#if node.outUsd > 0}
								{@const g = ribbonGeometry(pos.x, pos.y, r, pos.angle, false, RIBBON_LEN)}
								{@const w = ribbonWidth(node.outUsd, maxDir)}
								<path d={g.line} fill="none" stroke="url(#mf-out-{node.key})" stroke-width={w} stroke-linecap="round" />
							{/if}
						</g>
					{/each}

					{#each pulses as pulse (pulse.key)}
						{@const colour = pulse.buy ? 'var(--t-grn)' : 'var(--t-red)'}
						{@const r = 1.8 + pulse.intensity * 4.2}
						<g class="mf-pulse">
							<animateMotion dur="{PULSE_MS}ms" path={pulse.line} fill="freeze" />
							<animate attributeName="opacity" values="0;1;1;0" dur="{PULSE_MS}ms" fill="freeze" />
							<!-- Halo widens with size, so a whale reads at a glance. -->
							<circle r={r * 2.4} fill={colour} opacity={0.12 + pulse.intensity * 0.18} />
							<circle {r} fill={colour} />
							{#if pulse.intensity >= 0.45}
								<text
									x={r + 4}
									y="3"
									fill={colour}
									font-size="8"
									font-weight="700"
									class="pointer-events-none"
								>{formatUsd(pulse.usd)}</text>
							{/if}
						</g>
					{/each}

					{#each placed as { node, pos, r } (node.key)}
						{@const inShare = node.totalUsd > 0 ? node.inUsd / node.totalUsd : 0}
						{@const c = 2 * Math.PI * (r + 2.5)}
						<g
							in:scale={{ duration: 260, start: 0.6 }}
							out:scale={{ duration: 220, start: 0.6 }}
							class="mf-node cursor-pointer"
							role="button"
							tabindex="0"
							onclick={() => openToken({ chain: node.chain, address: node.address })}
							onkeydown={(e) => {
								if (e.key === 'Enter') onselect({ chain: node.chain, address: node.address });
							}}
						>
							<title>{node.symbol || node.address} — in {formatUsd(node.inUsd)}, out {formatUsd(node.outUsd)}</title>
							<!-- A swap landing on this token replays the ripple. -->
							{#key node.count}
								<circle class="mf-ripple" cx={pos.x} cy={pos.y} r={r + 3} fill="none" stroke={node.inUsd >= node.outUsd ? 'var(--t-grn)' : 'var(--t-red)'} stroke-width="1.5" />
							{/key}
							<circle cx={pos.x} cy={pos.y} r={r + 4} fill="var(--t-s5)" />
							<image
								href={tokenImage(node.chain, node.address, 64)}
								x={pos.x - r}
								y={pos.y - r}
								width={r * 2}
								height={r * 2}
								clip-path="url(#mf-clip-{node.key})"
								preserveAspectRatio="xMidYMid slice"
							/>
							<circle cx={pos.x} cy={pos.y} r={r + 2.5} fill="none" stroke="var(--t-red)" stroke-width="2" opacity="0.9" />
							<circle
								cx={pos.x}
								cy={pos.y}
								r={r + 2.5}
								fill="none"
								stroke="var(--t-grn)"
								stroke-width="2"
								stroke-linecap="round"
								stroke-dasharray="{c * inShare} {c}"
								transform="rotate(-90 {pos.x} {pos.y})"
							/>
							{#if node.symbol}
								<text
									x={pos.x}
									y={pos.y + r + 13}
									text-anchor="middle"
									class="pointer-events-none"
									fill="var(--t-g7)"
									font-size="8.5"
									font-weight="700"
								>{node.symbol}</text>
							{/if}
						</g>
					{/each}
				</g>
			</svg>
		</div>
	{/if}
</div>

<style>
	.mf-ripple {
		animation: mf-ripple 900ms ease-out forwards;
		transform-box: fill-box;
		transform-origin: center;
	}
	@keyframes mf-ripple {
		from {
			opacity: 0.7;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(1.7);
		}
	}
	.mf-node {
		transition: opacity 150ms ease;
	}
	.mf-node:hover {
		opacity: 0.85;
	}
	@media (prefers-reduced-motion: reduce) {
		.mf-ripple,
		.mf-pulse {
			animation: none;
		}
		.mf-ripple {
			opacity: 0;
		}
	}
</style>
