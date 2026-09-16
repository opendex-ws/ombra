<script lang="ts">
	// Social feed shell. Owns the docked chrome (resize / collapse) and hosts two
	// EQUAL feeds as tabs: X and Swaps. Neither is nested in the other — each pops
	// out into its own FeedWindow, so they can float independently or together.
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import PictureInPicture2 from 'lucide-svelte/icons/picture-in-picture-2';
	import { siX } from 'simple-icons';
	import ArrowLeftRight from 'lucide-svelte/icons/arrow-left-right';
	import TwitterFeedPanel from './TwitterFeedPanel.svelte';
	import SwapFeedPanel from './SwapFeedPanel.svelte';
	import ThesisFeedPanel from './ThesisFeedPanel.svelte';
	import MessageSquareQuote from 'lucide-svelte/icons/message-square-quote';
	import { bringToFront } from '$lib/stores/floatingPanels.svelte';
	import {
		getSocialFeedTab,
		setSocialFeedTab,
		getTwitterFeedCollapsed,
		toggleTwitterFeedCollapsed,
		getTwitterFeedHeightPct,
		setTwitterFeedHeightPct,
		getTwitterFeedPopout,
		setTwitterFeedPopout,
		getSwapFeedPopout,
		setSwapFeedPopout,
		getThesisFeedPopout,
		setThesisFeedPopout
	} from '$lib/stores/feSettings.svelte';

	let { mobile = false, active = true }: { mobile?: boolean; active?: boolean } = $props();

	const xPopped = $derived(getTwitterFeedPopout());
	const swapsPopped = $derived(getSwapFeedPopout());
	const thesisPopped = $derived(getThesisFeedPopout());
	/** Tabs still docked, in display order. */
	const dockedTabs = $derived(
		[
			{ id: 'swaps' as const, label: 'Swaps', popped: swapsPopped },
			{ id: 'thesis' as const, label: 'Thesis', popped: thesisPopped },
			{ id: 'x' as const, label: 'X', popped: xPopped }
		].filter((t) => mobile || !t.popped)
	);
	/** Fall back to whichever tab is still docked when the selected one floats away. */
	const tab = $derived(
		dockedTabs.some((t) => t.id === getSocialFeedTab())
			? getSocialFeedTab()
			: (dockedTabs[0]?.id ?? getSocialFeedTab())
	);

	function popOut(id: 'x' | 'swaps' | 'thesis') {
		if (id === 'x') setTwitterFeedPopout(true);
		else if (id === 'thesis') setThesisFeedPopout(true);
		else setSwapFeedPopout(true);
		bringToFront(id === 'x' ? 'twitter' : id);
	}

	let panelEl = $state<HTMLDivElement | null>(null);
	let resizing = $state(false);
	let resizeStartY = 0;
	let resizeStartPct = 0;

	function onResizeMove(ev: MouseEvent) {
		if (!resizing || !panelEl?.parentElement) return;
		const parentH = panelEl.parentElement.clientHeight;
		if (parentH <= 0) return;
		setTwitterFeedHeightPct(resizeStartPct + ((resizeStartY - ev.clientY) / parentH) * 100);
	}

	function onResizeUp() {
		resizing = false;
		window.removeEventListener('mousemove', onResizeMove);
		window.removeEventListener('mouseup', onResizeUp);
		document.body.style.userSelect = '';
	}

	function onResizeDown(ev: MouseEvent) {
		ev.preventDefault();
		resizing = true;
		resizeStartY = ev.clientY;
		resizeStartPct = getTwitterFeedHeightPct();
		window.addEventListener('mousemove', onResizeMove);
		window.addEventListener('mouseup', onResizeUp);
		document.body.style.userSelect = 'none';
	}

	const collapsed = $derived(!mobile && getTwitterFeedCollapsed());
	const allPopped = $derived(!mobile && dockedTabs.length === 0);
</script>

