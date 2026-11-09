export const PROOF_EXPIRED_MESSAGE = 'This approval expired before it was used. Start again to get a new one.';
export const PROOF_MISMATCH_MESSAGE = 'This approval does not match the request. Start again and review the new text.';
export const PROOF_REFRESHED_MESSAGE = 'The approval expired, so a new one was loaded. Review it and approve again.';
export const OWNER_REQUIRED_MESSAGE = 'This wallet has no owner approval set up, so this action is blocked. Contact support.';

// Only these mean the signed text differs from what the signer rebuilt; other 403s are policy refusals.
const MISMATCH_CODES = new Set(['OWNER_PROOF_INVALID', 'WAAS_BAD_OWNER_PROOF', 'OWNER_PROOF_NO_WALLET_KEY']);

export interface ProofFailure {
	code: string;
	message: string;
	restart: boolean;
}

export function proofFailure(status: number | null, code: string): ProofFailure {
	if (code === 'WAAS_EXPORT_TURNKEY_USER') {
		return { code, message: 'This wallet is not held by the WaaS signer, so its key cannot be revealed here. (WAAS_EXPORT_TURNKEY_USER)', restart: false };
	}
	if (code === 'WALLET_SIGN_REJECTED') return { code, message: 'The wallet signature was cancelled. Approve the request in your wallet to continue.', restart: false };
	if (code === 'PROOF_EXPIRED' || code === 'OWNER_PROOF_EXPIRED') {
		return { code, message: PROOF_EXPIRED_MESSAGE, restart: true };
	}
	if (code === 'OWNER_REQUIRED' || code === 'OWNER_PROOF_REQUIRED') {
		return { code, message: OWNER_REQUIRED_MESSAGE, restart: false };
	}
	if (status === 403 && MISMATCH_CODES.has(code)) return { code, message: PROOF_MISMATCH_MESSAGE, restart: true };
	return { code, message: code, restart: false };
}
