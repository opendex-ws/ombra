<script lang="ts">
	import { onDestroy } from 'svelte';
	import X from 'lucide-svelte/icons/x';
	import { portal } from '$lib/actions/portal';
	import type { WalletAsset, components } from '$lib/api/types';
	import { getAuthToken, signConnectedWalletMessageHex } from '$lib/stores/auth.svelte';
	import { apiUrl } from '$lib/api/config';
	import { getOwnerProof, ownerProofExpired, OwnerProofError } from '$lib/waas/owner-proof';
	import {
		effectiveWithdrawAmount,
		maxWithdrawAmount,
		toBaseUnits,
		WithdrawParamsError
	} from '$lib/waas/withdraw-params';
	import { getLoginMethod } from '$lib/waas/login-method';
	import type { WithdrawChain } from '$lib/waas/withdraw-chain';
	import { fetchWaasAccount, sessionIdentity, type WaasAccount } from '$lib/waas/signer-provider';
	import {
		isEvmChain,
		isValidWithdrawAddress,
		invalidAddressMessage,
		withdrawAddressPlaceholder,
		withdrawSourceLabel,
		hasFeeInfo,
		describeWithdrawFee
	} from '$lib/waas/withdraw-chain';
	import {
		reviewRhWithdrawal,
		readWithdrawOwnerProof,
		ownerProofConfirmBody,
		type PreparedWithdrawal,
		type WithdrawOwnerProof,
		type OwnerProofConfirmBody
	} from '$lib/waas/withdraw-owner-proof';
	import { proofFailure, PROOF_REFRESHED_MESSAGE } from '$lib/waas/proof-failure';
	import OwnerProofMessage from './OwnerProofMessage.svelte';
	import { readWithdrawResponse, withdrawErrorMessage, WithdrawHttpError } from '$lib/waas/withdraw-http';

	type WalletWithdrawResponse = components['schemas']['WalletWithdrawResponse'];
	type WalletWithdrawConfirmRequest = components['schemas']['WalletWithdrawConfirmRequest'];
	type WalletWithdrawConfirmResponse = components['schemas']['WalletWithdrawConfirmResponse'];
	type ConfirmBody = WalletWithdrawConfirmRequest | OwnerProofConfirmBody;

	let {
		chain,
		asset,
		chainAssets = [],
		onclose,
		oncomplete
	}: {
		chain: WithdrawChain;
		asset: WalletAsset;
		chainAssets?: WalletAsset[];
		onclose: () => void;
		oncomplete: (result: WalletWithdrawConfirmResponse) => void;
	} = $props();

	let amount = $state('');
	let destinationAddress = $state('');
	let submitting = $state(false);
	let error = $state('');
	let account = $state<WaasAccount | null>(null);
	let accountLoaded = $state(false);
	let prepared = $state.raw<PreparedWithdrawal | null>(null);
	let executionDeadline: string | null = null;
	let ownerProof = $state<WithdrawOwnerProof | null>(null);
	let preparedRequest = $state<string | null>(null);
	let restartable = $state(false);
	let refreshed = $state(false);
	let pendingConfirm = $state.raw<ConfirmBody | null>(null);
	let pendingBytes: string | null = null;
	let generation = 0;
	let active = true;
	const controller = new AbortController();
	const initialIdentity = sessionIdentity(getAuthToken());
	function current(g: number) {
		return active && generation === g && sessionIdentity(getAuthToken()) === initialIdentity;
	}
	function close() {
		active = false;
		generation++;
		controller.abort();
		pendingConfirm = null;
		pendingBytes = null;
		ownerProof = null;
		prepared = null;
		onclose();
	}
	onDestroy(() => { active = false; generation++; controller.abort(); pendingConfirm = null; pendingBytes = null; ownerProof = null; prepared = null; });
	$effect(() => {
		if (sessionIdentity(getAuthToken()) !== initialIdentity) {
			active = false; generation++; controller.abort(); pendingConfirm = null; pendingBytes = null; prepared = null; ownerProof = null;
		}
	});
	let amountNote = $state('');

	fetchWaasAccount().then((loaded) => {
		if (!current(0)) return;
		account = loaded;
		accountLoaded = true;
	});

	const evm = $derived(isEvmChain(chain));
	// Only Google sign-ins confirm a withdrawal with a Google owner proof.
	const googleEmail = $derived(
		account?.provider !== 'turnkey' && getLoginMethod() === 'google' ? (account?.googleEmail ?? null) : null
	);
	const nativeSol = $derived(chain === 'SOL' && asset.isNative);

	function setMax() {
		amount = maxWithdrawAmount(chain, asset);
		amountNote = nativeSol && amount !== asset.tokensBalanceStr ? 'Max keeps 0.000005 SOL back for the network fee.' : '';
	}
	const feeLines = $derived(prepared ? describeWithdrawFee(prepared as WalletWithdrawResponse, chain, asset, chainAssets) : []);

	async function post<T>(path: string, body: unknown): Promise<T> {
		const token = getAuthToken();
		if (!token) throw new Error('Sign in before withdrawing');
		const response = await fetch(apiUrl(path), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			signal: controller.signal,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		});
		return readWithdrawResponse<T>(response);
	}

	async function withdraw() {
		if (submitting || !accountLoaded || !active) return;
		if (!account) { error = 'OWNER_REQUIRED'; return; }
		let exactAmount = amount.trim();
		if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(exactAmount) || !/[1-9]/.test(exactAmount)) {
			error = 'Enter a valid amount';
			return;
		}
		// The backend sends this exact amount for native SOL; the owner proof must sign the same.
		const effective = effectiveWithdrawAmount(chain, asset, exactAmount);
		if (effective.adjusted) {
			exactAmount = effective.amount;
			amount = exactAmount;
			amountNote = `Adjusted to ${exactAmount} SOL, the most this wallet can send: 0.000005 SOL pays the network fee and a smaller remainder cannot stay in the wallet. Press Withdraw again to continue.`;
			error = '';
			return;
		}
		if (!destinationAddress.trim()) {
			error = 'Enter a destination address';
			return;
		}
		if (!isValidWithdrawAddress(chain, destinationAddress)) {
			error = invalidAddressMessage(chain);
			return;
		}

		try {
			toBaseUnits(exactAmount, asset.token.decimals);
		} catch (cause) {
			error = cause instanceof WithdrawParamsError ? cause.code : 'Withdrawal failed';
			return;
		}

		submitting = true;
		error = '';
		try {
			const destination = JSON.stringify(destinationAddress.trim());
			const withdrawalChain = JSON.stringify(chain);
			const request = asset.isNative
				? `{"chain":${withdrawalChain},"withdrawNative":true,"amount":${exactAmount},"destinationAddress":${destination}}`
				: `{"chain":${withdrawalChain},"tokenAddress":${JSON.stringify(asset.token.address)},"amount":${exactAmount},"destinationAddress":${destination}}`;
			await prepare(request, false);
		} catch (cause) {
			if (active && sessionIdentity(getAuthToken()) === initialIdentity) error = errorText(cause);
		} finally {
			submitting = false;
		}
	}

	async function prepare(request: string, isRefresh: boolean) {
		const g = generation;
		const result = await post<PreparedWithdrawal>('/v2/user/wallets/withdraw', request);
		if (!current(g)) return;
		const proofRequest = readWithdrawOwnerProof(result);
		if (proofRequest && chain === 'RH') {
			if (!account?.identity) throw new OwnerProofError('WITHDRAWAL_REVIEW_MISMATCH');
			const review = await reviewRhWithdrawal(result, { chain, amount: amount.trim(), decimals: asset.token.decimals, tokenAddress: asset.isNative ? '0x0000000000000000000000000000000000000000' : asset.token.address, destinationAddress: destinationAddress.trim(), symbol: asset.token.symbol, ...account.identity });
			if (!current(g)) return;
			executionDeadline = review.deadline;
		}
		if (proofRequest === null && account?.provider === 'waas') throw new OwnerProofError('OWNER_PROOF_REQUIRED');
		preparedRequest = request;
		pendingConfirm = null;
		pendingBytes = null;
		restartable = false;
		refreshed = isRefresh;
		prepared = result;
		ownerProof = proofRequest;
		if (proofRequest === null && !hasFeeInfo(result as WalletWithdrawResponse)) await sendConfirm();
	}

	function errorText(cause: unknown): string {
		const code = cause instanceof OwnerProofError || cause instanceof WithdrawHttpError ? cause.code : null;
		if (code === 'OWNER_REQUIRED' || code === 'OWNER_PROOF_REQUIRED') {
			return proofFailure(cause instanceof WithdrawHttpError ? cause.status : null, code).message;
		}
		return withdrawErrorMessage(cause);
	}

	async function sendConfirm() {
		if (prepared === null || !active) return;
		const g = generation;
		if (ownerProof && (ownerProofExpired(ownerProof) || (executionDeadline !== null && BigInt(Math.floor(Date.now() / 1000)) >= BigInt(executionDeadline)) || (prepared.funding && Date.now() >= prepared.funding.expiresAt * 1000))) {
			pendingConfirm = null; pendingBytes = null; restartable = true;
			throw new OwnerProofError('PROOF_EXPIRED');
		}
		if (pendingConfirm === null) {
			if (prepared.funding && Date.now() > prepared.funding.expiresAt * 1000) {
				prepared = null;
				ownerProof = null;
				throw new Error('The fee quote expired. Withdraw again to get a new quote.');
			}
			if (ownerProof !== null) {
				if (ownerProofExpired(ownerProof)) {
					restartable = true;
					throw new OwnerProofError('PROOF_EXPIRED');
				}
				let proof;
				try {
					proof = await getOwnerProof('social_withdraw', ownerProof, { kind: ownerProof.kind, signal: controller.signal });
				} catch (cause) {
					if (cause instanceof OwnerProofError && cause.code === 'OWNER_PROOF_EXPIRED') {
						restartable = true;
						throw new OwnerProofError('PROOF_EXPIRED');
					}
					throw cause;
				}
				if (!current(g)) return;
				if (ownerProofExpired(ownerProof) || (prepared.funding && Date.now() >= prepared.funding.expiresAt * 1000) || (executionDeadline !== null && BigInt(Math.floor(Date.now() / 1000)) >= BigInt(executionDeadline))) {
					restartable = true;
					throw new OwnerProofError('PROOF_EXPIRED');
				}
				pendingConfirm = ownerProofConfirmBody(prepared.transactionToSign, proof, ownerProof.previewId);
			} else {
				const transactionToSign = prepared.transactionToSign;
				const signature = prepared.signatureModel === 'client'
					? await signConnectedWalletMessageHex(transactionToSign)
					: null;
				if (!current(g)) return;
				pendingConfirm = signature === null ? { transactionToSign } : { transactionToSign, signature };
			}
		}
		if (!current(g)) return;
		if (pendingBytes === null) {
			if (pendingConfirm && 'ownerProof' in pendingConfirm) Object.freeze(pendingConfirm.ownerProof);
			Object.freeze(pendingConfirm);
			pendingBytes = JSON.stringify(pendingConfirm);
		}
		try {
			const result = await post<WalletWithdrawConfirmResponse>(
				'/v2/user/wallets/withdraw/confirm',
				pendingBytes
			);
			if (current(g)) oncomplete(result);
		} catch (cause) {
			if (cause instanceof WithdrawHttpError && ownerProof !== null) {
				const failure = proofFailure(cause.status, cause.code ?? '');
				if (failure.restart) {
					pendingConfirm = null;
					pendingBytes = null;
					restartable = true;
					throw new Error(failure.message);
				}
			}
			if (cause instanceof WithdrawHttpError && cause.retryable === false && cause.status >= 400 && cause.status < 500 && cause.status !== 408) {
				pendingConfirm = null;
				pendingBytes = null;
				prepared = null;
				ownerProof = null;
			}
			throw cause;
		}
	}

	async function confirm() {
		if (submitting) return;
		submitting = true;
		error = '';
		try {
			await sendConfirm();
		} catch (cause) {
			if (active && sessionIdentity(getAuthToken()) === initialIdentity) error = errorText(cause);
		} finally {
			submitting = false;
		}
	}

	async function restart() {
		if (submitting || preparedRequest === null) return;
		submitting = true;
		error = '';
		try {
			await prepare(preparedRequest, false);
		} catch (cause) {
			if (active && sessionIdentity(getAuthToken()) === initialIdentity) error = errorText(cause);
		} finally {
			submitting = false;
		}
	}

	function back() {
		if (submitting || pendingConfirm !== null) return;
		prepared = null;
		ownerProof = null;
		restartable = false;
		refreshed = false;
		error = '';
	}
