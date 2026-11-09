import type { components } from '$lib/api/types';
import { apiUrl } from '$lib/api/config';
import { getAuthToken } from '$lib/stores/auth.svelte';
import { formatAtomic } from './withdraw-chain';

type AffiliateFeeAssetBalance = components['schemas']['AffiliateFeeAssetBalance'];
type AffiliateWithdrawalLeg = components['schemas']['AffiliateWithdrawalLeg'];

export const CLAIM_SUMMARY_PATH = '/v2/referral/withdrawal-summary';
export const CLAIM_PATH = '/v2/referral/withdrawals';
export const CLAIM_POLL_INTERVAL_MS = 2000;
export const CLAIM_MAX_POLLS = 90;
export const CLAIM_IN_FLIGHT_STATUSES: readonly string[] = ['PENDING', 'PREPARING', 'SUBMITTED', 'SUBMISSION_UNKNOWN'];
export const CLAIM_INSUFFICIENT_STATUSES: readonly string[] = ['INSUFFICIENT_SOL', 'INSUFFICIENT_GAS_FUNDS'];
export const CLAIM_RETRY_MESSAGE = 'The claim request did not finish. Retry to continue the same claim.';
export const CLAIM_TIMEOUT_MESSAGE = 'The claim is still processing. Check the status again later.';
export const CLAIM_CONFIRMING_MESSAGE = 'Sent on-chain. Final confirmation can take up to 10 minutes.';
export const CLAIM_EMPTY_MESSAGE = 'Nothing to claim on this chain.';
export const CLAIM_SUCCESS_MESSAGE = 'Claimed. Funds are in your managed wallet.';

export type ClaimChain = 'SOL' | 'ETH' | 'BSC' | 'BASE' | 'RH';
export type EvmClaimChain = Exclude<ClaimChain, 'SOL'>;
export type GasMode = 'native' | 'stable_sponsored' | 'insufficient';
export type ClaimAsset = AffiliateFeeAssetBalance & { symbol: string };

export interface EvmClaimSummary {
	chain: EvmClaimChain;
	recipient: string;
	assets: ClaimAsset[];
	status: string;
	gasMode: GasMode;
	estimatedGasCostAtomic: string;
	estimatedGasCostDisplay: string;
	gasTokenSymbol: string;
	pendingIdempotencyKey?: string | null;
	transactionSignature?: string | null;
	explorerUrl?: string | null;
}

/**
 * One `chains` entry as the backend may send it. The backend lists SOL first and
 * nests the gas estimate as `estimatedGasCost: {atomic, display, tokenSymbol}`; its
 * assets carry no symbol. Older drafts used the flat fields of `EvmClaimSummary`.
 */
export type RawChainSummary = Partial<Omit<EvmClaimSummary, 'chain' | 'assets'>> & {
	chain: string;
	assets?: (AffiliateFeeAssetBalance & { symbol?: string | null })[] | null;
	estimatedGasCost?: { atomic?: string | null; display?: string | null; tokenSymbol?: string | null } | null;
};

export type AffiliateClaimSummary = Omit<components['schemas']['AffiliateWithdrawalSummaryResponse'], 'chains'> & {
	chains?: RawChainSummary[] | null;
};

export type AffiliateClaimResponse = components['schemas']['AffiliateWithdrawalResponse'] & {
	chain?: ClaimChain | null;
	legs?: AffiliateWithdrawalLeg[] | null;
};

export interface ClaimRow {
	chain: ClaimChain;
	recipient: string;
	assets: ClaimAsset[];
	status: string;
	gasMode: GasMode;
	gasCostAtomic: string;
	gasCostDisplay: string;
	gasTokenSymbol: string;
	pendingIdempotencyKey: string | null;
	transactionSignature: string | null;
	explorerUrl: string | null;
}

export type ClaimPhase = 'idle' | 'insufficient' | 'submitting' | 'polling' | 'success' | 'failed' | 'retry';

export interface ClaimState {
	chain: ClaimChain;
	phase: ClaimPhase;
	idempotencyKey: string | null;
	status: string | null;
	transactionSignature: string | null;
	explorerUrl: string | null;
	message: string | null;
}

export interface ClaimRequestInit {
	headers: Record<string, string>;
	body?: string;
}

export interface ClaimDeps {
	request: (method: 'GET' | 'POST', path: string, init: ClaimRequestInit) => Promise<Response>;
	newKey: () => string;
	sleep: (ms: number) => Promise<void>;
	pollIntervalMs: number;
	maxPolls: number;
}

const EVM_CLAIM_CHAINS: readonly EvmClaimChain[] = ['ETH', 'BSC', 'BASE', 'RH'];
const ZERO_ADDRESS = /^(0x)?0*$/i;

export function nativeClaimSymbol(chain: ClaimChain): string {
	if (chain === 'SOL') return 'SOL';
	return chain === 'BSC' ? 'BNB' : 'ETH';
}

