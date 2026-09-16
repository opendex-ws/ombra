import { api } from '$lib/api/client';
import type { components } from '$lib/api/v2.d.ts';
import type { Chain } from '$lib/api/types';

export type FundingAsset = components['schemas']['FundingAsset'];
export type ReadableTimestamp = components['schemas']['ReadableTimestamp'];
export type FundingLabelEvidence = components['schemas']['FundingLabelEvidence'];
export type FundingSourcePreview = components['schemas']['FundingSourcePreview'];
export type FundingSourceBreakdown = components['schemas']['FundingSourceBreakdown'];
export type FundingEvent = components['schemas']['FundingEvent'];
export type WalletFundingSummary = components['schemas']['FundingSummary'];
export type WalletFundingResponse = components['schemas']['WalletFundingResponse'];

const pendingRequests = new Map<string, Promise<WalletFundingResponse>>();

function requestKey(chain: Chain, walletAddress: string, cursor: string | null | undefined, limit: number) {
	return `${chain}:${walletAddress}:${cursor ?? ''}:${limit}`;
}

export function loadWalletFunding(
	chain: Chain,
	walletAddress: string,
	cursor?: string | null,
	limit = 25
): Promise<WalletFundingResponse> {
	const key = requestKey(chain, walletAddress, cursor, limit);
	const existing = pendingRequests.get(key);
	if (existing) return existing;

	const request = api.GET('/v2/traders/{chain}/{walletAddress}/funding', {
		params: {
			path: { chain, walletAddress },
			query: { cursor: cursor ?? undefined, limit }
		}
	}).then(({ data, error }) => {
		if (error || !data) throw new Error('Unable to load wallet funding evidence.');
		return data;
	});

	pendingRequests.set(key, request);
	void request.finally(() => {
		if (pendingRequests.get(key) === request) pendingRequests.delete(key);
	}).catch(() => {});
	return request;
}

export function fundingSourceOf(
	value: { fundingSource?: FundingSourcePreview | null } | null | undefined
): FundingSourcePreview | null {
	return value?.fundingSource ?? null;
}

/**
 * `fundingSource` and `pnlSparkline` are REST-only — the top-traders WS snapshot
 * omits both. A snapshot replaces the rendered rows, so without carrying them
 * across, funding badges and sparklines vanish on the first live update.
 */
export function preserveRestOnlyTraderFields<
	T extends {
		walletAddress: string;
		fundingSource?: FundingSourcePreview | null;
		pnlSparkline?: unknown;
	}
>(current: T[], incoming: T[]): T[] {
	const byWallet = new Map(current.map((item) => [item.walletAddress, item] as const));
	return incoming.map((item) => {
		const previous = byWallet.get(item.walletAddress);
		if (!previous) return item;
		const merged = { ...item };
		if (!merged.fundingSource && previous.fundingSource) merged.fundingSource = previous.fundingSource;
		if (merged.pnlSparkline === undefined && previous.pnlSparkline !== undefined) {
			merged.pnlSparkline = previous.pnlSparkline;
		}
		return merged;
	});
}

