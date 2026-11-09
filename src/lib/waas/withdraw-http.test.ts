import { describe, expect, it } from 'vitest';
import { readWithdrawResponse, WITHDRAW_SYNCING_MESSAGE, WithdrawHttpError } from './withdraw-http';

const reply = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function failure(response: Response): Promise<WithdrawHttpError> {
	try {
		await readWithdrawResponse(response);
	} catch (error) {
		if (error instanceof WithdrawHttpError) return error;
		throw error;
	}
	throw new Error('expected a WithdrawHttpError');
}

describe('readWithdrawResponse 503', () => {
	it('shows the syncing text for the policy-syncing 503', async () => {
		const error = await failure(reply(503, { error: 'Managed capability is still syncing' }));
		expect(error.message).toBe(WITHDRAW_SYNCING_MESSAGE);
		expect(error.retryable).toBe(true);
	});

	it('shows the server reason for any other 503', async () => {
		const error = await failure(reply(503, { error: 'EVM RPC rejected the transaction' }));
		expect(error.message).toBe('EVM RPC rejected the transaction. Try again.');
		expect(error.retryable).toBe(true);
	});

	it('falls back to the syncing text when the 503 has no reason', async () => {
		const error = await failure(new Response('', { status: 503 }));
		expect(error.message).toBe(WITHDRAW_SYNCING_MESSAGE);
	});
});
