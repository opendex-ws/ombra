import { api } from '$lib/api/client';
import type { components } from '$lib/api/v2.d.ts';
import type { Chain } from '$lib/api/types';

export type WalletTransferEvent = components['schemas']['WalletTransferEvent'];
export type WalletTransferHistoryResponse = components['schemas']['WalletTransferHistoryResponse'];

const pendingRequests = new Map<string, Promise<WalletTransferHistoryResponse>>();

export function loadWalletTransfers(
	chain: Chain,
	walletAddress: string,
	cursor?: string | null,
	limit = 25
): Promise<WalletTransferHistoryResponse> {
	const key = `${chain}:${walletAddress}:${cursor ?? ''}:${limit}`;
	const existing = pendingRequests.get(key);
	if (existing) return existing;

	const request = api.GET('/v2/traders/{chain}/{walletAddress}/transfers', {
		params: {
			path: { chain, walletAddress },
			query: { cursor: cursor ?? undefined, limit }
		}
	}).then(({ data, error }) => {
		if (error || !data) throw new Error('Unable to load wallet transfer history.');
		return data;
	});

	pendingRequests.set(key, request);
	void request
		.finally(() => {
			if (pendingRequests.get(key) === request) pendingRequests.delete(key);
		})
		.catch(() => {});
	return request;
}
