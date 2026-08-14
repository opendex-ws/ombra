<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import { onDestroy } from 'svelte';
	import X from 'lucide-svelte/icons/x';
	import Camera from 'lucide-svelte/icons/camera';
	import CheckCircle from 'lucide-svelte/icons/circle-check-big';
	import XCircle from 'lucide-svelte/icons/circle-x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import ScanLine from 'lucide-svelte/icons/scan-line';
	import { api } from '$lib/api/client';
	import { setAuthToken } from '$lib/stores/auth.svelte';
	import { authenticate } from '$lib/ws/client';

	let {
		show = $bindable(false)
	}: {
		show: boolean;
	} = $props();

	type ScanState = 'requesting' | 'scanning' | 'claiming' | 'success' | 'error';

	let scanState = $state<ScanState>('requesting');
	let errorMsg = $state('');
	let videoEl = $state<HTMLVideoElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let stream: MediaStream | null = null;
	let pendingStream: MediaStream | null = null;
	let animFrame: number | null = null;
	let jsQR: typeof import('jsqr').default | null = null;

	function stopCamera() {
		if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
		if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
		if (pendingStream) { pendingStream.getTracks().forEach(t => t.stop()); pendingStream = null; }
	}

	function close() {
		stopCamera();
		scanState = 'requesting';
		errorMsg = '';
		show = false;
	}

	async function startCamera() {
		scanState = 'requesting';
		errorMsg = '';
		try {
			jsQR = (await import('jsqr')).default;
			let s: MediaStream;
			try {
				s = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { exact: 'environment' } }
				});
			} catch {
				s = await navigator.mediaDevices.getUserMedia({ video: true });
			}
			pendingStream = s;
			stream = s;
			scanState = 'scanning';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Camera access denied';
			scanState = 'error';
		}
	}

	async function attachStream() {
		if (!videoEl || !pendingStream) return;
		const vid = videoEl;
		vid.srcObject = pendingStream;
		pendingStream = null;
		await new Promise<void>((resolve) => {
			vid.onloadedmetadata = () => resolve();
			setTimeout(() => resolve(), 3000);
		});
		await vid.play().catch(() => {});
		requestAnimationFrame(scanLoop);
	}

	$effect(() => {
		if (scanState === 'scanning' && videoEl && pendingStream) {
			attachStream();
		}
	});

	function scanLoop() {
		if (scanState !== 'scanning' || !videoEl || !canvasEl || !jsQR) return;
		if (videoEl.readyState < videoEl.HAVE_CURRENT_DATA || videoEl.videoWidth === 0) {
			animFrame = requestAnimationFrame(scanLoop);
			return;
		}
		const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
		if (!ctx) { animFrame = requestAnimationFrame(scanLoop); return; }
		canvasEl.width = videoEl.videoWidth;
		canvasEl.height = videoEl.videoHeight;
		ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
		const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
		const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
		if (code?.data) {
			try {
				const parsed = JSON.parse(code.data);
				if (parsed.v === 1 && parsed.id && parsed.s) {
					claimPairing(parsed.id, parsed.s);
					return;
				}
			} catch {}
		}
		animFrame = requestAnimationFrame(scanLoop);
	}

	async function claimPairing(pid: string, secret: string) {
		stopCamera();
		scanState = 'claiming';
		try {
			const { data, error: err } = await api.POST('/v2/auth/mobile-connect/claim', {
				body: { pairingId: pid, pairingSecret: secret }
			});
			if (!data?.token) {
				const errBody = err as { message?: string } | undefined;
				errorMsg = errBody?.message ?? 'Code expired or already used. Regenerate on desktop.';
				scanState = 'error';
				return;
			}
			setAuthToken(data.token);
			authenticate(data.token);
			scanState = 'success';
			setTimeout(() => { close(); }, 1500);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Connection failed';
			scanState = 'error';
		}
	}

	$effect(() => {
		if (show && scanState === 'requesting') startCamera();
	});

	onDestroy(() => { stopCamera(); });
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px] p-4" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
		<div class="animate-fade-in w-full max-w-sm rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl overflow-hidden" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between px-5 pt-5 pb-3">
				<div class="flex items-center gap-2">
					<Camera class="h-5 w-5 text-grn" strokeWidth={1.5} />
					<h2 class="text-base font-semibold text-tx">Scan QR Code</h2>
				</div>
				<button onclick={close} class="cursor-pointer text-g7 hover:text-tx">
					<X class="h-5 w-5" strokeWidth={2} />
				</button>
			</div>

			<div class="px-5 pb-5">
				<canvas bind:this={canvasEl} class="hidden"></canvas>

				{#if scanState === 'requesting'}
					<div class="flex flex-col items-center gap-3 py-12">
						<div class="h-6 w-6 animate-spin rounded-full border-2 border-g4 border-t-grn"></div>
						<span class="text-sm text-g7">Opening camera...</span>
					</div>
				{:else if scanState === 'scanning'}
					<div class="relative w-full overflow-hidden rounded-xl border border-bd bg-s1">
						<!-- svelte-ignore element_invalid_self_closing_tag -->
						<video bind:this={videoEl} class="h-auto w-full" autoplay playsinline muted />
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
							<div class="h-44 w-44 rounded-2xl border-2 border-grn/40 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"></div>
						</div>
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
							<ScanLine class="h-10 w-10 text-grn/60 animate-pulse" strokeWidth={1} />
						</div>
					</div>
					<p class="mt-3 text-center text-xs text-g5">Point at the QR code on your desktop</p>
				{:else if scanState === 'claiming'}
					<div class="flex flex-col items-center gap-3 py-12">
						<LoaderCircle class="h-8 w-8 animate-spin text-grn" strokeWidth={1.5} />
						<span class="text-sm text-g7">Connecting...</span>
					</div>
				{:else if scanState === 'success'}
					<div class="flex flex-col items-center gap-3 py-10">
						<div class="flex h-16 w-16 items-center justify-center rounded-full bg-grn/10 ring-2 ring-grn/20">
							<CheckCircle class="h-8 w-8 text-grn" strokeWidth={1.5} />
						</div>
						<p class="text-base font-semibold text-tx">Connected</p>
						<p class="text-sm text-g7">You're logged in</p>
					</div>
				{:else if scanState === 'error'}
					<div class="flex flex-col items-center gap-3 py-10">
						<div class="flex h-16 w-16 items-center justify-center rounded-full bg-red/10 ring-2 ring-red/20">
							<XCircle class="h-8 w-8 text-red" strokeWidth={1.5} />
						</div>
						<p class="text-sm font-semibold text-tx">Failed</p>
						<p class="max-w-xs text-center text-xs text-g7">{errorMsg}</p>
						<button onclick={() => { scanState = 'requesting'; startCamera(); }} class="mt-2 flex cursor-pointer items-center gap-2 rounded-lg bg-grn px-5 py-2 text-sm font-semibold text-s0 transition-all hover:bg-grn/90">
							<Camera class="h-4 w-4" strokeWidth={2} />
							Try Again
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
