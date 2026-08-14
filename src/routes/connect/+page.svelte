<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import Camera from 'lucide-svelte/icons/camera';
	import CheckCircle from 'lucide-svelte/icons/circle-check-big';
	import XCircle from 'lucide-svelte/icons/circle-x';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import ScanLine from 'lucide-svelte/icons/scan-line';
	import { setAuthToken } from '$lib/stores/auth.svelte';
	import { authenticate } from '$lib/ws/client';
	import { apiUrl } from '$lib/api/config';

	type ScanState = 'requesting' | 'scanning' | 'claiming' | 'success' | 'error';

	let scanState = $state<ScanState>('requesting');
	let errorMsg = $state('');
	let videoEl = $state<HTMLVideoElement>();
	let canvasEl = $state<HTMLCanvasElement>();
	let stream: MediaStream | null = null;
	let pendingStream: MediaStream | null = null;
	let animFrame: number | null = null;
	let jsQR: typeof import('jsqr').default | null = null;

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
		const el = videoEl;
		el.srcObject = pendingStream;
		pendingStream = null;
		await new Promise<void>((resolve) => {
			el.onloadedmetadata = () => resolve();
			setTimeout(() => resolve(), 3000);
		});
		await el.play().catch(() => {});
		requestAnimationFrame(scanLoop);
	}

	$effect(() => {
		if (scanState === 'scanning' && videoEl && pendingStream) {
			attachStream();
		}
	});

	function stopCamera() {
		if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
		if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
		if (pendingStream) { pendingStream.getTracks().forEach(t => t.stop()); pendingStream = null; }
	}

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

	async function claimPairing(pairingId: string, pairingSecret: string) {
		stopCamera();
		scanState = 'claiming';

		try {
			const res = await fetch(apiUrl('/v2/auth/mobile-connect/claim'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pairingId, pairingSecret })
			});

			if (res.status === 404) {
				errorMsg = 'Code expired or already used. Ask the desktop to regenerate.';
				scanState = 'error';
				return;
			}
			if (!res.ok) {
				errorMsg = 'Could not connect. Try again.';
				scanState = 'error';
				return;
			}

			const data = await res.json() as { token?: string };
			if (!data.token) {
				errorMsg = 'No token received';
				scanState = 'error';
				return;
			}

			setAuthToken(data.token);
			authenticate(data.token);
			scanState = 'success';
			setTimeout(() => goto('/'), 1500);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Connection failed';
			scanState = 'error';
		}
	}

	function retry() {
		errorMsg = '';
		startCamera();
	}

	onMount(() => { startCamera(); });
	onDestroy(() => { stopCamera(); });
</script>

<div class="flex min-h-[calc(100dvh-3rem)] flex-col items-center justify-center p-4">
	<canvas bind:this={canvasEl} class="hidden"></canvas>

	{#if scanState === 'requesting'}
		<div class="flex flex-col items-center gap-4">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-g4 border-t-grn"></div>
			<p class="text-sm text-g7">Requesting camera access...</p>
		</div>
	{:else if scanState === 'scanning'}
		<div class="flex w-full max-w-sm flex-col items-center gap-4">
			<div class="relative w-full overflow-hidden rounded-2xl border-2 border-bd bg-s0">
				<!-- svelte-ignore element_invalid_self_closing_tag -->
				<video bind:this={videoEl} class="h-auto w-full" autoplay playsinline muted />
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div class="h-48 w-48 rounded-2xl border-2 border-grn/40 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"></div>
				</div>
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
					<ScanLine class="h-12 w-12 text-grn/60 animate-pulse" strokeWidth={1} />
				</div>
			</div>
			<div class="text-center">
				<p class="text-sm font-medium text-tx">Scan the QR code</p>
				<p class="mt-1 text-xs text-g5">Point your camera at the QR code shown on your desktop</p>
			</div>
		</div>
	{:else if scanState === 'claiming'}
		<div class="flex flex-col items-center gap-4">
			<LoaderCircle class="h-10 w-10 animate-spin text-grn" strokeWidth={1.5} />
			<p class="text-sm text-g7">Connecting...</p>
		</div>
	{:else if scanState === 'success'}
		<div class="flex flex-col items-center gap-4">
			<div class="flex h-20 w-20 items-center justify-center rounded-full bg-grn/10 ring-2 ring-grn/20">
				<CheckCircle class="h-10 w-10 text-grn" strokeWidth={1.5} />
			</div>
			<div class="text-center">
				<p class="text-lg font-semibold text-tx">Connected</p>
				<p class="mt-1 text-sm text-g7">Redirecting...</p>
			</div>
		</div>
	{:else if scanState === 'error'}
		<div class="flex flex-col items-center gap-4">
			<div class="flex h-20 w-20 items-center justify-center rounded-full bg-red/10 ring-2 ring-red/20">
				<XCircle class="h-10 w-10 text-red" strokeWidth={1.5} />
			</div>
			<div class="text-center">
				<p class="text-base font-semibold text-tx">Connection Failed</p>
				<p class="mt-2 max-w-xs text-sm text-g7">{errorMsg}</p>
			</div>
			<button onclick={retry} class="mt-2 flex cursor-pointer items-center gap-2 rounded-lg bg-grn px-6 py-2.5 text-sm font-semibold text-s0 transition-all hover:bg-grn/90">
				<Camera class="h-4 w-4" strokeWidth={2} />
				Try Again
			</button>
		</div>
	{/if}
</div>
