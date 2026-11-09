import { decryptExportBundle, ExportBundleError } from '../../src/lib/waas/export-bundle';
import { frameInit, frameApprove, openParentOrigin, type OwnerFrameInit, type OwnerFrameMessage } from '../../src/lib/waas/owner-protocol';
import type { OwnerProofPreview } from '../../src/lib/waas/owner-proof';
import { toHex } from '../../src/lib/waas/bytes';

export type FrameOutMessage = OwnerFrameMessage;

export type FrameMessageEvent = { source: unknown; origin: string; data: unknown };

export type ExportFrameOptions = {
	root: HTMLElement;
	parent: unknown;
	post: (message: FrameOutMessage, targetOrigin: string) => void;
	signers: readonly string[];
	authOrigin: string;
	clipboard?: { writeText(text: string): Promise<void> };
	// Called once the key is wiped and no clipboard clear is pending; main.ts discards the page.
	discard?: () => void;
};

export type ExportFrame = {
	ready: Promise<void>;
	receive(event: FrameMessageEvent): Promise<void>;
	destroy(): void;
};

export const HOLD_MS = 2_000;
export const EXPIRE_MS = 60_000;
export const COPIED_MS = 2_000;
export const CLIPBOARD_CLEAR_MS = 60_000;

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTTP_ERRORS = new Set(['WAAS_OWNER_REVIEW_CSRF', 'WAAS_EXPORT_FRAME_INVALID', 'PROOF_EXPIRED']);
const WARNING = 'Anyone with this key controls the wallet. Never share it.';
const SAFETY_NOTE = 'For your security, the key hides after 60 seconds and is cleared from your clipboard 60 seconds after you copy it. Close this tab once your key is saved.';
const HOLD_REST = 'absolute inset-y-0 left-0 bg-grn/20 w-0';
const HOLD_HELD = 'absolute inset-y-0 left-0 bg-grn/20 w-full transition-[width] duration-[2000ms] ease-linear';

type FrameState = 'waiting' | 'decrypting' | 'shown' | 'done';

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
	return el;
}

function icon(...children: SVGElement[]): SVGElement {
	const svg = svgEl('svg', {
		class: 'h-4 w-4',
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': '2',
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round'
	});
	svg.append(...children);
	return svg;
}

function copyIcon(): SVGElement {
	return icon(
		svgEl('rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }),
		svgEl('path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' })
	);
}