function assetSymbol(chain: ClaimChain, asset: AffiliateFeeAssetBalance & { symbol?: string | null }): string {
	if (typeof asset.symbol === 'string' && asset.symbol !== '') return asset.symbol;
	const address = asset.tokenAddress ?? '';
	if (ZERO_ADDRESS.test(address)) return nativeClaimSymbol(chain);
	return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function isEvmClaimChain(chain: string): chain is EvmClaimChain {
	return (EVM_CLAIM_CHAINS as readonly string[]).includes(chain);
}

export function claimRows(summary: AffiliateClaimSummary): ClaimRow[] {
	const sol: ClaimRow = {
		chain: 'SOL',
		recipient: summary.recipient,
		assets: [
			{ ...summary.sol, symbol: 'SOL' },
			{ ...summary.usdc, symbol: 'USDC' }
		],
		status: summary.status,
		gasMode: summary.hasEnoughSol ? 'native' : 'insufficient',
		gasCostAtomic: String(summary.requiredLamports),
		gasCostDisplay: formatAtomic(String(summary.requiredLamports), 9),
		gasTokenSymbol: 'SOL',
		pendingIdempotencyKey: summary.pendingIdempotencyKey ?? null,
		transactionSignature: summary.transactionSignature ?? null,
		explorerUrl: summary.explorerUrl ?? null
	};
	const seen = new Set<ClaimChain>(['SOL']);
	const evm: ClaimRow[] = [];
	for (const entry of summary.chains ?? []) {
		// SOL is described by the top-level fields; the backend repeats it as chains[0].
		if (!entry || !isEvmClaimChain(entry.chain) || seen.has(entry.chain)) continue;
		const chain = entry.chain;
		seen.add(chain);
		const assets = (entry.assets ?? []).map((asset) => ({ ...asset, symbol: assetSymbol(chain, asset) }));
		const row: ClaimRow = {
			chain,
			recipient: entry.recipient ?? summary.recipient,
			assets,
			status: '',
			gasMode: entry.gasMode ?? 'native',
			gasCostAtomic: entry.estimatedGasCost?.atomic ?? entry.estimatedGasCostAtomic ?? '0',
			gasCostDisplay: entry.estimatedGasCost?.display ?? entry.estimatedGasCostDisplay ?? '0',
			gasTokenSymbol: entry.estimatedGasCost?.tokenSymbol ?? entry.gasTokenSymbol ?? nativeClaimSymbol(chain),
			pendingIdempotencyKey: entry.pendingIdempotencyKey ?? null,
			transactionSignature: entry.transactionSignature ?? null,
			explorerUrl: entry.explorerUrl ?? null
		};
		row.status = entry.status ?? (hasClaimable(row) ? 'AVAILABLE' : 'EMPTY');
		evm.push(row);
	}
	return [sol, ...evm];
}

export function hasClaimable(row: ClaimRow): boolean {
	return row.assets.some((asset) => /^\d+$/.test(asset.availableAtomic) && /[1-9]/.test(asset.availableAtomic));
}

export function gasModeText(row: ClaimRow): string {
	if (row.gasMode === 'native') {
		return `Gas: about ${row.gasCostDisplay} ${row.gasTokenSymbol}, paid from your managed wallet`;
	}
	if (row.gasMode === 'stable_sponsored') {
		return `Gas: sponsored, about ${row.gasCostDisplay} ${row.gasTokenSymbol} is repaid from your managed wallet`;
	}
	return `Gas: not enough ${row.gasTokenSymbol}, about ${row.gasCostDisplay} ${row.gasTokenSymbol} needed`;
}

export function topUpMessage(row: ClaimRow): string {
	return `Top up your managed wallet ${row.recipient} with at least ${row.gasCostDisplay} ${row.gasTokenSymbol}, then claim again.`;
}

export function destinationText(row: ClaimRow): string {
	return `Funds go to your managed wallet ${row.recipient}.`;
}

export function initialClaimState(row: ClaimRow): ClaimState {
	const inFlight = row.pendingIdempotencyKey && CLAIM_IN_FLIGHT_STATUSES.includes(row.status);
	const insufficient = row.gasMode === 'insufficient' || CLAIM_INSUFFICIENT_STATUSES.includes(row.status);
	return {
		chain: row.chain,
		phase: insufficient ? 'insufficient' : 'idle',
		idempotencyKey: inFlight ? row.pendingIdempotencyKey : null,
		status: row.status,
		transactionSignature: row.transactionSignature,
		explorerUrl: row.explorerUrl,
		message: insufficient ? topUpMessage(row) : null
	};
}

function jsonObject(text: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return null;
	}
	return null;
}

