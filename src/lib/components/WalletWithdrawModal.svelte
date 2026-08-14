<script lang="ts">
	import X from 'lucide-svelte/icons/x';
	import { portal } from '$lib/actions/portal';
	import type { Chain, WalletAsset } from '$lib/api/types';
	import { getAuthToken, signConnectedWalletMessageHex } from '$lib/stores/auth.svelte';
	import { apiUrl } from '$lib/api/config';

	let {
		chain,
		asset,
		onclose,
		oncomplete
	}: {
		chain: Chain;
		asset: WalletAsset;
		onclose: () => void;
		oncomplete: (result: { signature: string; status: string }) => void;
	} = $props();

	let amount = $state('');
	let destinationAddress = $state('');
	let submitting = $state(false);
	let error = $state('');

	async function post<T>(path: string, body: unknown): Promise<T> {
		const token = getAuthToken();
		if (!token) throw new Error('Sign in before withdrawing');
		const response = await fetch(apiUrl(path), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		});
		const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
		if (!response.ok) {
			const message = typeof payload.message === 'string'
				? payload.message
				: typeof payload.error === 'string'
					? payload.error
					: 'Withdrawal failed';
			throw new Error(message);
		}
		return payload as T;
	}

	async function withdraw() {
		const exactAmount = amount.trim();
		if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(exactAmount) || !/[1-9]/.test(exactAmount)) {
			error = 'Enter a valid amount';
			return;
		}
		if (!destinationAddress.trim()) {
			error = 'Enter a destination address';
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
			const prepared = await post<{
				transactionToSign: string;
				sourceAddress: string;
				lastValidBlockHeight: number;
			}>('/v2/user/wallets/withdraw', request);
			const signature = await signConnectedWalletMessageHex(prepared.transactionToSign);
			const result = await post<{ signature: string; status: string }>(
				'/v2/user/wallets/withdraw/confirm',
				{ transactionToSign: prepared.transactionToSign, signature }
			);
			oncomplete(result);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Withdrawal failed';
		} finally {
			submitting = false;
		}
	}
</script>

<div
	use:portal
	class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 p-4 backdrop-blur-[2px]"
	role="presentation"
	onclick={(event) => { if (event.target === event.currentTarget && !submitting) onclose(); }}
	onkeydown={(event) => { if (event.key === 'Escape' && !submitting) onclose(); }}
>
	<div class="w-full max-w-md rounded-2xl border border-bd bg-s5 p-5 shadow-2xl backdrop-blur-xl">
		<div class="mb-5 flex items-start justify-between">
			<div>
				<h2 class="text-base font-semibold text-tx">Withdraw {asset.token.symbol}</h2>
				<p class="mt-1 text-xs text-g6">From your managed SOL wallet</p>
			</div>
			<button
				aria-label="Close"
				onclick={onclose}
				disabled={submitting}
				class="cursor-pointer text-g4 transition-colors hover:text-tx disabled:opacity-50"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<div class="space-y-4">
			<div>
				<label for="withdraw-amount" class="text-[10px] font-medium uppercase tracking-wider text-g5">Amount</label>
				<div class="mt-1 flex items-center gap-2">
					<input
						id="withdraw-amount"
						type="text"
						inputmode="decimal"
						bind:value={amount}
						placeholder="0"
						class="min-w-0 flex-1 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none"
					/>
					{#if !asset.isNative}
						<button
							onclick={() => (amount = asset.tokensBalanceStr)}
							class="btn-secondary px-2.5 py-1.5 text-xs"
						>
							Max
						</button>
					{/if}
				</div>
				<div class="mt-1 text-[11px] text-g6">Available: {asset.tokensBalance.toLocaleString('en-US', { maximumFractionDigits: 9 })}</div>
			</div>

			<div>
				<label for="withdraw-destination" class="text-[10px] font-medium uppercase tracking-wider text-g5">Destination address</label>
				<input
					id="withdraw-destination"
					type="text"
					bind:value={destinationAddress}
					placeholder="Solana address"
					class="mt-1 w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none"
				/>
			</div>

			{#if error}
				<div class="text-xs text-red">{error}</div>
			{/if}

			<div class="flex gap-2">
				<button onclick={onclose} disabled={submitting} class="btn-secondary flex-1 px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
				<button
					onclick={withdraw}
					disabled={submitting || !amount || !destinationAddress.trim()}
					class="btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-50"
				>
					{submitting ? 'Confirm in Phantom...' : 'Withdraw'}
				</button>
			</div>
		</div>
	</div>
</div>
