import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import FundingSourcePreview from './components/FundingSourcePreview.svelte';
import FundingEntityIcon from './components/FundingEntityIcon.svelte';
import WalletFundingPanel from './components/WalletFundingPanel.svelte';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('$lib/api/client', () => ({
	api: { GET: apiGet }
}));

import {
	loadWalletFunding,
	preserveFundingSources,
	type FundingSourcePreview as Preview
} from './source-funds';

const preview: Preview = {
	sourceAddress: 'Immediate1111111111111111111111111111111',
	attributedAddress: 'Origin222222222222222222222222222222222',
	label: 'Example Exchange',
	entityType: 'cex',
	provider: 'catalog',
	confidence: '0.975',
	hopCount: 2,
	fundingTime: {
		ageSeconds: 90,
		timestamp: Date.now() - 90_000,
		timestampStr: new Date(Date.now() - 90_000).toISOString()
	},
	amount: '1234.567890',
	asset: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9 },
	transactionSignature: 'tx-signature'
};

const emptyResponse = {
	chain: 'solana',
	walletAddress: 'wallet',
	summary: null,
	items: [],
	cursor: null,
	nextCursor: null
};

function fundingItem(id: string, sourceAddress: string) {
	return {
		id,
		sourceAddress,
		destinationAddress: 'destination',
		amount: '1.000000000',
		asset: { mint: null, symbol: 'SOL', decimals: 9 },
		blockTime: {
			ageSeconds: 1,
			timestamp: Date.now() - 1000,
			timestampStr: new Date(Date.now() - 1000).toISOString()
		},
		slot: 1,
		transactionSignature: `signature-${id}`,
		transactionIndex: 0,
		outerInstructionIndex: 0,
		innerInstructionIndex: -1,
		transferOrdinal: 0,
		confidence: 'high',
		labelEvidence: {
			address: sourceAddress,
			label: `Label ${id}`,
			entityType: 'cex',
			provider: 'catalog',
			confidence: '0.875'
		}
	};
}

function fundingSummary() {
	const first = fundingItem('first', 'FirstSource111111111111111111111111111');
	return {
		firstFunding: first,
		latestFunding: first,
		attributedOrigin: null,
		attributedSource: {
			sourceAddress: 'Immediate1111111111111111111111111111111',
			attributedAddress: 'Origin222222222222222222222222222222222',
			label: 'Example Exchange',
			entityType: 'cex',
			provider: 'catalog',
			confidence: '0.975',
			hopCount: 2,
			fundingTime: first.blockTime,
			amount: '3.5',
			asset: { mint: null, symbol: 'SOL', decimals: 9 },
			transactionSignature: 'summary-signature'
		},
		distinctSourceCount: 3,
		coverageStart: first.blockTime,
		sourceBreakdown: [
			{
				sourceAddress: 'BinanceSource11111111111111111111111111',
				label: 'Binance',
				entityType: 'cex',
				provider: 'catalog',
				transferCount: 2,
				sourceCount: 1,
				amount: '3.5',
				asset: { mint: null, symbol: 'SOL', decimals: 9 },
				isOther: false
			},
			{
				sourceAddress: null,
				label: 'Other sources',
				entityType: null,
				provider: null,
				transferCount: 1,
				sourceCount: 2,
				amount: '12',
				asset: { mint: 'USDC', symbol: 'USDC', decimals: 6 },
				isOther: true
			}
		]
	};
}

afterEach(cleanup);

beforeEach(() => {
	apiGet.mockReset();
});

