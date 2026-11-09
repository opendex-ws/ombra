import type { ExportFormat } from './export-preview';
import type { GoogleOwnerProof, OwnerProof, OwnerProofPreview } from './owner-proof';

export const OWNER_FRAME_VERSION = 2;
export const OWNER_POPUP_VERSION = 1;

export type OwnerPopupErrorCode =
	| 'google_exchange_failed'
	| 'nonce_mismatch'
	| 'id_token_invalid'
	| 'owner_mismatch'
	| 'owner_proof_replay';

export type OwnerPopupResult = {
	type: 'waas-owner-proof:result';
	v: 1;
	ticket: string;
	owner_proof: GoogleOwnerProof;
};

export type OwnerPopupFailure = {
	type: 'waas-owner-proof:error';
	v: 1;
	ticket: string;
	code: OwnerPopupErrorCode;
};

export type OwnerPopupMessage = OwnerPopupResult | OwnerPopupFailure;

export interface OwnerFrameInit {
	type: 'owner-frame:init';
	v: 2;
	contextId: string;
	userId: string;
	orgId: string;
	format: ExportFormat;
	token: string;
}

export interface OwnerFrameApprove {
	type: 'owner-frame:approve';
	v: 2;
	contextId: string;
	userId: string;
	orgId: string;
	previewId: string;
	proof: OwnerProof;
}

type FrameIdentity = { v: 2; contextId: string; userId: string; orgId: string };
export type OwnerFrameMessage = FrameIdentity & (
	| { type: 'owner-frame:ready'; targetPublicKey: string; preview: OwnerProofPreview }
	| { type: 'owner-frame:shown' | 'owner-frame:wiped' }
	| { type: 'owner-frame:error'; code: string }
);
export type OwnerFrameWipe = FrameIdentity & { type: 'owner-frame:wipe' };

function canonicalUrl(value: string): URL {
	const url = new URL(value);
	const loopback = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
		url.hostname === '127.0.0.1' || url.hostname === '[::1]';
	if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
		url.username || url.password || url.search || url.hash ||
		(value !== url.href && value !== url.origin)) throw new Error('OWNER_ORIGIN_INVALID');
	return url;
}

/**
 * The open parent policy shared with the server: any https origin, or http on loopback, in canonical
 * origin form, and never the auth origin itself. Returns the origin or null.
 */
export function openParentOrigin(value: unknown, authOrigin: string): string | null {
	if (typeof value !== 'string' || value === '' || value === 'null') return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.origin !== value || url.origin === authOrigin) return null;
	if (!/^(?:[a-z0-9_.-]+|\[[0-9a-f:.]+\])$/.test(url.hostname)) return null;
	const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
	if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.origin;
	return null;
}

export function ownerOrigins(appOrigin: string, authUrl: string, frameUrl: string): {
	app: string; auth: string; frame: string; frameUrl: string;
} {
	try {
		const app = canonicalUrl(appOrigin), auth = canonicalUrl(authUrl), frame = canonicalUrl(frameUrl);
		if (app.pathname !== '/' || auth.pathname !== '/' || frame.pathname !== '/auth/wallet-export/' ||
			auth.origin !== frame.origin || app.origin === auth.origin) throw new Error();
		return { app: app.origin, auth: auth.origin, frame: frame.origin, frameUrl: frame.href };
	} catch {
		throw new Error('OWNER_ORIGIN_INVALID');
	}
}

export function reviewUrl(value: string, authOrigin: string): string {
	try {
		const auth = canonicalUrl(authOrigin), url = canonicalUrl(value);
		if (auth.pathname !== '/' || url.origin !== auth.origin ||
			!/^\/auth\/owner-proof\/review\/[A-Za-z0-9_-]{43}$/.test(url.pathname)) throw new Error();
		return value;
	} catch {
		throw new Error('OWNER_PROOF_URL_INVALID');
	}
}