{#snippet body()}
	<!-- Header: tabs are peers. No feed's branding owns the panel. -->
	<div class="flex shrink-0 items-center gap-1 border-b border-bd px-2 py-1.5">
		<div class="flex shrink-0 gap-0.5 rounded bg-s4 p-0.5">
			{#each dockedTabs as t}
				<button
					onclick={() => setSocialFeedTab(t.id)}
					class="flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors md:px-1.5 md:py-px md:text-[10px] {tab === t.id ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
				>
					{#if t.id === 'x'}
						<svg viewBox="0 0 24 24" class="h-3 w-3 fill-current md:h-2.5 md:w-2.5"><path d={siX.path} /></svg>
					{:else if t.id === 'thesis'}
						<MessageSquareQuote class="h-3 w-3 md:h-2.5 md:w-2.5" strokeWidth={2.5} />
					{:else}
						<ArrowLeftRight class="h-3 w-3 md:h-2.5 md:w-2.5" strokeWidth={2.5} />
					{/if}
					{t.label}
				</button>
			{/each}
		</div>
		<div class="ml-auto flex items-center gap-1">
			{#if !mobile && dockedTabs.length > 0}
				<button
					onclick={() => popOut(tab)}
					class="cursor-pointer p-1.5 text-g4 transition-colors hover:text-tx md:p-0.5"
					title="Pop {tab === 'x' ? 'X' : tab === 'thesis' ? 'Thesis' : 'Swaps'} out to its own window"
				>
					<PictureInPicture2 class="h-4 w-4 md:h-3 md:w-3" strokeWidth={2} />
				</button>
				<button
					onclick={toggleTwitterFeedCollapsed}
					class="cursor-pointer p-1.5 text-g4 transition-colors hover:text-tx md:p-0.5"
					title={collapsed ? 'Expand' : 'Collapse'}
				>
					<ChevronDown class="h-4 w-4 transition-transform md:h-3.5 md:w-3.5 {collapsed ? 'rotate-180' : ''}" strokeWidth={2} />
				</button>
			{/if}
		</div>
	</div>

	{#if !collapsed}
		{#if allPopped}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
				<span class="text-xs text-g5">Both feeds are in their own windows</span>
				<div class="flex flex-wrap justify-center gap-1">
					<button onclick={() => setTwitterFeedPopout(false)} class="btn-secondary px-2 py-1 text-[11px]">Dock X</button>
					<button onclick={() => setSwapFeedPopout(false)} class="btn-secondary px-2 py-1 text-[11px]">Dock Swaps</button>
					<button onclick={() => setThesisFeedPopout(false)} class="btn-secondary px-2 py-1 text-[11px]">Dock Thesis</button>
				</div>
			</div>
		{:else if tab === 'thesis'}
			<ThesisFeedPanel {active} />
		{:else if tab === 'swaps'}
			<SwapFeedPanel {active} />
		{:else}
			<TwitterFeedPanel {active} {mobile} compact={!mobile} />
		{/if}
	{/if}
{/snippet}

{#if mobile}
	<div class="flex min-h-0 flex-1 flex-col bg-s0">
		{@render body()}
	</div>
{:else}
	<div
		bind:this={panelEl}
		class="relative z-10 flex min-h-0 shrink-0 flex-col bg-s0 {collapsed ? 'border-t border-bd' : ''}"
		style={collapsed ? '' : `height: ${getTwitterFeedHeightPct()}%`}
	>
		{#if !collapsed}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group/n flex h-2 shrink-0 cursor-n-resize touch-none items-center justify-center border-t border-bd/40 transition-colors hover:bg-s7 {resizing ? 'bg-s7' : ''}"
				onmousedown={onResizeDown}
			>
				<div class="h-[2px] w-10 rounded-full bg-g1 transition-colors group-hover/n:bg-grn {resizing ? '!bg-grn' : ''}"></div>
			</div>
		{/if}
		{@render body()}
	</div>
{/if}
