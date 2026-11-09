// Earnings panels on the profile page: Commission (affiliate fees) and Cashback.
//
// WaaS users claim commission to the managed wallet without a signature
// (POST /v2/referral/withdrawals, see affiliate-claim.ts). The backend has no
// managed cashback claim, only the signed coupon (POST /v2/referral/cashback), so
// WaaS users see cashback amounts with a disabled Claim button and never call a
// coupon endpoint. Turnkey users keep the coupon endpoints (POST /v2/referral/withdraw
// and /v2/referral/cashback), one call per chain that has a balance.
import type { components } from '$lib/api/types';
import type { SignerProvider } from './signer-provider';
import {
	CLAIM_IN_FLIGHT_STATUSES,
	hasClaimable,
	initialClaimState,
	runClaim,
	type ClaimChain,
	type ClaimDeps,
	type ClaimRow,
	type ClaimState
} from './affiliate-claim';

type CommissionSummary = components['schemas']['CommissionSummaryResponse'];
type FeeRate = components['schemas']['FeeRateResponse'];

export type EarningsKind = 'commission' | 'cashback';
export type EarningsRoute = 'managed' | 'coupon' | 'unavailable' | 'none';

export const COUPON_PATHS = {
	commission: '/v2/referral/withdraw',
	cashback: '/v2/referral/cashback'
} as const;

/** Which claim path a panel uses. Unknown provider: no claim at all (the UI shows a loading state). */
export function earningsRoute(provider: SignerProvider | null, kind: EarningsKind): EarningsRoute {
	if (provider === 'waas') return kind === 'commission' ? 'managed' : 'unavailable';
	if (provider === 'turnkey') return 'coupon';
	return 'none';
}

/** Peg token the cashback amount of a chain is denominated in (backend `peg_as_token`). */
export function cashbackSymbol(chain: string): string {
	if (chain === 'SOL') return 'SOL';
	if (chain === 'BSC') return 'BNB';
	return 'ETH';
}

export interface CashbackLine {
	chain: string;
	amount: number;
	symbol: string;
}

/** Cashback available per chain: commissionSummary.feeRates, with the SOL fee-rate response as fallback. */
export function cashbackLines(
	summary: CommissionSummary | null,
	solFeeRate: FeeRate | null,
	chains: readonly string[]
): CashbackLine[] {
	return chains.map((chain) => {
		const perChain = summary?.feeRates?.find((rate) => rate.chain === chain);
		const raw = perChain?.cashbackAvailable ?? (chain === 'SOL' ? solFeeRate?.cashbackAvailable : undefined);
		const amount = Number(raw ?? 0);
		return { chain, amount: Number.isFinite(amount) && amount > 0 ? amount : 0, symbol: cashbackSymbol(chain) };
	});
}

export interface CommissionLine {
	chain: string;
	earnedUsd: number;
	claimable: boolean;
}

/** Turnkey commission per chain: lifetime revenue and whether a withdrawable fee balance exists. */
export function turnkeyCommissionLines(summary: CommissionSummary | null, chains: readonly string[]): CommissionLine[] {
	return chains.map((chain) => {
		const earned = Number(summary?.byChain?.find((entry) => entry.chain === chain)?.affiliateRevenueUsd ?? 0);
		const claimable = (summary?.withdrawableBalances ?? []).some(
			(balance) => balance.chain === chain && Number(balance.balance) > 0
		);
		return { chain, earnedUsd: Number.isFinite(earned) ? earned : 0, claimable };
	});
}

/** Chains a Turnkey claim button calls the coupon endpoint for: a balance and a managed wallet on that chain. */
export function turnkeyClaimChains(
	kind: EarningsKind,
	summary: CommissionSummary | null,
	solFeeRate: FeeRate | null,
	chains: readonly string[],
	managedAddresses: Partial<Record<string, string>>
): string[] {
	const withBalance =
		kind === 'commission'
			? turnkeyCommissionLines(summary, chains).filter((line) => line.claimable).map((line) => line.chain)
			: cashbackLines(summary, solFeeRate, chains).filter((line) => line.amount > 0).map((line) => line.chain);
	return withBalance.filter((chain) => Boolean(managedAddresses[chain]));
}

/** REWARDS_CLAIMED_CONFIRMED websocket event, as the profile page keeps it. */
export interface ConfirmedReward {
	type: string;
	amount: string;
	chain: string;
	signature: number[];
}

export interface CouponResult {
	chain: string;
	ok: boolean;
	amount: string | null;
	message: string | null;
}

export type CouponPost = (
	path: (typeof COUPON_PATHS)[EarningsKind],
	body: { address: string; chain: string }
) => Promise<{ amount: string | null; error: string | null }>;

/** Turnkey: one coupon request per chain, same body as before ({address: managed address, chain}). */
export async function claimTurnkey(
	kind: EarningsKind,
	chains: readonly string[],
	managedAddresses: Partial<Record<string, string>>,
	post: CouponPost
): Promise<CouponResult[]> {
	const results: CouponResult[] = [];
	for (const chain of chains) {
		const address = managedAddresses[chain];
		if (!address) {
			results.push({ chain, ok: false, amount: null, message: `No managed wallet on ${chain}` });
			continue;
		}
		try {
			const { amount, error } = await post(COUPON_PATHS[kind], { address, chain });
			results.push(error ? { chain, ok: false, amount: null, message: error } : { chain, ok: true, amount, message: null });
		} catch (e) {
			results.push({ chain, ok: false, amount: null, message: e instanceof Error ? e.message : 'Request failed' });
		}
	}
	return results;
}

function inFlight(state: ClaimState | undefined): boolean {
	return state?.phase === 'submitting' || state?.phase === 'polling';
}

/**
 * WaaS commission: the rows one Claim click runs. A row is claimed when it has a
 * claimable balance or an unfinished claim to continue, and its gas can be paid.
 */
export function managedClaimTargets(
	rows: readonly ClaimRow[],
	states: Partial<Record<ClaimChain, ClaimState>>
): ClaimRow[] {
	return rows.filter((row) => {
		if (row.gasMode === 'insufficient') return false;
		const state = states[row.chain];
		if (inFlight(state)) return false;
		const resumable =
			(state?.idempotencyKey ?? null) !== null ||
			(row.pendingIdempotencyKey !== null && CLAIM_IN_FLIGHT_STATUSES.includes(row.status));
		return hasClaimable(row) || resumable;
	});
}

/** Run the managed claim on every target chain (in parallel, one idempotency key per chain). */
export async function claimManaged(
	rows: readonly ClaimRow[],
	states: Partial<Record<ClaimChain, ClaimState>>,
	deps: ClaimDeps,
	onUpdate: (state: ClaimState) => void
): Promise<ClaimState[]> {
	const targets = managedClaimTargets(rows, states);
	return Promise.all(
		targets.map((row) => runClaim(row, states[row.chain] ?? initialClaimState(row), deps, onUpdate))
	);
}