describe('source funds UI', () => {
	test('uses bundled local brand assets and monograms only for unknown labels', () => {
		const kraken = render(FundingEntityIcon, {
			props: { label: 'Kraken 1', entityType: 'CEX' }
		});
		expect(kraken.container.querySelector('img')).toHaveAttribute('src', '/entity-icons/kraken.webp');
		kraken.unmount();

		const axiom = render(FundingEntityIcon, {
			props: { label: 'AxiomBot2', entityType: 'INTERFACE' }
		});
		expect(axiom.container.querySelector('img')).toHaveAttribute('src', '/entity-icons/axiom.webp');
		axiom.unmount();

		const unknown = render(FundingEntityIcon, {
			props: { label: 'Future Provider', entityType: 'CEX' }
		});
		expect(unknown.getByText('FP')).toBeVisible();
		expect(unknown.container.querySelector('img')).toBeNull();
	});
	test('holders_funding_ui renders compact amount, asset, relative time, and a stable null', () => {
		const unavailable = render(FundingSourcePreview, {
			props: { chain: 'solana', fundingSource: null, compact: true }
		});
		expect(screen.getByLabelText('Funding source unavailable')).toHaveTextContent('—');
		unavailable.unmount();

		render(FundingSourcePreview, {
			props: { chain: 'solana', fundingSource: preview, compact: true }
		});
		expect(screen.getAllByText('1234.567890 SOL')[0]).toBeVisible();
		expect(screen.getAllByText(/ago$/)[0]).toBeVisible();
		expect(screen.getByRole('link', { name: /Open funding source Example Exchange/ })).toBeVisible();
		expect(document.querySelector('[data-funding-icon="cex"]')).toBeTruthy();
	});

	test('top_traders_funding_ui shows the attributed path without confidence', () => {
		render(FundingSourcePreview, {
			props: { chain: 'solana', fundingSource: preview }
		});

		const tooltip = screen.getByRole('tooltip');
		expect(tooltip).toHaveTextContent('Via wallet');
		expect(tooltip).toHaveTextContent('2 hops');
		expect(tooltip).not.toHaveTextContent('97.5%');
		expect(screen.queryByText('upstream')).not.toBeInTheDocument();

		for (const link of screen.getAllByRole('link')) {
			expect(link).toHaveAttribute('aria-describedby', tooltip.id);
		}
	});

	test('top_traders_funding_ui preserves REST enrichment across sparse WS snapshots', () => {
		const current = [
			{ walletAddress: 'wallet-a', fundingSource: preview, pnl: '1' },
			{ walletAddress: 'wallet-b', fundingSource: null, pnl: '2' }
		];
		const incoming = [
			{ walletAddress: 'wallet-a', fundingSource: null, pnl: '3' },
			{ walletAddress: 'wallet-b', fundingSource: null, pnl: '4' }
		];

		const merged = preserveFundingSources(current, incoming);

		expect(merged[0]).toMatchObject({ pnl: '3', fundingSource: preview });
		expect(merged[1]).toMatchObject({ pnl: '4', fundingSource: null });
	});

	test('wallet_funding_detail_ui coalesces identical requests but separates limits', async () => {
		apiGet.mockResolvedValue({ data: emptyResponse });

		const first = loadWalletFunding('SOL', 'wallet', 'cursor', 25);
		const duplicate = loadWalletFunding('SOL', 'wallet', 'cursor', 25);
		const differentLimit = loadWalletFunding('SOL', 'wallet', 'cursor', 50);

		expect(duplicate).toBe(first);
		expect(differentLimit).not.toBe(first);
		await Promise.all([first, duplicate, differentLimit]);
		expect(apiGet).toHaveBeenCalledTimes(2);
		expect(apiGet.mock.calls[0][1].params.query.limit).toBe(25);
		expect(apiGet.mock.calls[1][1].params.query.limit).toBe(50);
	});

	test('wallet_funding_detail_ui renders a bounded source distribution and hides raw rows', async () => {
		apiGet.mockResolvedValueOnce({
			data: {
				...emptyResponse,
				summary: fundingSummary(),
				items: [fundingItem('first', 'FirstSource111111111111111111111111111')]
			}
		});

		render(WalletFundingPanel, { props: { chain: 'SOL', walletAddress: 'wallet' } });
		await fireEvent.click(screen.getByRole('button', { name: /Funding history/ }));

		expect(await screen.findByRole('img', { name: 'Funding distribution across 2 sources' })).toBeVisible();
		expect(screen.getByText('66.7%')).toBeVisible();
		expect(screen.getByText(/2 deposits/)).toBeVisible();
		expect(screen.getByText(/3\.5 SOL/)).toBeVisible();
		expect(screen.queryByLabelText(/Open funding source Label first/)).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /Raw deposit evidence/ }));
		expect(screen.getByLabelText(/Open funding source Label first/)).toBeVisible();
	});

	test('wallet_funding_detail_ui shows the resolved attributed path when available', async () => {
		apiGet.mockResolvedValueOnce({
			data: {
				...emptyResponse,
				summary: fundingSummary(),
				items: [fundingItem('first', 'FirstSource111111111111111111111111111')]
			}
		});

		render(WalletFundingPanel, { props: { chain: 'SOL', walletAddress: 'wallet' } });
		await fireEvent.click(screen.getByRole('button', { name: /Funding history/ }));

		expect(await screen.findByText('2 hops upstream')).toBeVisible();
		expect(screen.getByText(/via direct sender Immedi\.\.\.1111/)).toBeVisible();
		expect(screen.getAllByText('Example Exchange').length).toBeGreaterThan(0);
	});

	test('wallet_funding_detail_ui renders empty and failure states through real interaction', async () => {
		apiGet.mockResolvedValueOnce({ data: emptyResponse });
		const view = render(WalletFundingPanel, {
			props: { chain: 'SOL', walletAddress: 'wallet' }
		});

		await fireEvent.click(screen.getByRole('button', { name: /Funding history/ }));
		expect(await screen.findByText('No retained funding deposits for this wallet.')).toBeVisible();

		apiGet.mockResolvedValueOnce({ error: { status: 503 } });
		await fireEvent.click(screen.getByRole('button', { name: 'Refresh funding history' }));
		expect(await screen.findByText('Unable to load wallet funding evidence.')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();

		view.unmount();
		await waitFor(() => expect(screen.queryByLabelText('Wallet funding evidence')).not.toBeInTheDocument());
	});

	test('wallet_funding_detail_ui rejects a stale response after the target changes', async () => {
		let resolveOld!: (value: unknown) => void;
		let resolveNew!: (value: unknown) => void;
		apiGet
			.mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
			.mockReturnValueOnce(new Promise((resolve) => (resolveNew = resolve)));

		const view = render(WalletFundingPanel, {
			props: { chain: 'SOL', walletAddress: 'wallet-old' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /Funding history/ }));
		await view.rerender({ chain: 'SOL', walletAddress: 'wallet-new' });
		await fireEvent.click(screen.getByRole('button', { name: /Funding history/ }));

		resolveNew({
			data: {
				...emptyResponse,
				walletAddress: 'wallet-new',
				items: [fundingItem('new', 'NewSource111111111111111111111111111111')]
			}
		});
		await fireEvent.click(await screen.findByRole('button', { name: /Raw deposit evidence/ }));
		expect(await screen.findByLabelText(/Open funding source Label new/)).toBeVisible();

		resolveOld({
			data: {
				...emptyResponse,
				walletAddress: 'wallet-old',
				items: [fundingItem('old', 'OldSource111111111111111111111111111111')]
			}
		});
		await waitFor(() => expect(screen.queryByLabelText(/Open funding source Label old/)).not.toBeInTheDocument());
	});

	test('wallet_funding_detail_ui merges keyset pages in response order', async () => {
		apiGet
			.mockResolvedValueOnce({
				data: {
					...emptyResponse,
					items: [fundingItem('first', 'FirstSource111111111111111111111111111')],
					nextCursor: 'next-page'
				}
			})
			.mockResolvedValueOnce({
				data: {
					...emptyResponse,
					items: [fundingItem('second', 'SecondSource2222222222222222222222222')]
				}
			});

		render(WalletFundingPanel, { props: { chain: 'SOL', walletAddress: 'wallet' } });
		await fireEvent.click(screen.getByRole('button', { name: /Funding history/ }));
		await fireEvent.click(await screen.findByRole('button', { name: /Raw deposit evidence/ }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Load more deposits' }));

		expect(await screen.findByLabelText(/Open funding source Label second/)).toBeVisible();
		const links = screen.getAllByRole('link', { name: /Open funding source/ });
		expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
			expect.stringContaining('Label first'),
			expect.stringContaining('Label second')
		]);
		expect(apiGet.mock.calls[1][1].params.query.cursor).toBe('next-page');
	});

	test('wallet_funding_detail_ui keeps loaded rows, omits confidence, and reports load-more failure', async () => {
		apiGet
			.mockResolvedValueOnce({
				data: {
					...emptyResponse,
					items: [fundingItem('first', 'FirstSource111111111111111111111111111')],
					nextCursor: 'next-page'
				}
			})
			.mockResolvedValueOnce({ error: { status: 503 } });

		render(WalletFundingPanel, { props: { chain: 'SOL', walletAddress: 'wallet' } });
		await fireEvent.click(screen.getByRole('button', { name: /Funding history/ }));
		await fireEvent.click(await screen.findByRole('button', { name: /Raw deposit evidence/ }));
		expect(await screen.findByLabelText(/Open funding source Label first/)).toBeVisible();
		expect(screen.queryByText('Edge: High')).not.toBeInTheDocument();
		expect(screen.queryByText('Label: 87.5%')).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Load more deposits' }));

		expect(await screen.findByText('Unable to load wallet funding evidence.')).toBeVisible();
		expect(screen.getByLabelText(/Open funding source Label first/)).toBeVisible();
		expect(screen.getByRole('button', { name: 'Load more deposits' })).toBeVisible();
	});
});
