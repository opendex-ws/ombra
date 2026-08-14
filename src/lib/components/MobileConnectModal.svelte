<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import X from 'lucide-svelte/icons/x';
	import Smartphone from 'lucide-svelte/icons/smartphone';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import CheckCircle from 'lucide-svelte/icons/circle-check-big';
	import Clock from 'lucide-svelte/icons/clock';
	import { api } from '$lib/api/client';
	import { getAuthToken } from '$lib/stores/auth.svelte';
	import { onDestroy } from 'svelte';

	let {
		show = $bindable(false)
	}: {
		show: boolean;
	} = $props();

	type PairingState = 'idle' | 'loading' | 'showing' | 'claimed' | 'expired' | 'error';

	let pairingState = $state<PairingState>('idle');
	let pairingId = $state('');
	let error = $state('');
	let countdown = $state(0);
	let qrDataUrl = $state('');
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;

	function cleanup() {
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
		if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
	}

	function close() {
		cleanup();
		pairingState = 'idle';
		error = '';
		qrDataUrl = '';
		show = false;
	}

	async function initPairing() {
		const token = getAuthToken();
		if (!token) { error = 'Not logged in'; pairingState = 'error'; return; }

		cleanup();
		pairingState = 'loading';
		error = '';

		try {
			const res = await api.POST('/v2/auth/mobile-connect', {
				body: { token }
			});
			const data = res.data;
			if (!data?.pairingId) throw new Error((res.error as unknown as { message?: string })?.message ?? 'Failed to create pairing');

			pairingId = data.pairingId;
			const payload = JSON.stringify({ v: 1, id: data.pairingId, s: data.pairingSecret });

			const QRCode = await import('qrcode');
			qrDataUrl = await QRCode.toDataURL(payload, {
				width: 280,
				margin: 2,
				color: {
					dark: '#000000',
					light: '#ffffff'
				}
			});

			countdown = data.expiresInSecs;
			pairingState = 'showing';

			countdownTimer = setInterval(() => {
				countdown--;
				if (countdown <= 0) {
					cleanup();
					pairingState = 'expired';
				}
			}, 1000);

			const deadline = Date.now() + data.expiresInSecs * 1000;
			pollTimer = setInterval(async () => {
				if (Date.now() > deadline) { cleanup(); pairingState = 'expired'; return; }
				try {
					const s = await api.GET('/v2/auth/mobile-connect/{pairingId}/status', {
						params: { path: { pairingId } }
					});
					const statusData = s.data as { status: string } | undefined;
					if (statusData?.status === 'CLAIMED') { cleanup(); pairingState = 'claimed'; }
					else if (statusData?.status === 'EXPIRED') { cleanup(); pairingState = 'expired'; }
				} catch {}
			}, 2000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create pairing';
			pairingState = 'error';
		}
	}

	$effect(() => {
		if (show && pairingState === 'idle') initPairing();
	});

	onDestroy(cleanup);
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px] p-4" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
		<div class="animate-fade-in w-full max-w-sm rounded-2xl border border-bd bg-s5 p-6 shadow-2xl backdrop-blur-xl" onclick={(e) => e.stopPropagation()}>
			<div class="mb-5 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<Smartphone class="h-5 w-5 text-grn" strokeWidth={1.5} />
					<h2 class="text-base font-semibold text-tx">Connect Mobile</h2>
				</div>
				<button onclick={close} class="cursor-pointer text-g7 hover:text-tx">
					<X class="h-5 w-5" strokeWidth={2} />
				</button>
			</div>

			{#if pairingState === 'loading'}
				<div class="flex flex-col items-center gap-3 py-12">
					<div class="h-6 w-6 animate-spin rounded-full border-2 border-g4 border-t-grn"></div>
					<span class="text-sm text-g7">Generating QR code...</span>
				</div>
			{:else if pairingState === 'showing'}
				<div class="flex flex-col items-center gap-4">
					<div class="rounded-xl border border-bd bg-white p-3">
						<img src={qrDataUrl} alt="Mobile connect QR" class="h-[280px] w-[280px]" />
					</div>
					<div class="flex items-center gap-2 text-sm text-g7">
						<Clock class="h-4 w-4" strokeWidth={1.5} />
						<span>Expires in <span class="font-mono font-semibold {countdown <= 30 ? 'text-yel' : 'text-tx'}">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</span></span>
					</div>
					<p class="text-center text-xs text-g5">Scan this QR code with your phone to connect your account</p>
				</div>
			{:else if pairingState === 'claimed'}
				<div class="flex flex-col items-center gap-4 py-8">
					<div class="flex h-16 w-16 items-center justify-center rounded-full bg-grn/10 ring-2 ring-grn/20">
						<CheckCircle class="h-8 w-8 text-grn" strokeWidth={1.5} />
					</div>
					<div class="text-center">
						<p class="text-base font-semibold text-tx">Connected</p>
						<p class="mt-1 text-sm text-g7">Your phone is now linked to this session</p>
					</div>
					<button onclick={close} class="mt-2 cursor-pointer rounded-lg bg-grn px-6 py-2 text-sm font-semibold text-s0 transition-all hover:bg-grn/90">Done</button>
				</div>
			{:else if pairingState === 'expired'}
				<div class="flex flex-col items-center gap-4 py-8">
					<div class="flex h-16 w-16 items-center justify-center rounded-full bg-yel/10 ring-2 ring-yel/20">
						<Clock class="h-8 w-8 text-yel" strokeWidth={1.5} />
					</div>
					<div class="text-center">
						<p class="text-base font-semibold text-tx">QR Code Expired</p>
						<p class="mt-1 text-sm text-g7">The pairing window has closed</p>
					</div>
					<button onclick={() => { pairingState = 'idle'; initPairing(); }} class="mt-2 flex cursor-pointer items-center gap-2 rounded-lg bg-grn px-6 py-2 text-sm font-semibold text-s0 transition-all hover:bg-grn/90">
						<RefreshCw class="h-4 w-4" strokeWidth={2} />
						Generate New Code
					</button>
				</div>
			{:else if pairingState === 'error'}
				<div class="flex flex-col items-center gap-4 py-8">
					<p class="text-sm text-red">{error}</p>
					<button onclick={() => { pairingState = 'idle'; initPairing(); }} class="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-bd bg-s4 px-4 py-2 text-sm text-tx transition-all hover:bg-s7">
						<RefreshCw class="h-4 w-4" strokeWidth={2} />
						Retry
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