function nonEmpty(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

async function pollClaim(deps: ClaimDeps, key: string): Promise<AffiliateClaimResponse | null> {
	try {
		const poll = await deps.request('GET', `${CLAIM_PATH}/${encodeURIComponent(key)}`, { headers: {} });
		const text = await poll.text();
		if (poll.status < 200 || poll.status >= 300) return null;
		return jsonObject(text) as AffiliateClaimResponse | null;
	} catch {
		return null;
	}
}

export async function runClaim(
	row: ClaimRow,
	previous: ClaimState,
	deps: ClaimDeps,
	onUpdate?: (state: ClaimState) => void
): Promise<ClaimState> {
	const emit = (state: ClaimState): ClaimState => {
		onUpdate?.(state);
		return state;
	};
	if (row.gasMode === 'insufficient') {
		return emit({ ...previous, phase: 'insufficient', idempotencyKey: null, message: topUpMessage(row) });
	}
	if (previous.idempotencyKey === null && row.pendingIdempotencyKey === null && !hasClaimable(row)) {
		return emit({ ...previous, phase: 'failed', idempotencyKey: null, message: CLAIM_EMPTY_MESSAGE });
	}
	const key = previous.idempotencyKey ?? row.pendingIdempotencyKey ?? deps.newKey();
	let transactionSignature: string | null = null;
	let explorerUrl: string | null = null;
	if (previous.idempotencyKey !== null) {
		transactionSignature = previous.transactionSignature;
		explorerUrl = previous.explorerUrl;
	} else if (row.pendingIdempotencyKey !== null) {
		transactionSignature = row.transactionSignature;
		explorerUrl = row.explorerUrl;
	}
	const current = emit({
		chain: row.chain,
		phase: 'submitting',
		idempotencyKey: key,
		status: previous.status,
		transactionSignature,
		explorerUrl,
		message: null
	});
	const retry = (): ClaimState =>
		emit({ ...current, phase: 'retry', idempotencyKey: key, message: CLAIM_RETRY_MESSAGE });

	const init: ClaimRequestInit =
		row.chain === 'SOL'
			? { headers: { 'Idempotency-Key': key } }
			: {
					headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
					body: JSON.stringify({ chain: row.chain })
				};
	let first: Response;
	let firstText: string;
	try {
		first = await deps.request('POST', CLAIM_PATH, init);
		firstText = await first.text();
	} catch {
		return retry();
	}
	if (first.status >= 500) return retry();
	if (first.status >= 400 && first.status < 500) {
		const parsed = jsonObject(firstText);
		const message =
			nonEmpty(parsed?.message) ?? nonEmpty(parsed?.error) ?? `Claim failed (HTTP ${first.status})`;
		return emit({ ...current, phase: 'failed', idempotencyKey: null, message });
	}
	const firstBody = first.status >= 200 && first.status < 300 ? jsonObject(firstText) : null;
	if (firstBody === null) return retry();
	let resp = firstBody as AffiliateClaimResponse;

	for (let attempt = 0; ; attempt += 1) {
		transactionSignature = resp.transactionSignature ?? transactionSignature;
		explorerUrl = resp.explorerUrl ?? explorerUrl;
		const status = resp.status;
		const base = { chain: row.chain, status, transactionSignature, explorerUrl };
		if (status === 'FINALIZED') {
			return emit({ ...base, phase: 'success', idempotencyKey: null, message: null });
		}
		if (CLAIM_INSUFFICIENT_STATUSES.includes(status)) {
			return emit({
				...base,
				phase: 'insufficient',
				idempotencyKey: null,
				message: resp.failureMessage || topUpMessage(row)
			});
		}
		if (CLAIM_IN_FLIGHT_STATUSES.includes(status)) {
			emit({ ...base, phase: 'polling', idempotencyKey: key, message: null });
			if (attempt >= deps.maxPolls) {
				return emit({
					...base,
					phase: 'retry',
					idempotencyKey: key,
					message: transactionSignature ? CLAIM_CONFIRMING_MESSAGE : CLAIM_TIMEOUT_MESSAGE
				});
			}
			await deps.sleep(deps.pollIntervalMs);
			resp = (await pollClaim(deps, key)) ?? resp;
			continue;
		}
		return emit({
			...base,
			phase: 'failed',
			idempotencyKey: null,
			message: resp.failureMessage || resp.failureCode || `Claim ended with status ${status}`
		});
	}
}

export function browserClaimDeps(): ClaimDeps {
	return {
		request: (method, path, init) => {
			const headers: Record<string, string> = { ...init.headers };
			const token = getAuthToken();
			if (token) headers.Authorization = `Bearer ${token}`;
			return fetch(apiUrl(path), { method, headers, body: init.body });
		},
		newKey: () => crypto.randomUUID(),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		pollIntervalMs: CLAIM_POLL_INTERVAL_MS,
		maxPolls: CLAIM_MAX_POLLS
	};
}
