<script lang="ts">
	import { onDestroy } from 'svelte';
	import { portal } from '$lib/actions/portal';
	import X from 'lucide-svelte/icons/x';
	import { getOwnerProof, ownerProofExpired, OwnerProofError, type OwnerProofPreview } from '$lib/waas/owner-proof';
	import type { ExportFormat } from '$lib/waas/export-preview';
	import { createRevealSession, type RevealSession } from '$lib/waas/reveal-session';
	import { proofFailure, PROOF_REFRESHED_MESSAGE, type ProofFailure } from '$lib/waas/proof-failure';
	import OwnerProofMessage from './OwnerProofMessage.svelte';
	import { getAuthToken } from '$lib/stores/auth.svelte';
	import { exportFrameOrigin, exportFrameUrl } from '$lib/waas/export-frame-url';
	import { fetchWaasAccount, type WaasAccount } from '$lib/waas/signer-provider';
	import { getLoginMethod } from '$lib/waas/login-method';

	let { onclose }: { onclose: () => void } = $props();

	const FORMATS: { value: ExportFormat; label: string }[] = [
		{ value: 'SOLANA_PRIVATE_KEY', label: 'Solana key' },
		{ value: 'EVM_PRIVATE_KEY', label: 'EVM key' }
	];

	// The trusted frame on the auth origin owns the export session: it fetches the preview,
	// receives the encrypted bundle and shows the key. This modal only shows the preview,
	// collects the owner proof and forwards it with the unchanged previewId.

	const frameOrigin = exportFrameOrigin();
	const frameSrc = exportFrameUrl();

	let format: ExportFormat = $state('SOLANA_PRIVATE_KEY');
	let phase: 'idle' | 'previewing' | 'review' | 'working' | 'ready' | 'expired' | 'error' = $state('idle');
	let preview: OwnerProofPreview | null = $state(null);
	let failure: ProofFailure | null = $state(null);
	let refreshed = $state(false);
	let frameEl: HTMLIFrameElement | null = $state(null);
	let session: RevealSession | null = $state(null);

	let destroyed = false;
	let run = 0;
	let lastOwnerProofError: unknown = null;
	let account = $state<WaasAccount | null>(null);
	const accountLoad = fetchWaasAccount().then((loaded) => (account = loaded));
	const googleEmail = $derived(getLoginMethod() === 'google' ? (account?.googleEmail ?? null) : null);

	function fail(code: string, status: number | null = null) {
		failure = proofFailure(status, code);
		phase = 'error';
	}

	/** Wipe and drop the current frame; any message from it is ignored afterwards. */
	function endSession() {
		session?.end();
		session = null;
		preview = null;
		run++;
	}

	async function begin(isRefresh: boolean) {
		endSession();
		const mine = run;
		failure = null;
		refreshed = isRefresh;
		phase = 'previewing';
		await accountLoad;
		if (destroyed || mine !== run) return;
		if (!account) return fail('SIGN_IN_REQUIRED');
		if (account.provider !== 'waas') return fail('WAAS_EXPORT_TURNKEY_USER');
		if (!account.identity) return fail('SIGN_IN_REQUIRED');
		if (!frameSrc || !frameOrigin) return fail('EXPORT_FRAME_CONFIG_INVALID');
		lastOwnerProofError = null;
		session = createRevealSession({
			frameWindow: () => frameEl?.contentWindow ?? null,
			frameOrigin,
			userId: account.identity.userId,
			orgId: account.identity.orgId,
			format,
			token: getAuthToken,
			ownerProof: (shown) => getOwnerProof('export', shown).catch((error: unknown) => {
				lastOwnerProofError = error;
				throw error;
			}),
			onChange: (next) => {
				if (destroyed || mine !== run) return;
				preview = next.preview;
				if (next.phase === 'loading') {
					phase = 'previewing';
				} else if (next.phase === 'review') {
					phase = 'review';
				} else if (next.phase === 'working') {
					phase = 'working';
				} else if (next.phase === 'ready') {
					phase = 'ready';
				} else if (next.phase === 'expired') {
					phase = 'expired';
				} else if (next.phase === 'error') {
					const code = next.error ?? 'EXPORT_FAILED';
					if (code === 'OWNER_PROOF_EXPIRED' || code === 'PROOF_EXPIRED') {
						void begin(true);
					} else {
						fail(code, code === 'WAAS_OWNER_REVIEW_CSRF' ? 403 : null);
						if (
							code === 'WALLET_SIGN_FAILED' && lastOwnerProofError instanceof OwnerProofError &&
							lastOwnerProofError.message !== code
						) failure = { code, message: `Wallet could not sign: ${lastOwnerProofError.message}`, restart: false };
					}
				}
			}
		});
	}

	function onFrameLoad() {
		session?.frameLoaded();
	}

	function onMessage(event: MessageEvent) {
		session?.receive({ origin: event.origin, source: event.source, data: event.data });
	}

	function approve() {
		const shown = preview;
		if (phase !== 'review' || !session || !shown) return;
		if (ownerProofExpired(shown)) return void begin(true);
		session.approve();
	}

	function close() {
		endSession();
		onclose();
	}

	function onWindowKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}

	onDestroy(() => {
		destroyed = true;
		endSession();
	});
