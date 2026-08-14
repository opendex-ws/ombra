<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import X from 'lucide-svelte/icons/x';
	import ZoomIn from 'lucide-svelte/icons/zoom-in';
	import ZoomOut from 'lucide-svelte/icons/zoom-out';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';

	let { show = $bindable(false), inline = false, onconfirm = (_b64: string) => {} }: {
		show?: boolean;
		inline?: boolean;
		onconfirm?: (base64: string) => void;
	} = $props();

	const MAX_SIZE = 256;
	const MAX_FILE_MB = 5;
	const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
	const ASPECTS: { label: string; ratio: number | null }[] = [
		{ label: 'Free', ratio: null },
		{ label: '1:1', ratio: 1 },
		{ label: '4:3', ratio: 4 / 3 },
		{ label: '16:9', ratio: 16 / 9 },
	];

	let img: HTMLImageElement | null = $state(null);
	let error: string = $state('');
	let zoom: number = $state(1);
	let panX: number = $state(0);
	let panY: number = $state(0);
	let fileInput: HTMLInputElement = $state(null!);
	let processing: boolean = $state(false);
	let previewEl: HTMLDivElement = $state(null!);

	let cropX: number = $state(0);
	let cropY: number = $state(0);
	let cropW: number = $state(0);
	let cropH: number = $state(0);
	let aspectIdx: number = $state(0);
	let aspect = $derived(ASPECTS[aspectIdx].ratio);

	const PREVIEW_MAX = 300;
	let displayScale = $derived.by(() => {
		const i = img;
		if (!i) return 1;
		return Math.min(PREVIEW_MAX / i.width, PREVIEW_MAX / i.height, 1);
	});
	let dispW = $derived.by(() => { const i = img; return i ? Math.round(i.width * displayScale) : PREVIEW_MAX; });
	let dispH = $derived.by(() => { const i = img; return i ? Math.round(i.height * displayScale) : PREVIEW_MAX; });

	let dragMode: 'none' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'pan' = 'none';
	let dragStartMouse = { x: 0, y: 0 };
	let dragStartCrop = { x: 0, y: 0, w: 0, h: 0 };
	let dragStartPan = { x: 0, y: 0 };

	function reset() {
		img = null;
		error = '';
		zoom = 1;
		panX = 0;
		panY = 0;
		processing = false;
		cropX = 0;
		cropY = 0;
		cropW = 0;
		cropH = 0;
		aspectIdx = 0;
		dragMode = 'none';
	}

	function close() {
		show = false;
		reset();
	}

	export function openWithFile(file: File) {
		reset();
		show = true;
		loadFile(file);
	}

	function pickFile() { fileInput?.click(); }

	function onFileSelect(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		loadFile(file);
		if (fileInput) fileInput.value = '';
	}

	function onPaste(e: ClipboardEvent) {
		if (!show) return;
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) { loadFile(file); e.preventDefault(); }
				return;
			}
		}
	}

	$effect(() => {
		if (!show) return;
		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	});

	function loadFile(file: File) {
		error = '';
		if (!ACCEPTED.includes(file.type)) {
			error = 'Unsupported format. Use JPEG, PNG, WebP, or GIF.';
			return;
		}
		if (file.size > MAX_FILE_MB * 1024 * 1024) {
			error = `File too large. Maximum ${MAX_FILE_MB}MB.`;
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const i = new Image();
			i.onload = () => {
				img = i;
				zoom = 1;
				panX = 0;
				panY = 0;
				initCrop();
			};
			i.onerror = () => { error = 'Failed to load image.'; };
			i.src = reader.result as string;
		};
		reader.readAsDataURL(file);
	}

	function initCrop() {
		cropX = 0;
		cropY = 0;
		cropW = dispW;
		cropH = dispH;
		applyAspect();
	}

	function applyAspect() {
		if (!aspect) return;
		const maxW = dispW;
		const maxH = dispH;
		let w = maxW;
		let h = Math.round(w / aspect);
		if (h > maxH) {
			h = maxH;
			w = Math.round(h * aspect);
		}
		cropW = w;
		cropH = h;
		cropX = Math.round((dispW - w) / 2);
		cropY = Math.round((dispH - h) / 2);
	}

	function setAspect(idx: number) {
		aspectIdx = idx;
		if (img) applyAspect();
	}

	function clampCrop() {
		cropW = Math.max(20, Math.min(cropW, dispW));
		cropH = Math.max(20, Math.min(cropH, dispH));
		cropX = Math.max(0, Math.min(cropX, dispW - cropW));
		cropY = Math.max(0, Math.min(cropY, dispH - cropH));
	}

	function onCropPointerDown(e: PointerEvent, mode: typeof dragMode) {
		e.stopPropagation();
		e.preventDefault();
		dragMode = mode;
		dragStartMouse = { x: e.clientX, y: e.clientY };
		dragStartCrop = { x: cropX, y: cropY, w: cropW, h: cropH };
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragUp);
	}

	function onDragMove(e: PointerEvent) {
		const dx = e.clientX - dragStartMouse.x;
		const dy = e.clientY - dragStartMouse.y;
		const s = dragStartCrop;
		if (dragMode === 'move') {
			cropX = s.x + dx;
			cropY = s.y + dy;
			clampCrop();
		} else if (dragMode === 'se') {
			cropW = s.w + dx;
			cropH = aspect ? Math.round(cropW / aspect) : s.h + dy;
			clampCrop();
		} else if (dragMode === 'sw') {
			const newW = s.w - dx;
			cropX = s.x + dx;
			cropW = newW;
			cropH = aspect ? Math.round(cropW / aspect) : s.h + dy;
			clampCrop();
		} else if (dragMode === 'ne') {
			cropW = s.w + dx;
			const newH = aspect ? Math.round(cropW / aspect) : s.h - dy;
			cropY = s.y + s.h - newH;
			cropH = newH;
			clampCrop();
		} else if (dragMode === 'nw') {
			const newW = s.w - dx;
			const newH = aspect ? Math.round(newW / aspect) : s.h - dy;
			cropX = s.x + s.w - newW;
			cropY = s.y + s.h - newH;
			cropW = newW;
			cropH = newH;
			clampCrop();
		} else if (dragMode === 'n') {
			const newH = s.h - dy;
			cropY = s.y + dy;
			cropH = newH;
			if (aspect) { cropW = Math.round(cropH * aspect); cropX = s.x + Math.round((s.w - cropW) / 2); }
			clampCrop();
		} else if (dragMode === 's') {
			cropH = s.h + dy;
			if (aspect) { cropW = Math.round(cropH * aspect); cropX = s.x + Math.round((s.w - cropW) / 2); }
			clampCrop();
		} else if (dragMode === 'e') {
			cropW = s.w + dx;
			if (aspect) { cropH = Math.round(cropW / aspect); cropY = s.y + Math.round((s.h - cropH) / 2); }
			clampCrop();
		} else if (dragMode === 'w') {
			const newW = s.w - dx;
			cropX = s.x + dx;
			cropW = newW;
			if (aspect) { cropH = Math.round(cropW / aspect); cropY = s.y + Math.round((s.h - cropH) / 2); }
			clampCrop();
		}
	}

	function onDragUp() {
		dragMode = 'none';
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragUp);
	}

	function zoomIn() { zoom = Math.min(5, zoom + 0.15); }
	function zoomOut() { zoom = Math.max(0.5, zoom - 0.15); }
	function resetView() { zoom = 1; panX = 0; panY = 0; initCrop(); }

	function confirm() {
		if (!img) return;
		processing = true;
		const srcX = cropX / displayScale;
		const srcY = cropY / displayScale;
		const srcW = cropW / displayScale;
		const srcH = cropH / displayScale;
		const outScale = Math.min(MAX_SIZE / srcW, MAX_SIZE / srcH, 1);
		const outW = Math.round(srcW * outScale);
		const outH = Math.round(srcH * outScale);
		const offscreen = document.createElement('canvas');
		offscreen.width = outW;
		offscreen.height = outH;
		const ctx = offscreen.getContext('2d');
		if (!ctx || !img) { processing = false; return; }
		ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
		const base64 = offscreen.toDataURL('image/jpeg', 0.85);
		onconfirm(base64);
		close();
	}
