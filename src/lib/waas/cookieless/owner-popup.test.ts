// @vitest-environment jsdom
// Frozen acceptance test (goal codex-waas-cookieless, node fe-popup). Planner-owned. Workers never edit it.
// Google owner proof in a popup: the popup opens before any await, the review secret stays in memory,
// only its SHA-256 goes to start, the result comes back by postMessage and is redeemed with the secret header.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { googleOwnerProofPopup, OwnerPopupError } from '../owner-popup';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const AUTH = 'https://api.opendex.test';
const APP = 'https://app.test';
const TICKET = 'K'.repeat(43);
const REVIEW = `${AUTH}/auth/owner-proof/review/${TICKET}`;
const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJub25jZSI6Im4ifQ.c2ln';
const ts = Math.floor(Date.now() / 1000);
const iso = (v: number) => new Date(v * 1000).toISOString().replace('.000Z', 'Z');
const c = '34'.repeat(32);
const preview = {
	message: `Withdraw\nOwner action v2\nIssued at ${ts} (${iso(ts)})\nValid until ${ts + 300} (${iso(ts + 300)})\nCommitment SHA-256 ${c}\nRef ${c.slice(0, 8)}`,
	ts, validUntil: ts + 300, ref: c.slice(0, 8), previewId: 'pv2.c3ludGhldGlj.c2lnbmVk'
};

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function harness(opts: { popup?: boolean; start?: Response; redeem?: Response } = {}) {
	const listeners: Array<(e: MessageEvent) => void> = [];
	const popup = { closed: false, close: vi.fn(function (this: any) { this.closed = true; }), location: { replace: vi.fn() } };
	const win = {
		open: vi.fn(() => (opts.popup === false ? null : popup)),
		addEventListener: vi.fn((type: string, fn: any) => { if (type === 'message') listeners.push(fn); }),
		removeEventListener: vi.fn((type: string, fn: any) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }),
		location: { origin: APP }
	};
	const calls: Call[] = [];
	const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
		calls.push({ url: String(url), init });
		if (String(url).endsWith('/auth/owner-proof/google/start')) return opts.start ?? json(200, { url: REVIEW });
		if (String(url).endsWith(`/auth/owner-proof/review/${TICKET}/redeem`)) return opts.redeem ?? json(200, { redeemed: true, ts });
		return json(404, {});
	});
	const send = (data: unknown, origin = AUTH, source: unknown = popup) => {
		for (const fn of [...listeners]) fn({ data, origin, source } as MessageEvent);
	};
	const run = () => googleOwnerProofPopup({ authOrigin: AUTH, token: 'user-token', action: 'social_withdraw', preview, win: win as any, fetchImpl: fetchImpl as any, timeoutMs: 5_000 });
	return { popup, win, calls, fetchImpl, send, run, listeners };
}
const result = (over: Record<string, unknown> = {}) => ({ type: 'waas-owner-proof:result', v: 1, ticket: TICKET, owner_proof: { kind: 'google', id_token: ID_TOKEN, ts }, ...over });
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);
async function until(fn: () => boolean) {
	for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 2));
	expect(fn()).toBe(true);
}
async function sha256Hex(s: string) {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => vi.restoreAllMocks());