export function reviewTicket(url: string, authOrigin: string): string {
	const checkedUrl = reviewUrl(url, authOrigin);
	return checkedUrl.slice(checkedUrl.lastIndexOf('/') + 1);
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
	return Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const ownerPopupErrorCodes: ReadonlySet<string> = new Set([
	'google_exchange_failed', 'nonce_mismatch', 'id_token_invalid', 'owner_mismatch', 'owner_proof_replay'
]);

function isOwnerPopupErrorCode(value: unknown): value is OwnerPopupErrorCode {
	return typeof value === 'string' && ownerPopupErrorCodes.has(value);
}

export function popupMessage(
	event: { origin: string; source: unknown; data: unknown },
	expected: { authOrigin: string; popup: unknown; ticket: string }
): OwnerPopupMessage | null {
	if (
		event.origin !== expected.authOrigin || event.source === null || event.source !== expected.popup || !record(event.data)
	) return null;
	const data = event.data;
	if (data.v !== OWNER_POPUP_VERSION || data.ticket !== expected.ticket) return null;

	if (data.type === 'waas-owner-proof:result') {
		if (!exact(data, ['type', 'v', 'ticket', 'owner_proof']) || !record(data.owner_proof)) return null;
		const proof = data.owner_proof;
		if (
			!exact(proof, ['kind', 'id_token', 'ts']) || proof.kind !== 'google' ||
			typeof proof.id_token !== 'string' ||
			!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(proof.id_token) ||
			typeof proof.ts !== 'number' || !Number.isSafeInteger(proof.ts) || proof.ts <= 0
		) return null;
		return {
			type: 'waas-owner-proof:result',
			v: OWNER_POPUP_VERSION,
			ticket: data.ticket,
			owner_proof: { kind: 'google', id_token: proof.id_token, ts: proof.ts }
		};
	}

	if (data.type === 'waas-owner-proof:error') {
		if (!exact(data, ['type', 'v', 'ticket', 'code']) || !isOwnerPopupErrorCode(data.code)) return null;
		return {
			type: 'waas-owner-proof:error',
			v: OWNER_POPUP_VERSION,
			ticket: data.ticket,
			code: data.code
		};
	}

	return null;
}

function identity(contextId: string, userId: string, orgId: string): boolean {
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	return typeof contextId === 'string' && /^[0-9a-f]{64}$/.test(contextId) &&
		typeof userId === 'string' && uuid.test(userId) && typeof orgId === 'string' && uuid.test(orgId);
}

function previewValid(value: unknown): boolean {
	if (!record(value) || !exact(value, ['message', 'ts', 'validUntil', 'ref', 'previewId'])) return false;
	return typeof value.message === 'string' && value.message.length > 0 &&
		typeof value.ts === 'number' && Number.isSafeInteger(value.ts) && value.ts > 0 &&
		typeof value.validUntil === 'number' && Number.isSafeInteger(value.validUntil) && value.validUntil === value.ts + 300 &&
		typeof value.ref === 'string' && /^[0-9a-f]{8}$/.test(value.ref) &&
		typeof value.previewId === 'string' && /^pv2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.previewId);
}

const frameErrors = new Set([
	'EXPORT_FRAME_CONTEXT_INVALID', 'EXPORT_FRAME_SESSION_FAILED', 'EXPORT_PREVIEW_FAILED',
	'OWNER_PROOF_PREVIEW_INVALID', 'OWNER_PROOF_EXPIRED', 'PROOF_EXPIRED',
	'WAAS_OWNER_REVIEW_CSRF', 'WAAS_EXPORT_FRAME_INVALID', 'SIGN_IN_REQUIRED',
	'BUNDLE_FORMAT_INVALID', 'BUNDLE_SIGNER_UNKNOWN', 'BUNDLE_SIGNATURE_INVALID', 'BUNDLE_DECRYPT_FAILED'
]);

export function validFrameMessage(value: unknown, contextId: string, userId: string, orgId: string): boolean {
	if (!identity(contextId, userId, orgId) || !record(value) || value.v !== 2 ||
		value.contextId !== contextId || value.userId !== userId || value.orgId !== orgId) return false;
	const base = ['type', 'v', 'contextId', 'userId', 'orgId'];
	switch (value.type) {
		case 'owner-frame:ready':
			return exact(value, [...base, 'targetPublicKey', 'preview']) &&
				typeof value.targetPublicKey === 'string' && /^04[0-9a-f]{128}$/.test(value.targetPublicKey) && previewValid(value.preview);
		case 'owner-frame:shown':
		case 'owner-frame:wiped': return exact(value, base);
		case 'owner-frame:error': return exact(value, [...base, 'code']) && typeof value.code === 'string' && frameErrors.has(value.code);
		default: return false;
	}
}

export function frameInit(contextId: string, userId: string, orgId: string, format: ExportFormat, token: string): OwnerFrameInit {
	if (!identity(contextId, userId, orgId) || !['MNEMONIC', 'SOLANA_PRIVATE_KEY', 'EVM_PRIVATE_KEY'].includes(format) ||
		typeof token !== 'string' || !token.length) throw new Error('EXPORT_FRAME_CONTEXT_INVALID');
	return { type: 'owner-frame:init', v: 2, contextId, userId, orgId, format, token };
}

export function frameApprove(contextId: string, userId: string, orgId: string, previewId: string, proof: OwnerProof): OwnerFrameApprove {
	if (!identity(contextId, userId, orgId) || typeof previewId !== 'string' ||
		!/^pv2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(previewId) || !record(proof) ||
		!Number.isSafeInteger(proof.ts) || proof.ts <= 0) throw new Error('EXPORT_FRAME_CONTEXT_INVALID');
	const valid = proof.kind === 'google'
		? exact(proof, ['kind', 'id_token', 'ts']) && typeof proof.id_token === 'string' && proof.id_token.length > 0
		: proof.kind === 'wallet' && exact(proof, ['kind', 'scheme', 'pubkey', 'sig', 'ts']) &&
			proof.scheme === 'ed25519' && /^[0-9a-f]{64}$/.test(proof.pubkey) && /^[0-9a-f]{128}$/.test(proof.sig);
	if (!valid) throw new Error('EXPORT_FRAME_CONTEXT_INVALID');
	return { type: 'owner-frame:approve', v: 2, contextId, userId, orgId, previewId, proof };
}
