<script lang="ts">
	// Profile Referrals: Commission and Cashback side by side (stacked on mobile), one Claim
	// button each. Routing per signer provider lives in $lib/waas/earnings.ts.
	import { untrack } from 'svelte';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import ChainIcon from './ChainIcon.svelte';
	import { api } from '$lib/api/client';
	import type { Chain, CommissionSummaryResponse, ErrorResponse, FeeRateResponse } from '$lib/api/types';
	import { formatUsd } from '$lib/utils/format';
	import { DISPLAY_CHAINS } from '$lib/utils/chains';
	import type { SignerProvider } from '$lib/waas/signer-provider';
	import {
		CLAIM_SUCCESS_MESSAGE,
		CLAIM_SUMMARY_PATH,
		browserClaimDeps,
		claimRows,
		destinationText,
		gasModeText,
		initialClaimState,
		type AffiliateClaimSummary,
		type ClaimChain,
		type ClaimState
	} from '$lib/waas/affiliate-claim';
	import {
		COUPON_PATHS,
		cashbackLines,
		claimManaged,
		claimTurnkey,
		earningsRoute,
		managedClaimTargets,
		turnkeyClaimChains,
		turnkeyCommissionLines,
		type ConfirmedReward,
		type CouponPost,
		type CouponResult,
		type EarningsKind
	} from '$lib/waas/earnings';

	let {
		provider,
		providerStatus,
		onRetryProvider,
		commissionSummary,
		feeRate,
		managedAddresses,
		confirmedReward = null,
		onClaimed
	}: {
		provider: SignerProvider | null;
		providerStatus: 'loading' | 'ready' | 'error';
		onRetryProvider: () => void;
		commissionSummary: CommissionSummaryResponse | null;
		feeRate: FeeRateResponse | null;
		managedAddresses: Partial<Record<string, string>>;
		confirmedReward?: ConfirmedReward | null;
		onClaimed?: () => void;
	} = $props();

	const chains = DISPLAY_CHAINS as readonly string[];
	const commissionRoute = $derived(earningsRoute(provider, 'commission'));
	const cashbackRoute = $derived(earningsRoute(provider, 'cashback'));
	const cashback = $derived(cashbackLines(commissionSummary, feeRate, chains));
	const commissionLines = $derived(turnkeyCommissionLines(commissionSummary, chains));

	// WaaS commission: managed no-signature claim.
	const deps = browserClaimDeps();
	let summary = $state<AffiliateClaimSummary | null>(null);
	let summaryLoading = $state(false);
	let summaryError = $state('');
	let states = $state<Partial<Record<ClaimChain, ClaimState>>>({});
	let managedClaiming = $state(false);
	const rows = $derived(summary ? claimRows(summary) : []);
	const managedTargets = $derived(managedClaimTargets(rows, states));
	const managedBusy = $derived(
		managedClaiming || Object.values(states).some((s) => s?.phase === 'submitting' || s?.phase === 'polling')
	);

	async function loadSummary() {
		summaryLoading = summary === null;
		summaryError = '';
		try {
			const response = await deps.request('GET', CLAIM_SUMMARY_PATH, { headers: {} });
			const text = await response.text();
			if (response.status < 200 || response.status >= 300) throw new Error('summary');
			const parsed: unknown = JSON.parse(text);
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('summary');
			const next = parsed as AffiliateClaimSummary;
			summary = next;
			for (const row of claimRows(next)) {
				const existing = states[row.chain];
				if (!existing || existing.phase === 'idle' || existing.phase === 'insufficient') {
					states[row.chain] = initialClaimState(row);
				}
			}
		} catch {
			summaryError = 'Could not load claimable commission.';
		} finally {
			summaryLoading = false;
		}
	}

	$effect(() => {
		if (commissionRoute !== 'managed') return;
		untrack(() => void loadSummary());
	});

	async function claimCommissionManaged() {
		if (managedBusy || managedTargets.length === 0) return;
		managedClaiming = true;
		try {
			const finals = await claimManaged(rows, states, deps, (s) => {
				states[s.chain] = s;
			});
			for (const final of finals) states[final.chain] = final;
			if (finals.some((s) => s.phase === 'success')) {
				void loadSummary();
				onClaimed?.();
			}
		} finally {
			managedClaiming = false;
		}
	}

	// Turnkey: signed coupons, same endpoints and bodies as before.
	let couponBusy = $state<EarningsKind | null>(null);
	let couponResults = $state<Record<EarningsKind, CouponResult[]>>({ commission: [], cashback: [] });
	const commissionChains = $derived(
		turnkeyClaimChains('commission', commissionSummary, feeRate, chains, managedAddresses)
	);
	const cashbackChains = $derived(turnkeyClaimChains('cashback', commissionSummary, feeRate, chains, managedAddresses));

	const post: CouponPost = async (path, body) => {
		const request = { body: { address: body.address, chain: body.chain as Chain } };
		const { data, error } =
			path === COUPON_PATHS.commission
				? await api.POST('/v2/referral/withdraw', request)
				: await api.POST('/v2/referral/cashback', request);
		if (error) return { amount: null, error: (error as ErrorResponse)?.message ?? 'Withdrawal failed' };
		return { amount: data ? String(data.amount) : null, error: null };
	};

	async function claimCoupons(kind: EarningsKind) {
		if (couponBusy) return;
		const target = kind === 'commission' ? commissionChains : cashbackChains;
		if (target.length === 0) return;
		couponBusy = kind;
		couponResults[kind] = [];
		try {
			couponResults[kind] = await claimTurnkey(kind, target, managedAddresses, post);
			if (couponResults[kind].some((r) => r.ok)) onClaimed?.();
		} finally {
			couponBusy = null;
		}
	}

	function formatAmount(value: number): string {
		return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
	}

	function reservedAtomic(atomic: string): boolean {
		return /[1-9]/.test(atomic);
	}

	const confirmedKind = $derived(
		confirmedReward ? (confirmedReward.type === 'Commission' ? 'commission' : 'cashback') : null
	);