describe('google owner proof popup', () => {
	it('opens the popup synchronously as about:blank without noopener, then navigates it to the review URL', async () => {
		const h = harness();
		const p = h.run();
		expect(h.win.open).toHaveBeenCalledTimes(1);
		const [url, , features] = h.win.open.mock.calls[0] as unknown as [string, string, string];
		expect(url).toBe('about:blank');
		expect(features).toContain('popup');
		expect(features).not.toContain('noopener');
		await until(() => h.popup.location.replace.mock.calls.length === 1);
		expect(h.popup.location.replace).toHaveBeenCalledWith(REVIEW);
		h.send(result());
		await expect(p).resolves.toEqual({ kind: 'google', id_token: ID_TOKEN, ts });
	});

	it('sends sha256(secret) and the opener origin to start, and the secret only in the redeem header', async () => {
		const h = harness();
		const p = h.run();
		await until(() => h.calls.length === 1);
		const start = h.calls[0];
		expect(start.url).toBe(`${AUTH}/auth/owner-proof/google/start`);
		expect(start.init.method).toBe('POST');
		expect(start.init.credentials).toBe('omit');
		expect(header(start.init, 'authorization')).toBe('Bearer user-token');
		const body = JSON.parse(String(start.init.body));
		expect(Object.keys(body).sort()).toEqual(['action', 'message', 'openerOrigin', 'preview_id', 'review_secret_hash', 'ts']);
		expect(body).toMatchObject({ action: 'social_withdraw', message: preview.message, ts, preview_id: preview.previewId, openerOrigin: APP });
		expect(body.review_secret_hash).toMatch(/^[0-9a-f]{64}$/);
		await until(() => h.listeners.length > 0 && h.popup.location.replace.mock.calls.length === 1);
		h.send(result());
		await expect(p).resolves.toMatchObject({ kind: 'google' });
		const redeem = h.calls[1];
		expect(redeem.url).toBe(`${AUTH}/auth/owner-proof/review/${TICKET}/redeem`);
		expect(redeem.init.method).toBe('POST');
		expect(redeem.init.credentials).toBe('omit');
		expect(header(redeem.init, 'authorization')).toBe('Bearer user-token');
		const secret = header(redeem.init, 'x-waas-owner-review')!;
		expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await sha256Hex(secret)).toBe(body.review_secret_hash);
		expect(JSON.parse(String(redeem.init.body))).toEqual({ owner_proof: { kind: 'google', id_token: ID_TOKEN, ts } });
		for (const u of [start.url, redeem.url, String(h.popup.location.replace.mock.calls[0][0])]) expect(u).not.toContain(secret);
		expect(String(start.init.body)).not.toContain(secret);
		expect(h.popup.close).toHaveBeenCalled();
		expect(h.listeners).toHaveLength(0);
	});

	it('ignores messages from another origin, another window or for another ticket', async () => {
		const h = harness();
		const p = h.run();
		await until(() => h.listeners.length > 0 && h.popup.location.replace.mock.calls.length === 1);
		h.send(result(), 'https://evil.test');
		h.send(result(), AUTH, { other: true });
		h.send(result({ ticket: 'X'.repeat(43) }));
		h.send(result({ owner_proof: { kind: 'google', id_token: ID_TOKEN, ts: ts - 5 } }));
		await new Promise((r) => setTimeout(r, 20));
		expect(h.calls).toHaveLength(1);
		h.send(result());
		await expect(p).resolves.toEqual({ kind: 'google', id_token: ID_TOKEN, ts });
		expect(h.calls).toHaveLength(2);
	});

	it('an owner_mismatch error rejects OWNER_MISMATCH, closes the popup and redeems nothing', async () => {
		const h = harness();
		const p = h.run();
		await until(() => h.listeners.length > 0 && h.popup.location.replace.mock.calls.length === 1);
		h.send({ type: 'waas-owner-proof:error', v: 1, ticket: TICKET, code: 'owner_mismatch' });
		await expect(p).rejects.toMatchObject({ code: 'OWNER_MISMATCH' });
		await expect(p).rejects.toBeInstanceOf(OwnerPopupError);
		expect(h.calls).toHaveLength(1);
		expect(h.popup.close).toHaveBeenCalled();
	});

	it('a blocked popup rejects POPUP_BLOCKED before any request', async () => {
		const h = harness({ popup: false });
		await expect(h.run()).rejects.toMatchObject({ code: 'POPUP_BLOCKED' });
		expect(h.fetchImpl).not.toHaveBeenCalled();
	});

	it('a start error code rejects with that code and closes the popup', async () => {
		const h = harness({ start: json(400, { code: 'WAAS_OWNER_PROOF_OPENER_INVALID' }) });
		await expect(h.run()).rejects.toMatchObject({ code: 'WAAS_OWNER_PROOF_OPENER_INVALID' });
		expect(h.popup.close).toHaveBeenCalled();
	});

	it('a redeem error code rejects with that code', async () => {
		const h = harness({ redeem: json(409, { code: 'WAAS_OWNER_REVIEW_REPLAY' }) });
		const p = h.run();
		await until(() => h.listeners.length > 0 && h.popup.location.replace.mock.calls.length === 1);
		h.send(result());
		await expect(p).rejects.toMatchObject({ code: 'WAAS_OWNER_REVIEW_REPLAY' });
	});

	it('a start URL off the auth origin rejects OWNER_PROOF_URL_INVALID and never navigates the popup', async () => {
		const h = harness({ start: json(200, { url: `https://evil.test/auth/owner-proof/review/${TICKET}` }) });
		await expect(h.run()).rejects.toMatchObject({ code: 'OWNER_PROOF_URL_INVALID' });
		expect(h.popup.location.replace).not.toHaveBeenCalled();
	});

	it('stores nothing in cookies or web storage', async () => {
		const h = harness();
		const p = h.run();
		await until(() => h.listeners.length > 0 && h.popup.location.replace.mock.calls.length === 1);
		h.send(result());
		await p;
		expect(document.cookie).toBe('');
		expect(localStorage.length).toBe(0);
		expect(sessionStorage.length).toBe(0);
	});
});