</script>

{#snippet cropperContent()}
	{#if !img}
		<div class="flex flex-col items-center gap-3 py-6">
			<button onclick={pickFile} class="btn-primary px-6 py-2.5 text-sm">Choose Image</button>
			<span class="text-[11px] text-g5">JPEG, PNG, WebP or GIF. Max {MAX_FILE_MB}MB. Or paste.</span>
		</div>
	{:else}
		<div class="mb-2 flex items-center justify-center gap-1">
			{#each ASPECTS as a, i}
				<button onclick={() => setAspect(i)} class="cursor-pointer rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors {aspectIdx === i ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">{a.label}</button>
			{/each}
		</div>
		<div bind:this={previewEl} class="relative mx-auto mb-2 select-none rounded-lg bg-s0" style="width: {dispW}px; height: {dispH}px;">
			<img src={img.src} alt="" class="pointer-events-none block" style="width: {dispW}px; height: {dispH}px; opacity: 0.3;" />
			<div class="absolute inset-0 overflow-hidden" style="clip-path: inset({cropY}px {dispW - cropX - cropW}px {dispH - cropY - cropH}px {cropX}px);">
				<img src={img.src} alt="" class="pointer-events-none block" style="width: {dispW}px; height: {dispH}px;" />
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="absolute border-2 border-wh/40 cursor-move" style="left: {cropX}px; top: {cropY}px; width: {cropW}px; height: {cropH}px;" onpointerdown={(e) => onCropPointerDown(e, 'move')}>
				<div class="pointer-events-none absolute inset-0">
					<div class="absolute left-1/3 top-0 bottom-0 w-px bg-wh/20"></div>
					<div class="absolute left-2/3 top-0 bottom-0 w-px bg-wh/20"></div>
					<div class="absolute top-1/3 left-0 right-0 h-px bg-wh/20"></div>
					<div class="absolute top-2/3 left-0 right-0 h-px bg-wh/20"></div>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute -left-1 -top-1 h-3 w-3 cursor-nw-resize border-l-2 border-t-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 'nw')}></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute -right-1 -top-1 h-3 w-3 cursor-ne-resize border-r-2 border-t-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 'ne')}></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute -bottom-1 -left-1 h-3 w-3 cursor-sw-resize border-b-2 border-l-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 'sw')}></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize border-b-2 border-r-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 'se')}></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute left-1/2 -top-1 h-2 w-6 -translate-x-1/2 cursor-n-resize border-t-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 'n')}></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute left-1/2 -bottom-1 h-2 w-6 -translate-x-1/2 cursor-s-resize border-b-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 's')}></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute top-1/2 -left-1 h-6 w-2 -translate-y-1/2 cursor-w-resize border-l-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 'w')}></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="absolute top-1/2 -right-1 h-6 w-2 -translate-y-1/2 cursor-e-resize border-r-2 border-wh" onpointerdown={(e) => onCropPointerDown(e, 'e')}></div>
			</div>
		</div>
		<div class="mb-3 flex items-center justify-center gap-1.5">
			<button onclick={zoomOut} class="cursor-pointer rounded-lg border border-bd bg-s4 p-1 text-g7 transition-colors hover:text-tx"><ZoomOut class="h-3.5 w-3.5" /></button>
			<span class="w-10 text-center text-[10px] text-g5">{Math.round(zoom * 100)}%</span>
			<button onclick={zoomIn} class="cursor-pointer rounded-lg border border-bd bg-s4 p-1 text-g7 transition-colors hover:text-tx"><ZoomIn class="h-3.5 w-3.5" /></button>
			<button onclick={resetView} class="cursor-pointer rounded-lg border border-bd bg-s4 p-1 text-g7 transition-colors hover:text-tx"><RotateCcw class="h-3.5 w-3.5" /></button>
			<button onclick={pickFile} class="btn-secondary px-2 py-1 text-[10px]">Change</button>
		</div>
		<div class="flex gap-2">
			<button onclick={close} class="btn-secondary flex-1 py-2 text-xs">Cancel</button>
			<button onclick={confirm} disabled={processing} class="btn-primary flex-1 py-2 text-xs">{processing ? 'Processing...' : 'Save'}</button>
		</div>
	{/if}
	{#if error}
		<div class="mt-2 rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-xs text-red">{error}</div>
	{/if}
{/snippet}

{#if show && inline}
	<div class="rounded-xl border border-bd bg-s5 p-3">
		{@render cropperContent()}
	</div>
{:else if show}
	<div use:portal class="fixed inset-0 z-[250] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={(e) => { if (e.key === 'Escape') close(); }}>
		<div class="relative mx-4 w-full max-w-md rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-bd px-5 py-3">
				<h2 class="text-sm font-semibold text-tx">Edit Image</h2>
				<button onclick={close} class="cursor-pointer text-g4 transition-colors hover:text-tx"><X class="h-4 w-4" /></button>
			</div>
			<div class="p-4">
				{@render cropperContent()}
			</div>
		</div>
	</div>
{/if}

<input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onchange={onFileSelect} />