</script>

{#snippet couponResultList(kind: EarningsKind)}
	{#if couponResults[kind].length > 0}
		<div class="space-y-1" data-testid={`earnings-${kind}-results`}>
			{#each couponResults[kind] as result (result.chain)}
				<div class="flex items-center gap-1.5 text-xs {result.ok ? 'text-grn' : 'text-red'}">
					<ChainIcon chain={result.chain} class="h-3.5 w-3.5 text-tx" />
					{#if result.ok}
						Coupon ready{result.amount ? `: ${result.amount}` : ''}
					{:else}
						{result.message}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if confirmedReward && confirmedKind === kind}
		<div class="rounded border border-grn/40 bg-grn/10 p-3 text-xs" data-testid={`earnings-${kind}-confirmed`}>
			<div class="mb-1 font-medium text-grn">{confirmedReward.type} claim confirmed</div>
			<div class="flex items-center gap-1 text-g7">
				<ChainIcon chain={confirmedReward.chain} class="h-3.5 w-3.5 text-tx" />
				Amount: <span class="text-tx">{confirmedReward.amount}</span>
			</div>
		</div>
	{/if}
{/snippet}

{#if providerStatus !== 'ready' || !provider}
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="earnings-loading">
		{#each ['Commission', 'Cashback'] as title (title)}
			<div class="rounded-xl border border-bd bg-s1 p-6">
				<h2 class="mb-3 text-base font-semibold text-tx">{title}</h2>
				{#if providerStatus === 'error'}
					<div class="space-y-2">
						<div class="text-xs text-red">Could not load your wallet type.</div>
						<button class="btn-secondary px-3 py-1.5 text-xs" onclick={onRetryProvider}>Retry</button>
					</div>
				{:else}
					<div class="skeleton h-20 rounded-lg"></div>
				{/if}
			</div>
		{/each}
	</div>
{:else}
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid={`earnings-${provider}`}>
		<!-- Commission -->
		<div data-testid="earnings-commission" class="flex flex-col rounded-xl border border-bd bg-s1 p-6">
			<h2 class="mb-1 text-base font-semibold text-tx">Commission</h2>
			<p class="mb-3 text-xs text-g6">Affiliate fees from the trades of users you referred.</p>

			{#if commissionRoute === 'managed'}
				{#if summaryLoading}
					<div class="skeleton h-20 rounded-lg"></div>
				{:else if summaryError}
					<div class="space-y-2">
						<div data-testid="claim-summary-error" class="text-xs text-red">{summaryError}</div>
						<button class="btn-secondary px-3 py-1.5 text-xs" onclick={() => loadSummary()}>Retry</button>
					</div>
				{:else}
					<div class="space-y-2">
						{#each rows as row (row.chain)}
							{@const claimState = states[row.chain] ?? initialClaimState(row)}
							<div data-testid={`claim-row-${row.chain}`} class="space-y-1.5 rounded-lg border border-bd bg-s2 p-3">
								<div class="flex items-start justify-between gap-3">
									<ChainIcon chain={row.chain} class="mt-0.5 h-4 w-4 text-tx" />
									<div class="text-right">
										{#each row.assets as asset, i (`${asset.symbol}:${i}`)}
											<div data-testid={`claim-amount-${row.chain}-${asset.symbol}`} class="text-sm text-tx">
												{asset.availableDisplay} <span class="text-g7">{asset.symbol}</span>
											</div>
											{#if reservedAtomic(asset.reservedAtomic)}
												<div class="text-[11px] text-g6">{asset.reservedDisplay} {asset.symbol} reserved by a claim in progress</div>
											{/if}
										{/each}
									</div>
								</div>
								<div data-testid={`claim-gas-${row.chain}`} class="text-[11px] text-g7">{gasModeText(row)}</div>
								{#if claimState.phase === 'insufficient'}
									<div data-testid={`claim-topup-${row.chain}`} class="text-xs text-yel">{claimState.message}</div>
								{/if}
								{#if claimState.phase === 'submitting' || claimState.phase === 'polling' || claimState.phase === 'success'}
									<div data-testid={`claim-status-${row.chain}`} class="text-xs {claimState.phase === 'success' ? 'text-grn' : 'text-g7'}">
										{#if claimState.phase === 'submitting'}
											Submitting claim...
										{:else if claimState.phase === 'polling'}
											Claim in progress ({claimState.status})
										{:else}
											{CLAIM_SUCCESS_MESSAGE}
										{/if}
									</div>
								{/if}
								{#if (claimState.phase === 'retry' || claimState.phase === 'failed') && claimState.message}
									<div data-testid={`claim-error-${row.chain}`} class="text-xs text-red">{claimState.message}</div>
								{/if}
								{#if claimState.explorerUrl && (claimState.phase === 'polling' || claimState.phase === 'success' || claimState.phase === 'retry')}
									<a
										data-testid={`claim-tx-${row.chain}`}
										href={claimState.explorerUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex cursor-pointer items-center gap-1 text-xs text-blu hover:underline"
									>
										View transaction <ExternalLink class="h-3 w-3" />
									</a>
								{/if}
							</div>
						{/each}
					</div>
					{#if summary}
						<div data-testid="claim-destination" class="mt-2 break-all text-[11px] text-g6">
							{destinationText(rows[0])}
						</div>
					{/if}
				{/if}
				<div class="mt-auto pt-4">
					<button
						data-testid="earnings-commission-claim"
						class="btn-primary w-full px-4 py-2 text-sm disabled:opacity-50"
						disabled={managedBusy || summaryLoading || managedTargets.length === 0}
						onclick={claimCommissionManaged}
					>
						{managedBusy ? 'Claiming...' : 'Claim'}
					</button>
				</div>
			{:else}
				<div class="space-y-2">
					{#each commissionLines as line (line.chain)}
						<div data-testid={`commission-row-${line.chain}`} class="flex items-center justify-between rounded-lg border border-bd bg-s2 px-3 py-2">
							<ChainIcon chain={line.chain} class="h-4 w-4 text-tx" />
							<div class="text-right">
								<div class="text-sm font-semibold text-grn">{formatUsd(line.earnedUsd)}</div>
								<div class="text-[11px] {line.claimable ? 'text-g7' : 'text-g5'}">
									{line.claimable ? 'Balance ready to claim' : 'Nothing to claim'}
								</div>
							</div>
						</div>
					{/each}
				</div>
				<div class="mt-auto space-y-2 pt-4">
					<button
						data-testid="earnings-commission-claim"
						class="btn-primary w-full px-4 py-2 text-sm disabled:opacity-50"
						disabled={couponBusy !== null || commissionChains.length === 0}
						onclick={() => claimCoupons('commission')}
					>
						{couponBusy === 'commission' ? 'Claiming...' : 'Claim'}
					</button>
					{@render couponResultList('commission')}
				</div>
			{/if}
		</div>

		<!-- Cashback -->
		<div data-testid="earnings-cashback" class="flex flex-col rounded-xl border border-bd bg-s1 p-6">
			<h2 class="mb-1 text-base font-semibold text-tx">Cashback</h2>
			<p class="mb-3 text-xs text-g6">A share of the fees you paid on your own trades.</p>
			<div class="space-y-2">
				{#each cashback as line (line.chain)}
					<div data-testid={`cashback-row-${line.chain}`} class="flex items-center justify-between rounded-lg border border-bd bg-s2 px-3 py-2">
						<ChainIcon chain={line.chain} class="h-4 w-4 text-tx" />
						<div class="text-sm {line.amount > 0 ? 'font-semibold text-grn' : 'text-g6'}">
							{formatAmount(line.amount)} <span class="text-g7">{line.symbol}</span>
						</div>
					</div>
				{/each}
			</div>
			<div class="mt-auto space-y-2 pt-4">
				{#if cashbackRoute === 'unavailable'}
					<button data-testid="earnings-cashback-claim" class="btn-primary w-full px-4 py-2 text-sm disabled:opacity-50" disabled>
						Claim
					</button>
				{:else}
					<button
						data-testid="earnings-cashback-claim"
						class="btn-primary w-full px-4 py-2 text-sm disabled:opacity-50"
						disabled={couponBusy !== null || cashbackChains.length === 0}
						onclick={() => claimCoupons('cashback')}
					>
						{couponBusy === 'cashback' ? 'Claiming...' : 'Claim'}
					</button>
					{@render couponResultList('cashback')}
				{/if}
			</div>
		</div>
	</div>
{/if}
