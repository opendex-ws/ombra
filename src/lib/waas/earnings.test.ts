// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/stores/auth.svelte', () => ({ getAuthToken: () => 'token', refreshToken: vi.fn(async () => null) }));

import { claimRows, type AffiliateClaimSummary, type ClaimDeps } from './affiliate-claim';
import {
	COUPON_PATHS,
	cashbackLines,
	claimManaged,
	claimTurnkey,
	earningsRoute,
	managedClaimTargets,
	turnkeyClaimChains
} from './earnings';
import type { components } from '$lib/api/types';

type CommissionSummary = components['schemas']['CommissionSummaryResponse'];
type FeeRate = components['schemas']['FeeRateResponse'];

const CHAINS = ['SOL', 'RH'] as const;

function asset(available: string, tokenAddress = '', decimals = 9) {
	return {
		availableAtomic: available,
		availableDisplay: available,
		reservedAtomic: '0',
		reservedDisplay: '0',
		tokenAddress,
		decimals
	};
}

function feeRate(cashbackAvailable: number): FeeRate {
	return { affiliateRate: 0.3, cashbackAvailable, cashbackRate: 0.1, systemFeeRate: 1 };
}

function commissionSummary(overrides: Partial<CommissionSummary> = {}): CommissionSummary {
	return {
		byChain: [
			{ chain: 'SOL', affiliateRevenueUsd: 12.5 },
			{ chain: 'RH', affiliateRevenueUsd: 3 }
		],
		feeRates: [
			{ chain: 'SOL', ...feeRate(0.25) },
			{ chain: 'RH', ...feeRate(0) }
		],
		topReferrals: [],
		totalRevenueUsd: 15.5,
		totalRevenueUsdStr: '15.5',
		withdrawableBalances: [
			{ chain: 'SOL', address: 'UserWalletSol', balance: 110808671 },
			{ chain: 'RH', address: '0xuser', balance: 0 }
		],
		...overrides
	};
}

const MANAGED = { SOL: 'ManagedSol111', RH: '0xManagedRh' };

