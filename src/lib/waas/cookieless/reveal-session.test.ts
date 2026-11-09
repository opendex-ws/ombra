// Frozen acceptance test (goal codex-waas-cookieless, node fe-reveal). Planner-owned. Workers never edit it.
// The parent side of the reveal handshake, used by RevealKeyModal: init with the token to the exact frame
// origin, accept frame messages only from that origin, that window and that contextId, relay the owner proof.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRevealSession, type RevealState } from '../reveal-session';

const FRAME = 'https://api.opendex.test';
const USER = '11111111-2222-4333-8444-555555555555';
const ORG = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const CTX = 'ab'.repeat(32);
const KEY = '04' + '12'.repeat(64);
const ts = Math.floor(Date.now() / 1000);
const preview = { message: 'Reveal private key', ts, validUntil: ts + 300, ref: '0123abcd', previewId: 'pv2.c3ludGhldGlj.c2lnbmVk' };
const proof = { kind: 'google' as const, id_token: 'a.b.c', ts };

function setup(over: Record<string, unknown> = {}) {
	const posted: Array<{ message: any; targetOrigin: string }> = [];
	const frameWin = { postMessage: vi.fn((message: unknown, targetOrigin: string) => posted.push({ message: JSON.parse(JSON.stringify(message)), targetOrigin })) };
	const states: RevealState[] = [];
	const ownerProof = vi.fn(async () => proof);
	const session = createRevealSession({
		frameWindow: () => frameWin,
		frameOrigin: FRAME,
		userId: USER,
		orgId: ORG,
		format: 'SOLANA_PRIVATE_KEY',
		token: () => 'session-token',
		ownerProof,
		onChange: (s) => states.push(JSON.parse(JSON.stringify(s))),
		contextId: CTX,
		readyTimeoutMs: 1_000,
		...over
	});
	const base = { v: 2, contextId: CTX, userId: USER, orgId: ORG };
	const fromFrame = (data: unknown, origin = FRAME, source: unknown = frameWin) => session.receive({ origin, source, data });
	const ready = { type: 'owner-frame:ready', ...base, targetPublicKey: KEY, preview };
	return { session, posted, frameWin, states, ownerProof, base, fromFrame, ready };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('reveal session handshake', () => {
	it('frameLoaded posts one init with the token to the exact frame origin', () => {
		const t = setup();
		expect(t.session.contextId).toBe(CTX);
		expect(t.session.state()).toEqual({ phase: 'loading', preview: null, error: null });
		t.session.frameLoaded();
		t.session.frameLoaded();
		expect(t.posted).toEqual([{ message: { type: 'owner-frame:init', v: 2, contextId: CTX, userId: USER, orgId: ORG, format: 'SOLANA_PRIVATE_KEY', token: 'session-token' }, targetOrigin: FRAME }]);
	});

	it('ignores ready from another origin, another window, another context or with an extra key', () => {
		const t = setup();
		t.session.frameLoaded();
		t.fromFrame(t.ready, 'https://evil.test');
		t.fromFrame(t.ready, FRAME, { postMessage() {} });
		t.fromFrame({ ...t.ready, contextId: 'cd'.repeat(32) });
		t.fromFrame({ ...t.ready, plaintext: 'secret' });
		expect(t.session.state().phase).toBe('loading');
		t.fromFrame(t.ready);
		expect(t.session.state()).toEqual({ phase: 'review', preview, error: null });
		expect(t.states.at(-1)).toEqual({ phase: 'review', preview, error: null });
	});

	it('approve relays the owner proof with the previewId; shown moves to ready', async () => {
		const t = setup();
		t.session.frameLoaded();
		t.fromFrame(t.ready);
		const pending = t.session.approve();
		expect(t.session.state().phase).toBe('working');
		await pending;
		expect(t.ownerProof).toHaveBeenCalledWith(preview);
		expect(t.posted.at(-1)).toEqual({ message: { type: 'owner-frame:approve', ...t.base, previewId: preview.previewId, proof }, targetOrigin: FRAME });
		t.fromFrame({ type: 'owner-frame:shown', ...t.base });
		expect(t.session.state().phase).toBe('ready');
	});

	it('shown before approve is ignored', () => {
		const t = setup();
		t.session.frameLoaded();
		t.fromFrame(t.ready);
		t.fromFrame({ type: 'owner-frame:shown', ...t.base });
		expect(t.session.state().phase).toBe('review');
	});

	it('a frame error ends the session with its code and posts a wipe; later messages are ignored', () => {
		const t = setup();
		t.session.frameLoaded();
		t.fromFrame({ type: 'owner-frame:error', ...t.base, code: 'WAAS_EXPORT_FRAME_INVALID' });
		expect(t.session.state()).toEqual({ phase: 'error', preview: null, error: 'WAAS_EXPORT_FRAME_INVALID' });
		expect(t.posted.at(-1)).toEqual({ message: { type: 'owner-frame:wipe', ...t.base }, targetOrigin: FRAME });
		t.fromFrame(t.ready);
		expect(t.session.state().phase).toBe('error');
	});

	it('wiped from the frame moves to expired', () => {
		const t = setup();
		t.session.frameLoaded();
		t.fromFrame(t.ready);
		t.fromFrame({ type: 'owner-frame:wiped', ...t.base });
		expect(t.session.state().phase).toBe('expired');
	});

	it('no ready before readyTimeoutMs is error EXPORT_FRAME_TIMEOUT', () => {
		vi.useFakeTimers();
		const t = setup();
		t.session.frameLoaded();
		vi.advanceTimersByTime(1_001);
		expect(t.session.state()).toEqual({ phase: 'error', preview: null, error: 'EXPORT_FRAME_TIMEOUT' });
	});

	it('no token is error SIGN_IN_REQUIRED and nothing is posted', () => {
		const t = setup({ token: () => null });
		t.session.frameLoaded();
		expect(t.session.state()).toEqual({ phase: 'error', preview: null, error: 'SIGN_IN_REQUIRED' });
		expect(t.posted.filter((p) => p.message.type === 'owner-frame:init')).toHaveLength(0);
	});

	it('an owner proof failure is error with its code and a wipe', async () => {
		const t = setup({ ownerProof: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'OWNER_MISMATCH' }); }) });
		t.session.frameLoaded();
		t.fromFrame(t.ready);
		await t.session.approve();
		await flush();
		expect(t.session.state()).toEqual({ phase: 'error', preview: null, error: 'OWNER_MISMATCH' });
		expect(t.posted.at(-1)?.message.type).toBe('owner-frame:wipe');
		expect(t.posted.some((p) => p.message.type === 'owner-frame:approve')).toBe(false);
	});

	it('end posts a wipe to the exact origin once and ignores everything afterwards', async () => {
		const t = setup();
		t.session.frameLoaded();
		t.fromFrame(t.ready);
		t.session.end();
		t.session.end();
		expect(t.posted.filter((p) => p.message.type === 'owner-frame:wipe')).toEqual([{ message: { type: 'owner-frame:wipe', ...t.base }, targetOrigin: FRAME }]);
		await t.session.approve();
		t.fromFrame({ type: 'owner-frame:shown', ...t.base });
		expect(t.ownerProof).not.toHaveBeenCalled();
		expect(t.session.state().phase).toBe('review');
	});
});