function checkIcon(): SVGElement {
	return icon(svgEl('path', { d: 'M20 6 9 17l-5-5' }));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createExportFrame(options: ExportFrameOptions): ExportFrame {
	const clipboard = options.clipboard ?? navigator.clipboard;
	let state: FrameState = 'waiting';
	let parentOrigin: string | null = null;
	let pair: CryptoKeyPair | null = null;
	let publicRaw: Uint8Array | null = null;
	let secret: string | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let expireTimer: ReturnType<typeof setTimeout> | null = null;
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	// Not cleared by teardown: the clipboard keeps the key after the frame hides it.
	let clipboardTimer: ReturnType<typeof setTimeout> | null = null;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;
	let discardPending = false;
	let secretEl: HTMLElement | null = null;
	let copyButton: HTMLButtonElement | null = null;

	let generation = 0;
	let init: OwnerFrameInit | null = null;
	let token = '';
	let frameSession = '';
	let sessionExpiry = 0;
	let preview: OwnerProofPreview | null = null;
	let deadline = 0;
	const abort = new AbortController();
	const ready = Promise.resolve();

	function postToParent(message: { type: 'owner-frame:ready'; targetPublicKey: string; preview: OwnerProofPreview } | { type: 'owner-frame:shown' | 'owner-frame:wiped' } | { type: 'owner-frame:error'; code: string }): void {
		if (parentOrigin && init) options.post({ ...message, v: 2, contextId: init.contextId, userId: init.userId, orgId: init.orgId }, parentOrigin);
	}

	function current(g: number): void {
		if (g !== generation || state === 'done') throw new Error('EXPORT_FRAME_CONTEXT_INVALID');
	}

	async function request(path: string, body: unknown, g: number): Promise<Record<string, unknown>> {
		const res = await fetch(options.authOrigin + path, {
			method: 'POST', credentials: 'omit', mode: 'cors',
			redirect: 'error', cache: 'no-store', signal: abort.signal,
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				...(frameSession ? { 'X-Waas-Frame-Session': frameSession } : {})
			},
			body: JSON.stringify(body)
		});
		current(g);
		const value: unknown = await res.json();
		current(g);
		if (!res.ok || !isRecord(value)) {
			const code = isRecord(value) && typeof value.code === 'string' && HTTP_ERRORS.has(value.code) ? value.code : 'EXPORT_FRAME_SESSION_FAILED';
			throw new Error(code);
		}
		return value;
	}

	function expiry(value: unknown): number {
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || !Number.isSafeInteger(value * 1000) || value * 1000 <= Date.now()) throw new Error('EXPORT_FRAME_SESSION_FAILED');
		return value * 1000;
	}

	function readPreview(value: Record<string, unknown>): OwnerProofPreview {
		const { message, ts, validUntil, ref, previewId } = value;
		if (Object.keys(value).length !== 5 || typeof message !== 'string' || typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts <= 0 ||
			typeof validUntil !== 'number' || !Number.isSafeInteger(validUntil) || validUntil !== ts + 300 || !Number.isSafeInteger(validUntil * 1000) || validUntil * 1000 > 8_640_000_000_000_000 || typeof ref !== 'string' ||
			typeof previewId !== 'string' || !/^pv2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(previewId)) throw new Error('OWNER_PROOF_PREVIEW_INVALID');
		const suffix = message.match(/\nOwner action v2\nIssued at ([0-9]+) \(([^\n]+)\)\nValid until ([0-9]+) \(([^\n]+)\)\nCommitment SHA-256 ([0-9a-f]{64})\nRef ([0-9a-f]{8})$/);
		if (!suffix || suffix[1] !== String(ts) || suffix[3] !== String(validUntil) || suffix[2] !== new Date(ts * 1000).toISOString().replace('.000Z', 'Z') ||
			suffix[4] !== new Date(validUntil * 1000).toISOString().replace('.000Z', 'Z') || suffix[6] !== suffix[5].slice(0, 8) || ref !== suffix[6]) throw new Error('OWNER_PROOF_PREVIEW_INVALID');
		return { message, ts, validUntil, ref, previewId };
	}

	function clearTimers(): void {
		if (holdTimer !== null) clearTimeout(holdTimer);
		if (expireTimer !== null) clearTimeout(expireTimer);
		if (copiedTimer !== null) clearTimeout(copiedTimer);
		if (countdownTimer !== null) clearInterval(countdownTimer);
		countdownTimer = null;
		holdTimer = null;
		expireTimer = null;
		copiedTimer = null;
	}

	function teardown(): void {
		generation++;
		abort.abort();
		token = frameSession = '';
		preview = null;
		clearTimers();
		if (secretEl) secretEl.textContent = '';
		secretEl = null;
		copyButton = null;
		options.root.replaceChildren();
		secret = null;
		pair = null;
		publicRaw?.fill(0);
		publicRaw = null;
		state = 'done';
	}

	function discard(): void {
		discardPending = false;
		options.discard?.();
	}

	function wipe(): void {
		teardown();
		postToParent({ type: 'owner-frame:wiped' });
		// Dropping the page frees every copy of the key the JS heap still holds; wait for a pending clipboard clear.
		if (clipboardTimer === null) discard();
		else discardPending = true;
	}

	function setCopyLabel(copied: boolean): void {
		if (!copyButton) return;
		copyButton.replaceChildren(copied ? checkIcon() : copyIcon(), document.createTextNode(copied ? 'Copied' : 'Copy'));
	}

	function removeCopyError(): void {
		options.root.querySelector('[data-testid="reveal-key-copy-error"]')?.remove();
	}

	async function copy(): Promise<void> {
		if (secret === null || Date.now() >= deadline) return;
		const g = generation;
		try {
			await clipboard.writeText(secret);
			current(g);
		} catch {
			if (g !== generation || secret === null || Date.now() >= deadline) return;
			removeCopyError();
			const err = el('p', 'text-xs text-red', 'COPY_FAILED');
			err.dataset.testid = 'reveal-key-copy-error';
			options.root.firstElementChild?.append(err);
			return;
		}
		if (secret === null || Date.now() >= deadline) return;
		removeCopyError();
		setCopyLabel(true);
		if (clipboardTimer !== null) clearTimeout(clipboardTimer);
		clipboardTimer = setTimeout(() => {
			clipboardTimer = null;
			// Best effort: the browser may refuse while the frame lacks focus.
			void clipboard.writeText('').catch(() => {}).finally(() => {
				if (discardPending) discard();
			});
		}, CLIPBOARD_CLEAR_MS);
		if (copiedTimer !== null) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => {
			copiedTimer = null;
			setCopyLabel(false);
		}, COPIED_MS);
	}

	function reveal(): void {
		holdTimer = null;
		if (secret === null || Date.now() >= deadline) return;
		const wrap = el('div', 'flex flex-col gap-3');
		const box = el('div', 'max-h-32 overflow-y-auto rounded-lg border border-bd bg-s4 p-2.5');
		const code = el('code', 'block select-all break-all font-mono text-xs text-tx', secret);
		code.dataset.testid = 'reveal-key-secret';
		box.append(code);
		const actions = el('div', 'flex gap-2');
		const copyBtn = el('button', 'btn-secondary flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm');
		copyBtn.type = 'button';
		copyBtn.dataset.testid = 'reveal-key-copy';
		copyBtn.addEventListener('click', () => {
			void copy();
		});
		const hideBtn = el('button', 'btn-secondary flex-1 px-3 py-2 text-sm', 'Hide');
		hideBtn.type = 'button';
		hideBtn.dataset.testid = 'reveal-key-hide';
		hideBtn.addEventListener('click', () => wipe());
		actions.append(copyBtn, hideBtn);
		const countdown = el('p', 'text-xs font-medium text-yel');
		countdown.dataset.testid = 'reveal-key-countdown';
		const tick = () => {
			countdown.textContent = `Hides in ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))} s`;
		};
		tick();
		countdownTimer = setInterval(tick, 1_000);
		wrap.append(el('p', 'text-xs text-red', WARNING), box, actions, countdown, el('p', 'text-[11px] text-g5', SAFETY_NOTE));
		secretEl = code;
		copyButton = copyBtn;
		setCopyLabel(false);
		options.root.replaceChildren(wrap);

	}

	function renderHold(): void {
		const wrap = el('div', 'flex flex-col gap-3');
		const button = el('button', 'btn-secondary relative w-full select-none overflow-hidden px-4 py-2 text-sm');
		button.type = 'button';
		button.dataset.testid = 'reveal-key-hold';
		const progress = el('span', HOLD_REST);
		button.append(progress, el('span', 'relative', 'Hold to reveal'));
		const begin = (): void => {
			if (holdTimer !== null || state !== 'shown' || Date.now() >= deadline) return;
			progress.className = HOLD_HELD;
			holdTimer = setTimeout(reveal, HOLD_MS);
		};
		const end = (): void => {
			if (holdTimer !== null) clearTimeout(holdTimer);
			holdTimer = null;
			progress.className = HOLD_REST;
		};
		button.addEventListener('pointerdown', (event) => {
			try {
				button.setPointerCapture(event.pointerId);
			} catch {}
			begin();
		});
		button.addEventListener('pointerup', end);
		button.addEventListener('pointercancel', end);
		button.addEventListener('lostpointercapture', end);
		button.addEventListener('keydown', (event) => {
			if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
				event.preventDefault();
				begin();
			}
		});
		button.addEventListener('keyup', (event) => {
			if (event.key === ' ' || event.key === 'Enter') end();
		});
		wrap.append(el('p', 'text-xs text-red', WARNING), button);
		options.root.replaceChildren(wrap);
	}

	async function receive(event: FrameMessageEvent): Promise<void> {
		// Any https page (and loopback http) may embed this frame: the plaintext never leaves it, and the server
		// applies the org policy to the parent the frame reports. The first valid init pins the parent origin;
		// from then on only that exact origin is read or written.
		if (event.source !== options.parent) return;
		if (parentOrigin === null ? openParentOrigin(event.origin, options.authOrigin) === null : event.origin !== parentOrigin) return;
		const data = event.data;
		if (!isRecord(data) || data.v !== 2) return;
		const exact = (keys: string[]): boolean => Reflect.ownKeys(data).length === keys.length && keys.every(k => Object.hasOwn(data, k));
		const base = ['type', 'v', 'contextId', 'userId', 'orgId'];
		if (data.type === 'owner-frame:init') {
			if (init || state === 'done' || !exact([...base, 'format', 'token'])) return;
			try {
				init = frameInit(data.contextId as string, data.userId as string, data.orgId as string, data.format as OwnerFrameInit['format'], data.token as string);
			} catch { return; }
			parentOrigin = event.origin;
			token = init.token;
			init = { ...init, token: '' };
		} else {
			if (!init || data.contextId !== init.contextId || data.userId !== init.userId || data.orgId !== init.orgId) return;
			if (data.type === 'owner-frame:wipe' && exact(base)) { wipe(); return; }
			if (data.type !== 'owner-frame:approve' || !exact([...base, 'previewId', 'proof']) || state !== 'waiting' || !preview) return;
		}
		const g = generation;
		try {
			if (data.type === 'owner-frame:init') {
				if (options.authOrigin !== location.origin || parentOrigin === options.authOrigin) throw new Error('EXPORT_FRAME_SESSION_FAILED');
				const generated = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
				current(g);
				pair = generated;
				const raw = new Uint8Array(await crypto.subtle.exportKey('raw', generated.publicKey));
				if (g !== generation) { raw.fill(0); return; }
				publicRaw = raw;
				const body = { contextId: init.contextId, format: init.format, target_public_key: toHex(raw), parent_origin: parentOrigin };
				const session = await request('/auth/wallet/export/frame-session', body, g);
				if (typeof session.frameSession !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(session.frameSession)) {
					throw new Error('EXPORT_FRAME_SESSION_FAILED');
				}
				frameSession = session.frameSession;
				sessionExpiry = expiry(session.expiresAt);
				preview = readPreview(await request('/auth/wallet/export/preview', body, g));
				if (Date.now() < preview.ts * 1000 || Date.now() >= Math.min(preview.validUntil * 1000, sessionExpiry)) throw new Error('OWNER_PROOF_EXPIRED');
				expireTimer = setTimeout(wipe, Math.min(preview.validUntil * 1000, sessionExpiry) - Date.now());
				postToParent({ type: 'owner-frame:ready', targetPublicKey: toHex(raw), preview });
				return;
			}
			if (!init || !preview || !pair || !publicRaw) throw new Error('EXPORT_FRAME_CONTEXT_INVALID');
			const approval = frameApprove(init.contextId, init.userId, init.orgId, data.previewId as string, data.proof as Parameters<typeof frameApprove>[4]);
			if (approval.previewId !== preview.previewId || approval.proof.ts !== preview.ts) throw new Error('EXPORT_FRAME_CONTEXT_INVALID');
			if (Date.now() < preview.ts * 1000 || Date.now() >= Math.min(preview.validUntil * 1000, sessionExpiry)) throw new Error('OWNER_PROOF_EXPIRED');
			state = 'decrypting';
			const bundle = await request('/auth/wallet/export', { contextId: init.contextId, format: init.format, target_public_key: toHex(publicRaw), parent_origin: parentOrigin, preview_id: approval.previewId, owner_proof: approval.proof }, g);
			deadline = Math.min(Date.now() + EXPIRE_MS, preview.validUntil * 1000, sessionExpiry);
			if (expireTimer !== null) clearTimeout(expireTimer);
			if (deadline <= Date.now()) { wipe(); return; }
			expireTimer = setTimeout(wipe, deadline - Date.now());
			if (typeof bundle.exportBundle !== 'string') throw new ExportBundleError('BUNDLE_FORMAT_INVALID');
			let plaintext: string | null = await decryptExportBundle(bundle.exportBundle, pair.privateKey, publicRaw, options.signers, () => current(g));
			if (g !== generation || Date.now() >= deadline) { plaintext = null; return; }
			secret = plaintext;
			plaintext = null;
			pair = null;
			token = frameSession = '';
			state = 'shown';
			renderHold();
			postToParent({ type: 'owner-frame:shown' });
		} catch (error) {
			if (g !== generation) return;
			const code = error instanceof ExportBundleError ? error.code : error instanceof Error && ['EXPORT_FRAME_CONTEXT_INVALID', 'OWNER_PROOF_PREVIEW_INVALID', 'OWNER_PROOF_EXPIRED', ...HTTP_ERRORS].includes(error.message) ? error.message : 'EXPORT_FRAME_SESSION_FAILED';
			teardown();
			postToParent({ type: 'owner-frame:error', code });
		}
	}

	function destroy(): void {
		teardown();
	}

	return { ready, receive, destroy };
}