</script>

<svelte:window onkeydown={onWindowKeyDown} onmessage={onMessage} />

<div use:portal class="fixed inset-0 z-[130] flex items-center justify-center p-4">
	<div
		role="presentation"
		class="absolute inset-0 cursor-default bg-s0/60 backdrop-blur-[2px]"
		onclick={(e) => { if (e.target === e.currentTarget) close(); }}
	></div>
	<div data-testid="reveal-key-modal" class="relative w-full max-w-sm rounded-2xl border border-bd bg-s5 p-5 shadow-2xl backdrop-blur-xl">
		<div class="mb-4 flex items-start justify-between gap-3">
			<h2 class="text-base font-semibold text-tx">Reveal private key</h2>
			<button data-testid="reveal-key-close" aria-label="Close" onclick={close} class="cursor-pointer text-g4 transition-colors hover:text-tx">
				<X class="h-4 w-4" />
			</button>
		</div>
		{#if session}
			{#key session.contextId}
				<iframe bind:this={frameEl} onload={onFrameLoad} data-testid="reveal-key-frame" title="Private key" src={frameSrc} allow="clipboard-write" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" class="{phase === 'ready' ? 'block' : 'hidden'} h-56 w-full rounded-lg border-0"></iframe>
			{/key}
		{/if}
		{#if googleEmail && phase !== 'ready'}
			<p data-testid="reveal-key-google-email" class="mb-3 break-all text-xs text-g7">
				Confirm with Google: <span class="font-medium text-tx">{googleEmail}</span>
			</p>
		{/if}
		{#if phase === 'previewing'}
			<button data-testid="reveal-key-start" class="btn-primary px-4 py-2 text-sm" disabled>Loading the approval text...</button>
		{:else if phase === 'review' && preview}
			<div data-testid="reveal-key-review" class="flex flex-col gap-3">
				{#if refreshed}
					<p data-testid="owner-proof-refreshed" class="text-xs text-yel">{PROOF_REFRESHED_MESSAGE}</p>
				{/if}
				<OwnerProofMessage {preview} />
				<button data-testid="reveal-key-approve" class="btn-primary px-4 py-2 text-sm" onclick={approve}>{googleEmail ? 'Confirm with Google' : 'Sign with wallet'}</button>
			</div>
		{:else if phase === 'working'}
			{#if preview}
				<OwnerProofMessage {preview} />
			{/if}
			<button data-testid="reveal-key-start" class="btn-primary px-4 py-2 text-sm" disabled>{googleEmail ? 'Confirm in the Google window...' : 'Approve the message in your wallet...'}</button>
		{:else if phase !== 'ready'}
			<div class="flex flex-col gap-3">
				<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Format</div>
				<div class="flex flex-wrap gap-1.5">
					{#each FORMATS as f (f.value)}
						<button
							data-testid={`reveal-format-${f.value}`}
							class="cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors {format === f.value ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}"
							onclick={() => (format = f.value)}
						>{f.label}</button>
					{/each}
				</div>
				{#if phase === 'expired'}
					<p data-testid="reveal-key-expired" class="text-xs text-g6">The key is hidden and wiped. Reveal it again to see it.</p>
				{/if}
				{#if phase === 'error' && failure}
					<p data-testid="reveal-key-error" class="text-xs text-red">{failure.message}</p>
				{/if}
				{#if phase === 'error' && failure?.restart}
					<button data-testid="reveal-key-restart" class="btn-primary px-4 py-2 text-sm" onclick={() => begin(false)}>Start again</button>
				{:else}
					<button data-testid="reveal-key-start" class="btn-primary px-4 py-2 text-sm" onclick={() => begin(false)}>Reveal</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
