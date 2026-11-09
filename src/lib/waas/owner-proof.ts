import { authBackendBase } from './auth-base';
import { getAuthToken, getWalletAddress, signConnectedWalletMessageHex } from '$lib/stores/auth.svelte';
import { OwnerPopupError, googleOwnerProofPopup } from './owner-popup';
import { b64uEncode, toHex, utf8Encode } from './bytes';
import { getLoginMethod } from './login-method';

export type OwnerAction = 'export' | 'social_withdraw';
export type OwnerProofKind = 'wallet' | 'google';

export interface OwnerProofPreview {
	message: string;
	ts: number;
	validUntil: number;
	ref: string;
	previewId: string;
}

export interface WalletOwnerProof {
	kind: 'wallet';
	scheme: 'ed25519';
	pubkey: string;
	sig: string;
	ts: number;
}

export interface GoogleOwnerProof {
	kind: 'google';
	id_token: string;
	ts: number;
}

export type OwnerProof = WalletOwnerProof | GoogleOwnerProof;

export const WALLET_SIGN_TIMEOUT_MS = 120_000;

export interface OwnerProofOptions {
	kind?: OwnerProofKind;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export class OwnerProofError extends Error {
	constructor(readonly code: string, detail?: string) {
		super(detail ?? code);
		this.name = 'OwnerProofError';
	}
}

export function readOwnerProofPreview(value: unknown): OwnerProofPreview {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const v = value as Record<string, unknown>;
		if (
			typeof v.message === 'string' &&
			v.message.length > 0 &&
			typeof v.ts === 'number' &&
			Number.isSafeInteger(v.ts) &&
			v.ts > 0 &&
			typeof v.validUntil === 'number' &&
			Number.isSafeInteger(v.validUntil) &&
			Number.isSafeInteger(v.ts + 300) &&
			v.validUntil === v.ts + 300 &&
			typeof v.ref === 'string' &&
			typeof v.previewId === 'string' &&
			/^pv2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v.previewId)
		) {
			const suffix = v.message.match(/\nOwner action v2\nIssued at ([0-9]+) \(([^\n]+)\)\nValid until ([0-9]+) \(([^\n]+)\)\nCommitment SHA-256 ([0-9a-f]{64})\nRef ([0-9a-f]{8})$/);
			const issue = new Date(v.ts * 1000);
			const expiry = new Date(v.validUntil * 1000);
			if (!suffix || (suffix.index ?? -1) + suffix[0].length !== v.message.length || !Number.isFinite(issue.getTime()) || !Number.isFinite(expiry.getTime()) ||
				suffix[1] !== String(v.ts) || suffix[3] !== String(v.validUntil) ||
				suffix[2] !== issue.toISOString().replace('.000Z', 'Z') ||
				suffix[4] !== expiry.toISOString().replace('.000Z', 'Z') ||
				suffix[6] !== suffix[5].slice(0, 8) || v.ref !== suffix[6]) {
				throw new OwnerProofError('OWNER_PROOF_PREVIEW_INVALID');
			}
			return { message: v.message, ts: v.ts, validUntil: v.validUntil, ref: v.ref, previewId: v.previewId };
		}
	}
	throw new OwnerProofError('OWNER_PROOF_PREVIEW_INVALID');
}

export function ownerProofExpired(preview: OwnerProofPreview, nowMs: number = Date.now()): boolean {
	return nowMs < preview.ts * 1000 || nowMs > preview.validUntil * 1000;
}

export function encodeOwnerProof(proof: OwnerProof): string {
	const body =
		proof.kind === 'wallet'
			? { kind: proof.kind, scheme: proof.scheme, pubkey: proof.pubkey, sig: proof.sig, ts: proof.ts }
			: { kind: proof.kind, id_token: proof.id_token, ts: proof.ts };
	return b64uEncode(utf8Encode(JSON.stringify(body)));
}

async function walletProof(preview: OwnerProofPreview): Promise<OwnerProof> {
	const address = getWalletAddress();
	if (!address) throw new OwnerProofError('OWNER_WALLET_MISSING');
	let sig: string;
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new OwnerProofError('WALLET_SIGN_TIMEOUT')), WALLET_SIGN_TIMEOUT_MS);
		});
		sig = (await Promise.race([signConnectedWalletMessageHex(preview.message), timeout])).toLowerCase();
	} catch (error) {
		if (error instanceof OwnerProofError) throw error;
		const walletError = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
		if (walletError?.code === 4001) throw new OwnerProofError('WALLET_SIGN_REJECTED', typeof walletError.message === 'string' ? walletError.message : undefined);
		const detail = typeof walletError?.message === 'string' ? walletError.message : undefined;
		throw new OwnerProofError('WALLET_SIGN_FAILED', detail);
	} finally {
		if (timer !== null) clearTimeout(timer);
	}
	if (!/^[0-9a-f]{128}$/.test(sig)) throw new OwnerProofError('WALLET_SIGN_FAILED');
	let pubkey: string;
	try {
		pubkey = toHex((await import('bs58')).default.decode(address));
	} catch {
		throw new OwnerProofError('OWNER_WALLET_MISSING');
	}
	if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new OwnerProofError('OWNER_WALLET_MISSING');
	if (getWalletAddress() !== address) throw new OwnerProofError('OWNER_WALLET_MISSING');
	if (ownerProofExpired(preview)) throw new OwnerProofError('OWNER_PROOF_EXPIRED');
	return { kind: 'wallet', scheme: 'ed25519', pubkey, sig, ts: preview.ts };
}

export async function getOwnerProof(
	action: OwnerAction,
	preview: OwnerProofPreview,
	opts?: OwnerProofOptions
): Promise<OwnerProof> {
	preview = readOwnerProofPreview(preview);
	if (opts?.signal?.aborted) throw new OwnerProofError('OWNER_PROOF_CANCELLED');
	const method = opts?.kind ?? getLoginMethod();
	if (method === null) throw new OwnerProofError('LOGIN_METHOD_UNKNOWN');
	if (ownerProofExpired(preview)) throw new OwnerProofError('OWNER_PROOF_EXPIRED');
	if (method === 'wallet') {
		const proof = await walletProof(preview);
		if (opts?.signal?.aborted) throw new OwnerProofError('OWNER_PROOF_CANCELLED');
		return proof;
	}
	const token = getAuthToken();
	if (!token) throw new OwnerProofError('SIGN_IN_REQUIRED');
	return googleOwnerProofPopup({
		authOrigin: new URL(authBackendBase()).origin,
		token,
		action,
		preview,
		signal: opts?.signal,
		timeoutMs: opts?.timeoutMs
	}).catch(error => {
		if (error instanceof OwnerPopupError) {
			throw new OwnerProofError(error.code, error.message !== error.code ? error.message : undefined);
		}
		throw new OwnerProofError('OWNER_PROOF_FAILED');
	});
}
