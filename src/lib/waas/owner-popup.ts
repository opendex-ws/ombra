import type { GoogleOwnerProof, OwnerAction, OwnerProofPreview } from './owner-proof';
import { popupMessage, reviewTicket } from './owner-protocol';
import { b64uEncode, sha256, toHex, utf8Encode } from './bytes';

export class OwnerPopupError extends Error {
	constructor(readonly code: string, detail?: string) {
		super(detail ?? code);
		this.name = 'OwnerPopupError';
	}
}

export const OWNER_POPUP_TIMEOUT_MS = 300_000;

export interface GoogleOwnerPopupInput {
	authOrigin: string;
	token: string;
	action: OwnerAction;
	preview: OwnerProofPreview;
	win?: Window;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export function googleOwnerProofPopup(input: GoogleOwnerPopupInput): Promise<GoogleOwnerProof> {
	const win = input.win ?? window;
	const doFetch = input.fetchImpl ?? fetch;
	const popup = win.open('about:blank', 'waas-owner-proof', 'popup,width=480,height=640');
	if (popup === null) return Promise.reject(new OwnerPopupError('POPUP_BLOCKED'));

	return new Promise<GoogleOwnerProof>((resolve, reject) => {
		let secret = '';
		let settled = false;
		let redeeming = false;
		let ticket = '';
		let callbackOrigin = input.authOrigin;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const finish = (error?: OwnerPopupError, proof?: GoogleOwnerProof) => {
			if (settled) return;
			settled = true;
			if (timer !== null) clearTimeout(timer);
			win.removeEventListener('message', onMessage);
			input.signal?.removeEventListener('abort', abort);
			try {
				popup.close();
			} catch {}
			secret = '';
			if (error) reject(error);
			else if (proof) resolve(proof);
			else reject(new OwnerPopupError('OWNER_PROOF_FAILED'));
		};

		const abort = () => finish(new OwnerPopupError('OWNER_PROOF_CANCELLED'));

		const onMessage = (event: MessageEvent) => {
			if (settled || redeeming) return;
			const message = popupMessage(
				{ origin: event.origin, source: event.source, data: event.data },
				{ authOrigin: callbackOrigin, popup, ticket }
			);
			if (!message) return;
			if (message.type === 'waas-owner-proof:error') {
				finish(
					new OwnerPopupError(
						message.code === 'owner_mismatch' ? 'OWNER_MISMATCH' : 'OWNER_PROOF_FAILED',
						message.code
					)
				);
				return;
			}
			if (message.owner_proof.ts !== input.preview.ts) return;

			redeeming = true;
			void (async () => {
				try {
					const response = await doFetch(`${input.authOrigin}/auth/owner-proof/review/${ticket}/redeem`, {
						method: 'POST',
						credentials: 'omit',
						cache: 'no-store',
						headers: {
							Authorization: `Bearer ${input.token}`,
							'Content-Type': 'application/json',
							'X-Waas-Owner-Review': secret
						},
						body: JSON.stringify({ owner_proof: message.owner_proof }),
						signal: input.signal
					});
					const value: unknown = await response.json().catch(() => null);
					const body = value && typeof value === 'object' && !Array.isArray(value)
						? value as Record<string, unknown>
						: {};
					if (settled) return;
					if (!response.ok) {
						finish(
							new OwnerPopupError(
								typeof body.code === 'string' ? body.code : 'OWNER_PROOF_REDEEM_FAILED'
							)
						);
						return;
					}
					finish(undefined, {
						kind: 'google',
						id_token: message.owner_proof.id_token,
						ts: message.owner_proof.ts
					});
				} catch {
					if (!settled) finish(new OwnerPopupError('OWNER_PROOF_REDEEM_FAILED'));
				}
			})();
		};

		const timeoutMs = input.timeoutMs ?? OWNER_POPUP_TIMEOUT_MS;
		timer = setTimeout(() => finish(new OwnerPopupError('OWNER_PROOF_TIMEOUT')), timeoutMs);
		input.signal?.addEventListener('abort', abort, { once: true });
		if (input.signal?.aborted) {
			abort();
			return;
		}

		void (async () => {
			try {
				secret = b64uEncode(crypto.getRandomValues(new Uint8Array(32)));
				const secretHash = toHex(await sha256(utf8Encode(secret)));
				if (settled) return;

				const response = await doFetch(`${input.authOrigin}/auth/owner-proof/google/start`, {
					method: 'POST',
					credentials: 'omit',
					cache: 'no-store',
					headers: {
						Authorization: `Bearer ${input.token}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						action: input.action,
						message: input.preview.message,
						ts: input.preview.ts,
						preview_id: input.preview.previewId,
						review_secret_hash: secretHash,
						// The server pins this origin in the ticket (it also reads the browser's Origin header and
						// rejects a mismatch); the result is posted only to it.
						openerOrigin: win.location.origin
					}),
					signal: input.signal
				});
				const value: unknown = await response.json().catch(() => null);
				const body = value && typeof value === 'object' && !Array.isArray(value)
					? value as Record<string, unknown>
					: {};
				if (settled) return;
				if (!response.ok) {
					finish(new OwnerPopupError(typeof body.code === 'string' ? body.code : 'OWNER_PROOF_START_FAILED'));
					return;
				}

				let reviewUrl: string;
				try {
					if (typeof body.url !== 'string') throw new Error();
					reviewUrl = body.url;
					// The authenticated API may be proxied through a partner host while the
					// review page and Google callback stay on the backend's fixed origin.
					if (body.callback_origin !== undefined) {
						if (typeof body.callback_origin !== 'string') throw new Error();
						callbackOrigin = body.callback_origin;
					}
					ticket = reviewTicket(reviewUrl, callbackOrigin);
				} catch {
					finish(new OwnerPopupError('OWNER_PROOF_URL_INVALID'));
					return;
				}

				win.addEventListener('message', onMessage);
				popup.location.replace(reviewUrl);
			} catch {
				if (!settled) finish(new OwnerPopupError('OWNER_PROOF_START_FAILED'));
			}
		})();
	});
}
