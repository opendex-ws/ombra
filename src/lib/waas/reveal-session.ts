import { frameApprove, frameInit, validFrameMessage, type OwnerFrameMessage, type OwnerFrameWipe } from './owner-protocol';
import { toHex } from './bytes';
import type { OwnerProof, OwnerProofPreview } from './owner-proof';
import type { ExportFormat } from './export-preview';

export type RevealPhase = 'loading' | 'review' | 'working' | 'ready' | 'expired' | 'error';

export interface RevealState {
	phase: RevealPhase;
	preview: OwnerProofPreview | null;
	error: string | null;
}

export interface RevealSessionOptions {
	frameWindow: () => { postMessage(message: unknown, targetOrigin: string): void } | null;
	frameOrigin: string;
	userId: string;
	orgId: string;
	format: ExportFormat;
	token: () => string | null;
	ownerProof: (preview: OwnerProofPreview) => Promise<OwnerProof>;
	onChange: (state: RevealState) => void;
	contextId?: string;
	readyTimeoutMs?: number;
}

export interface RevealSession {
	readonly contextId: string;
	state(): RevealState;
	frameLoaded(): void;
	receive(event: { origin: string; source: unknown; data: unknown }): void;
	approve(): Promise<void>;
	end(): void;
}

export function createRevealSession(options: RevealSessionOptions): RevealSession {
	const contextId = options.contextId ?? toHex(crypto.getRandomValues(new Uint8Array(32)));
	let current: RevealState = { phase: 'loading', preview: null, error: null };
	let ended = false;
	let loaded = false;
	let readyTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
		readyTimer = null;
		if (!ended && current.phase === 'loading') fail('EXPORT_FRAME_TIMEOUT');
	}, options.readyTimeoutMs ?? 15_000);

	function state(): RevealState {
		return { phase: current.phase, preview: current.preview, error: current.error };
	}

	function change(next: RevealState): void {
		current = next;
		options.onChange(state());
	}

	function clearReadyTimer(): void {
		if (readyTimer !== null) clearTimeout(readyTimer);
		readyTimer = null;
	}

	function end(): void {
		if (ended) return;
		clearReadyTimer();
		ended = true;
		const wipe: OwnerFrameWipe = { type: 'owner-frame:wipe', v: 2, contextId, userId: options.userId, orgId: options.orgId };
		try {
			options.frameWindow()?.postMessage(wipe, options.frameOrigin);
		} catch {
			// The frame may have gone away; the local session still ends.
		}
	}

	function fail(code: string): void {
		end();
		change({ phase: 'error', preview: null, error: code });
	}

	function frameLoaded(): void {
		if (ended || loaded) return;
		loaded = true;
		const token = options.token();
		if (token === null) {
			fail('SIGN_IN_REQUIRED');
			return;
		}
		options.frameWindow()?.postMessage(
			frameInit(contextId, options.userId, options.orgId, options.format, token),
			options.frameOrigin
		);
	}

	function receive(event: { origin: string; source: unknown; data: unknown }): void {
		if (
			ended || event.origin !== options.frameOrigin || event.source !== options.frameWindow() ||
			!validFrameMessage(event.data, contextId, options.userId, options.orgId)
		) return;
		const message = event.data as OwnerFrameMessage;
		if (message.type === 'owner-frame:ready' && current.phase === 'loading') {
			clearReadyTimer();
			change({ phase: 'review', preview: message.preview, error: null });
		} else if (message.type === 'owner-frame:shown' && current.phase === 'working') {
			change({ phase: 'ready', preview: current.preview, error: null });
		} else if (message.type === 'owner-frame:error') {
			fail(message.code);
		} else if (message.type === 'owner-frame:wiped') {
			end();
			change({ phase: 'expired', preview: null, error: null });
		}
	}

	async function approve(): Promise<void> {
		if (ended || current.phase !== 'review' || current.preview === null) return;
		const preview = current.preview;
		change({ phase: 'working', preview, error: null });
		try {
			const proof = await options.ownerProof(preview);
			if (ended) return;
			options.frameWindow()?.postMessage(
				frameApprove(contextId, options.userId, options.orgId, preview.previewId, proof),
				options.frameOrigin
			);
		} catch (error) {
			if (ended) return;
			const value = error && typeof error === 'object' ? error as { code?: unknown } : null;
			fail(typeof value?.code === 'string' ? value.code : 'EXPORT_FAILED');
		}
	}

	return { contextId, state, frameLoaded, receive, approve, end };
}
