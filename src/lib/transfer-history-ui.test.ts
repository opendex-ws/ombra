import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { loadWalletTransfersMock } = vi.hoisted(() => ({
	loadWalletTransfersMock: vi.fn()
}));

vi.mock('$lib/source-transfers', async (importOriginal) => ({
	...(await importOriginal()),
	loadWalletTransfers: loadWalletTransfersMock
}));

import WalletTransferTimeline from './components/WalletTransferTimeline.svelte';

function transfer(id: string, direction: 'incoming' | 'outgoing' | 'selfTransfer') {
	return {
		id,
		direction,
		sourceAddress: direction === 'incoming' ? 'Source1111111111111111111111111111111111' : 'wallet',
		destinationAddress: direction === 'outgoing' ? 'Destination2222222222222222222222222222' : 'wallet',
		sourceTokenAccount: 'SourceToken111111111111111111111111111111',
		destinationTokenAccount: 'DestinationToken2222222222222222222222222',
		blockTime: { ageSeconds: 0, timestamp: 1_700_000_000_000, timestampStr: '2023-11-14T22:13:20.000Z' },
		slot: 42,
		transactionSignature: `signature-${id}`,
		transactionIndex: 1,
		outerInstructionIndex: 2,
		innerInstructionIndex: 3,
		transferOrdinal: 4,
		amount: '1.25',
		amountRaw: '1250000',
		asset: { assetKind: 'token', mint: 'mint', symbol: 'USDC', decimals: 6 },
		transactionActivity: direction === 'incoming' ? 'transfer' : 'swap',
		transferClass: direction === 'incoming' ? 'direct_transfer' : 'swap_leg',
		confidence: 'high',
		parentProgram: null
	};
}

function page(items: ReturnType<typeof transfer>[], nextCursor: string | null) {
	return {
		walletAddress: 'wallet',
		chain: 'SOL',
		coverageStart: { ageSeconds: 0, timestamp: 1_699_395_200_000, timestampStr: '2023-11-07T22:13:20.000Z' },
		retentionDays: 7,
		items,
		cursor: '',
		prevCursor: null,
		nextCursor
	};
}

afterEach(() => {
	cleanup();
	loadWalletTransfersMock.mockReset();
});

describe('wallet transfer timeline', () => {
	test('lazy-loads all transfer classes and cursor pages', async () => {
		loadWalletTransfersMock
			.mockResolvedValueOnce(page([transfer('incoming', 'incoming')], 'next'))
			.mockResolvedValueOnce(page([transfer('outgoing', 'outgoing')], null));

		render(WalletTransferTimeline, { props: { chain: 'SOL', walletAddress: 'wallet' } });
		expect(loadWalletTransfersMock).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: /Transfer history/ }));
		expect(await screen.findByText('Received')).toBeVisible();
		expect(screen.getByText('+1.25 USDC')).toBeVisible();
		expect(screen.getByText('direct transfer')).toBeVisible();
		expect(loadWalletTransfersMock).toHaveBeenCalledWith('SOL', 'wallet', undefined);

		await fireEvent.click(screen.getByRole('button', { name: 'Load more transfers' }));
		expect(await screen.findByText('Sent')).toBeVisible();
		expect(screen.getByText('−1.25 USDC')).toBeVisible();
		expect(screen.getByText('swap leg')).toBeVisible();
		expect(loadWalletTransfersMock).toHaveBeenLastCalledWith('SOL', 'wallet', 'next');
	});

	test('keeps unsupported chains isolated from the API', async () => {
		render(WalletTransferTimeline, { props: { chain: 'ETH', walletAddress: 'wallet' } });
		await fireEvent.click(screen.getByRole('button', { name: /Transfer history/ }));
		expect(screen.getByText('Transfer history is currently available for Solana wallets.')).toBeVisible();
		await waitFor(() => expect(loadWalletTransfersMock).not.toHaveBeenCalled());
	});
});