</script>

<div
	use:portal
	class="fixed inset-0 z-[200] cursor-default flex items-center justify-center bg-s0/60 p-4 backdrop-blur-[2px]"
	role="presentation"
	onclick={(event) => { if (event.target === event.currentTarget && !submitting) close(); }}
	onkeydown={(event) => { if (event.key === 'Escape' && !submitting) close(); }}
>
	<div data-testid="wallet-withdraw-modal" class="w-full max-w-md rounded-2xl border border-bd bg-s5 p-5 shadow-2xl backdrop-blur-xl">
		<div class="mb-5 flex items-start justify-between">
			<div>
				<h2 class="text-base font-semibold text-tx">Withdraw {asset.token.symbol}</h2>
				<p class="mt-1 text-xs text-g6">{withdrawSourceLabel(chain)}</p>
			</div>
			<button
				aria-label="Close"
				onclick={close}
				class="cursor-pointer text-g4 transition-colors hover:text-tx disabled:opacity-50"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		{#if prepared === null}
		<div class="space-y-4">
			<div>
				<label for="withdraw-amount" class="text-[10px] font-medium uppercase tracking-wider text-g5">Amount</label>
				<div class="mt-1 flex items-center gap-2">
					<input
						id="withdraw-amount"
						type="text"
						inputmode="decimal"
						bind:value={amount}
						oninput={() => (amountNote = '')}
						placeholder="0"
						class="min-w-0 flex-1 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none"
					/>
					<button
						onclick={setMax}
						class="btn-secondary px-2.5 py-1.5 text-xs"
						title="Withdraw the full balance"
					>
						Max
					</button>
				</div>
				<div class="mt-1 text-[11px] text-g6">Available: {asset.tokensBalance.toLocaleString('en-US', { maximumFractionDigits: 9 })}</div>
				{#if amountNote}
					<div data-testid="wallet-withdraw-amount-note" class="mt-1 text-[11px] text-yel">{amountNote}</div>
				{/if}
			</div>

			<div>
				<label for="withdraw-destination" class="text-[10px] font-medium uppercase tracking-wider text-g5">Destination address</label>
				<input
					id="withdraw-destination"
					type="text"
					bind:value={destinationAddress}
					placeholder={withdrawAddressPlaceholder(chain)}
					class="mt-1 w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none"
				/>
			</div>

			{#if googleEmail}
				<div data-testid="wallet-withdraw-google-email" class="break-all text-xs text-g7">
					Confirm with Google: <span class="font-medium text-tx">{googleEmail}</span>
				</div>
			{/if}

			{#if error}
				<div class="text-xs text-red" data-testid="wallet-withdraw-error">{error}</div>
			{/if}

			<div class="flex gap-2">
				<button onclick={close} disabled={submitting} class="btn-secondary flex-1 px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
				<button
					data-testid="wallet-withdraw-submit"
					onclick={withdraw}
					disabled={submitting || !accountLoaded || !amount || !destinationAddress.trim()}
					class="btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-50"
				>
					{submitting ? 'Withdrawing...' : 'Withdraw'}
				</button>
			</div>
		</div>
		{:else}
		<div data-testid="wallet-withdraw-review" class="space-y-3">
			{#if ownerProof}
				{#if refreshed}
					<div data-testid="owner-proof-refreshed" class="text-xs text-yel">{PROOF_REFRESHED_MESSAGE}</div>
				{/if}
				<OwnerProofMessage preview={ownerProof} />
				{#if ownerProof.kind === 'google' && account?.googleEmail}
					<div data-testid="wallet-withdraw-google-email" class="break-all text-xs text-g7">Confirm with Google: <span class="font-medium text-tx">{account.googleEmail}</span></div>
				{/if}
			{:else}
			<div class="space-y-1 rounded-lg border border-bd bg-s2 p-3 text-xs">
				<div class="text-g7">Amount: {amount.trim()} {asset.token.symbol}</div>
				<div class="break-all text-g7">To: {destinationAddress.trim()}</div>
				{#each feeLines as line}
					<div data-testid="wallet-withdraw-fee-line" class="text-g7">{line}</div>
				{/each}
			</div>
			{/if}
			{#if error}
				<div class="text-xs text-red" data-testid="wallet-withdraw-error">{error}</div>
			{/if}
			<div class="flex gap-2">
				<button onclick={back} disabled={submitting || pendingConfirm !== null} class="btn-secondary flex-1 px-4 py-2 text-sm disabled:opacity-50">Back</button>
				{#if restartable}
					<button data-testid="wallet-withdraw-restart" onclick={restart} disabled={submitting} class="btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-50">Start again</button>
				{:else}
				<button
					data-testid="wallet-withdraw-confirm"
					onclick={confirm}
					disabled={submitting}
					class="btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-50"
				>
					{submitting ? 'Confirming...' : pendingConfirm !== null ? 'Retry confirm' : 'Confirm withdrawal'}
				</button>
				{/if}
			</div>
		</div>
		{/if}
	</div>
</div>