function waasSummary(): AffiliateClaimSummary {
	return {
		recipient: 'ManagedSol111',
		sol: asset('5000000'),
		usdc: asset('0', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6),
		status: 'AVAILABLE',
		hasEnoughSol: true,
		requiredLamports: 5000,
		availableLamports: 1_000_000,
		chains: [
			// The backend repeats SOL as chains[0] and nests the gas estimate.
			{
				chain: 'SOL',
				recipient: 'ManagedSol111',
				assets: [asset('5000000')],
				gasMode: 'native',
				estimatedGasCost: { atomic: '5000', display: '0.000005', tokenSymbol: 'SOL' }
			},
			{
				chain: 'BASE',
				recipient: '0xManagedEvm',
				assets: [asset('7000', '0x0000000000000000000000000000000000000000', 18)],
				gasMode: 'stable_sponsored',
				estimatedGasCost: { atomic: '100', display: '0.0001', tokenSymbol: 'USDC' }
			},
			{
				chain: 'RH',
				recipient: '0xManagedEvm',
				assets: [asset('9000', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', 18)],
				gasMode: 'insufficient',
				estimatedGasCost: { atomic: '200', display: '0.0002', tokenSymbol: 'ETH' }
			},
			{
				chain: 'ETH',
				recipient: '0xManagedEvm',
				assets: [asset('0', '0x0000000000000000000000000000000000000000', 18)],
				gasMode: 'native',
				estimatedGasCost: { atomic: '300', display: '0.0003', tokenSymbol: 'ETH' }
			}
		]
	};
}

function claimDeps() {
	const calls: { method: string; path: string; headers: Record<string, string>; body?: string }[] = [];
	const deps: ClaimDeps = {
		request: vi.fn(async (method, path, init) => {
			calls.push({ method, path, headers: init.headers, body: init.body });
			return new Response(
				JSON.stringify({ idempotencyKey: init.headers['Idempotency-Key'], recipient: 'x', status: 'FINALIZED' }),
				{ status: 200 }
			);
		}),
		newKey: (() => {
			let n = 0;
			return () => `key-${++n}`;
		})(),
		sleep: async () => {},
		pollIntervalMs: 0,
		maxPolls: 1
	};
	return { deps, calls };
}

describe('earnings routing', () => {
	it('routes WaaS commission to the managed claim and disables WaaS cashback', () => {
		expect(earningsRoute('waas', 'commission')).toBe('managed');
		expect(earningsRoute('waas', 'cashback')).toBe('unavailable');
	});

	it('routes both Turnkey panels to the coupon endpoints', () => {
		expect(earningsRoute('turnkey', 'commission')).toBe('coupon');
		expect(earningsRoute('turnkey', 'cashback')).toBe('coupon');
	});

	it('claims nothing while the provider is unknown', () => {
		expect(earningsRoute(null, 'commission')).toBe('none');
		expect(earningsRoute(null, 'cashback')).toBe('none');
	});
});

describe('cashback amounts', () => {
	it('reads per-chain cashback from the summary and falls back to the SOL fee rate', () => {
		expect(cashbackLines(commissionSummary(), null, CHAINS)).toEqual([
			{ chain: 'SOL', amount: 0.25, symbol: 'SOL' },
			{ chain: 'RH', amount: 0, symbol: 'ETH' }
		]);
		expect(cashbackLines(null, feeRate(0.5), CHAINS)).toEqual([
			{ chain: 'SOL', amount: 0.5, symbol: 'SOL' },
			{ chain: 'RH', amount: 0, symbol: 'ETH' }
		]);
	});
});

describe('Turnkey claim chains', () => {
	it('claims commission only on chains with a withdrawable balance and a managed wallet', () => {
		expect(turnkeyClaimChains('commission', commissionSummary(), null, CHAINS, MANAGED)).toEqual(['SOL']);
		expect(turnkeyClaimChains('commission', commissionSummary(), null, CHAINS, { RH: '0xManagedRh' })).toEqual([]);
		const both = commissionSummary({
			withdrawableBalances: [
				{ chain: 'SOL', address: 'a', balance: 1 },
				{ chain: 'RH', address: 'b', balance: 2 }
			]
		});
		expect(turnkeyClaimChains('commission', both, null, CHAINS, MANAGED)).toEqual(['SOL', 'RH']);
	});

	it('claims cashback only on chains with cashback available', () => {
		expect(turnkeyClaimChains('cashback', commissionSummary(), null, CHAINS, MANAGED)).toEqual(['SOL']);
		const rhOnly = commissionSummary({
			feeRates: [
				{ chain: 'SOL', ...feeRate(0) },
				{ chain: 'RH', ...feeRate(0.01) }
			]
		});
		expect(turnkeyClaimChains('cashback', rhOnly, null, CHAINS, MANAGED)).toEqual(['RH']);
		expect(turnkeyClaimChains('cashback', null, null, CHAINS, MANAGED)).toEqual([]);
	});

	it('posts one coupon request per chain with the managed address, to the same endpoints as before', async () => {
		const post = vi.fn(async () => ({ amount: '42', error: null }));
		const commission = await claimTurnkey('commission', ['SOL', 'RH'], MANAGED, post);
		expect(post.mock.calls).toEqual([
			['/v2/referral/withdraw', { address: 'ManagedSol111', chain: 'SOL' }],
			['/v2/referral/withdraw', { address: '0xManagedRh', chain: 'RH' }]
		]);
		expect(commission.every((r) => r.ok && r.amount === '42')).toBe(true);

		post.mockClear();
		post.mockResolvedValueOnce({ amount: null, error: 'No balance available to withdraw' } as never);
		const cashback = await claimTurnkey('cashback', ['SOL'], MANAGED, post);
		expect(post.mock.calls).toEqual([['/v2/referral/cashback', { address: 'ManagedSol111', chain: 'SOL' }]]);
		expect(cashback).toEqual([{ chain: 'SOL', ok: false, amount: null, message: 'No balance available to withdraw' }]);
	});
});

describe('WaaS managed commission claim', () => {
	it('builds one row per chain: no duplicate SOL row, nested gas estimate, derived symbols', () => {
		const rows = claimRows(waasSummary());
		expect(rows.map((r) => r.chain)).toEqual(['SOL', 'BASE', 'RH', 'ETH']);
		const base = rows[1];
		expect(base.gasMode).toBe('stable_sponsored');
		expect(base.gasCostDisplay).toBe('0.0001');
		expect(base.gasTokenSymbol).toBe('USDC');
		expect(base.status).toBe('AVAILABLE');
		expect(base.assets[0].symbol).toBe('ETH');
		expect(rows[2].assets[0].symbol).toBe('0x0B...AD73');
		expect(rows[3].status).toBe('EMPTY');
	});

	it('claims every chain with a balance whose gas can be paid, and skips the rest', () => {
		const rows = claimRows(waasSummary());
		expect(managedClaimTargets(rows, {}).map((r) => r.chain)).toEqual(['SOL', 'BASE']);
	});

	it('skips a chain whose claim is already running and resumes one with a kept key', () => {
		const rows = claimRows(waasSummary());
		const running = { chain: 'SOL' as const, phase: 'polling' as const, idempotencyKey: 'k', status: 'SUBMITTED', transactionSignature: null, explorerUrl: null, message: null };
		expect(managedClaimTargets(rows, { SOL: running }).map((r) => r.chain)).toEqual(['BASE']);
		const retry = { ...running, chain: 'ETH' as const, phase: 'retry' as const, idempotencyKey: 'eth-key' };
		expect(managedClaimTargets(rows, { ETH: retry }).map((r) => r.chain)).toEqual(['SOL', 'BASE', 'ETH']);
	});

	it('posts only to the managed withdrawals endpoint, never a coupon endpoint', async () => {
		const { deps, calls } = claimDeps();
		const updates: string[] = [];
		const finals = await claimManaged(claimRows(waasSummary()), {}, deps, (s) => updates.push(`${s.chain}:${s.phase}`));
		expect(finals.map((s) => [s.chain, s.phase])).toEqual([
			['SOL', 'success'],
			['BASE', 'success']
		]);
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v2/referral/withdrawals', 'POST /v2/referral/withdrawals']);
		expect(calls[0].body).toBeUndefined();
		expect(JSON.parse(calls[1].body ?? '{}')).toEqual({ chain: 'BASE' });
		expect(new Set(calls.map((c) => c.headers['Idempotency-Key'])).size).toBe(2);
		for (const path of Object.values(COUPON_PATHS)) {
			expect(calls.some((c) => c.path === path)).toBe(false);
		}
		expect(updates).toContain('SOL:submitting');
	});
});
