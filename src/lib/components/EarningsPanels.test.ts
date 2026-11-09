import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('$lib/stores/auth.svelte', () => ({ getAuthToken: () => 'token', refreshToken: vi.fn(async () => null) }));
vi.mock('$lib/api/client', () => ({ api: { POST: mocks.post } }));

import EarningsPanels from './EarningsPanels.svelte';

const summary = {
	byChain: [{ chain: 'SOL', affiliateRevenueUsd: 4 }],
	feeRates: [{ chain: 'SOL', affiliateRate: 0.3, cashbackAvailable: 0.2, cashbackRate: 0.1, systemFeeRate: 1 }],
	topReferrals: [],
	totalRevenueUsd: 4,
	totalRevenueUsdStr: '4',
	withdrawableBalances: [{ chain: 'SOL', address: 'UserSol', balance: 1000 }]
};

const waasClaimSummary = {
	recipient: 'ManagedSol111',
	sol: { availableAtomic: '5000000', availableDisplay: '0.005', reservedAtomic: '0', reservedDisplay: '0', tokenAddress: '', decimals: 9 },
	usdc: { availableAtomic: '0', availableDisplay: '0', reservedAtomic: '0', reservedDisplay: '0', tokenAddress: 'usdc', decimals: 6 },
	status: 'AVAILABLE',
	hasEnoughSol: true,
	requiredLamports: 5000,
	availableLamports: 1000000,
	chains: [{ chain: 'SOL', recipient: 'ManagedSol111', assets: [], gasMode: 'native', estimatedGasCost: { atomic: '5000', display: '0.000005', tokenSymbol: 'SOL' } }]
};

function props(provider: 'waas' | 'turnkey' | null, providerStatus: 'loading' | 'ready' | 'error' = 'ready') {
	return {
		provider,
		providerStatus,
		onRetryProvider: vi.fn(),
		commissionSummary: summary as never,
		feeRate: null,
		managedAddresses: { SOL: 'ManagedSol111' }
	};
}

describe('EarningsPanels', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mocks.post.mockReset();
		mocks.post.mockResolvedValue({ data: { amount: '1000' }, error: undefined });
		fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/v2/referral/withdrawal-summary')) {
				return new Response(JSON.stringify(waasClaimSummary), { status: 200 });
			}
			if (String(url).endsWith('/v2/referral/withdrawals') && init?.method === 'POST') {
				return new Response(JSON.stringify({ idempotencyKey: 'k', recipient: 'ManagedSol111', status: 'FINALIZED' }), { status: 200 });
			}
			return new Response('{}', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('shows a loading state, not the Turnkey panels, while the provider is unknown', () => {
		render(EarningsPanels, props(null, 'loading'));
		expect(screen.getByTestId('earnings-loading')).toBeInTheDocument();
		expect(screen.queryByTestId('earnings-turnkey')).toBeNull();
		expect(screen.queryByTestId('earnings-commission-claim')).toBeNull();
	});

	it('shows a retry, not the Turnkey panels, when the provider lookup failed', () => {
		render(EarningsPanels, props(null, 'error'));
		expect(screen.queryByTestId('earnings-turnkey')).toBeNull();
		expect(screen.getAllByText('Retry').length).toBeGreaterThan(0);
	});

	it('WaaS: claims commission without a signature and never calls a coupon endpoint', async () => {
		render(EarningsPanels, props('waas'));
		expect(screen.getByTestId('earnings-waas')).toBeInTheDocument();
		const cashback = screen.getByTestId('earnings-cashback-claim');
		expect(cashback).toBeDisabled();
		expect(screen.queryByTestId('earnings-cashback-note')).toBeNull();
		await waitFor(() => expect(screen.getByTestId('claim-row-SOL')).toBeInTheDocument());
		expect(screen.getAllByTestId(/^claim-row-/)).toHaveLength(1);
		const claim = screen.getByTestId('earnings-commission-claim');
		await waitFor(() => expect(claim).not.toBeDisabled());
		await fireEvent.click(claim);
		await waitFor(() => expect(screen.getByTestId('claim-status-SOL')).toHaveTextContent('Claimed'));
		await fireEvent.click(cashback);
		expect(mocks.post).not.toHaveBeenCalled();
		const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
		expect(posts.map(([url]) => String(url))).toEqual(['/v2/referral/withdrawals']);
	});

	it('Turnkey: each panel button calls its coupon endpoint for the chains with a balance', async () => {
		render(EarningsPanels, props('turnkey'));
		expect(screen.getByTestId('earnings-turnkey')).toBeInTheDocument();
		await fireEvent.click(screen.getByTestId('earnings-commission-claim'));
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
		expect(mocks.post).toHaveBeenLastCalledWith('/v2/referral/withdraw', { body: { address: 'ManagedSol111', chain: 'SOL' } });
		await waitFor(() => expect(screen.getByTestId('earnings-cashback-claim')).not.toBeDisabled());
		await fireEvent.click(screen.getByTestId('earnings-cashback-claim'));
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
		expect(mocks.post).toHaveBeenLastCalledWith('/v2/referral/cashback', { body: { address: 'ManagedSol111', chain: 'SOL' } });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
