<script lang="ts">
	// Generic floating window for a single feed. Both the X feed and the swaps
	// feed use one of these, which is what makes them independent: neither is
	// nested inside the other's chrome.
	import X from 'lucide-svelte/icons/x';
	import PictureInPicture2 from 'lucide-svelte/icons/picture-in-picture-2';
	import type { Snippet } from 'svelte';
	import { portal } from '$lib/actions/portal';
	import { bringToFront, getPanelZ } from '$lib/stores/floatingPanels.svelte';

	let {
		id,
		title,
		float,
		onmove,
		onresize,
		ondock,
		children
	}: {
		/** Z-order key, also used for `bringToFront`. */
		id: string;
		title: string;
		float: { x: number; y: number; w: number; h: number };
		onmove: (x: number, y: number) => void;
		onresize: (w: number, h: number) => void;
		/** Dock back into the social feed panel. */
		ondock: () => void;
		children: Snippet;
	} = $props();

	let floatEl = $state<HTMLElement | null>(null);
	let dragging = $state(false);
	let dragOffset = { x: 0, y: 0 };

	function onDragMove(ev: MouseEvent) {
		if (!dragging) return;
		onmove(
			Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - dragOffset.x)),
			Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dragOffset.y))
		);
	}

	function onDragUp() {
		dragging = false;
		window.removeEventListener('mousemove', onDragMove);
		window.removeEventListener('mouseup', onDragUp);
	}

	function onDragDown(ev: MouseEvent) {
		if ((ev.target as HTMLElement).closest('button')) return;
		dragOffset = { x: ev.clientX - float.x, y: ev.clientY - float.y };
		dragging = true;
		bringToFront(id);
		window.addEventListener('mousemove', onDragMove);
		window.addEventListener('mouseup', onDragUp);
	}

	// Persist size when the native resize handle is dragged.
	$effect(() => {
		if (!floatEl) return;
		const el = floatEl;
		const ro = new ResizeObserver(() => {
			if (el.offsetWidth > 0 && el.offsetHeight > 0) onresize(el.offsetWidth, el.offsetHeight);
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	use:portal
	bind:this={floatEl}
	class="glass-strong fixed flex flex-col overflow-hidden rounded-xl border border-bd bg-s2 shadow-2xl"
	style="left: {float.x}px; top: {float.y}px; width: {float.w}px; height: {float.h}px; resize: both; min-width: 300px; min-height: 240px; z-index: {getPanelZ(id)};"
	onmousedown={() => bringToFront(id)}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex shrink-0 items-center gap-2 border-b border-bd px-3 py-1.5 {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
		onmousedown={onDragDown}
	>
		<span class="text-[11px] font-bold text-tx">{title}</span>
		<div class="ml-auto flex items-center gap-1">
			<button
				onclick={ondock}
				class="cursor-pointer rounded p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-tx md:p-0.5"
				title="Dock back into the social feed"
			>
				<PictureInPicture2 class="h-3 w-3" strokeWidth={2} />
			</button>
			<button
				onclick={ondock}
				class="cursor-pointer rounded p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-tx md:p-0.5"
				title="Close"
			>
				<X class="h-3 w-3" strokeWidth={2} />
			</button>
		</div>
	</div>
	<div class="flex min-h-0 flex-1 flex-col">
		{@render children()}
	</div>
</div>
