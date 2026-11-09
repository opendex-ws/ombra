// @vitest-environment jsdom
// The export frame keeps its session in memory: one POST frame-session with the bearer and the ECDH key,
// then X-Waas-Frame-Session on preview and export. No cookie, no CSRF header, no storage.
// The frame is embeddable by any https page: it pins the parent from the first valid init and uses only that origin.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import fixture from './export-fixture.json';
import { createExportFrame, HOLD_MS } from '../frame';
import { parseSigners } from '../signers';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const PARENT = 'https://app.test';
const USER = '11111111-2222-4333-8444-555555555555';
const ORG = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const CTX = 'ab'.repeat(32);
const SESSION = 'S'.repeat(43);
const PLAINTEXT = fixture.bundles.SOLANA_PRIVATE_KEY.plaintext;
const BUNDLE = fixture.bundles.SOLANA_PRIVATE_KEY.exportBundle;
const b64u = (hex: string) => Buffer.from(hex, 'hex').toString('base64url');
const iso = (v: number) => new Date(v * 1000).toISOString().replace('.000Z', 'Z');

function previewBody() {
	const ts = Math.floor(Date.now() / 1000) - 1;
	const c = '78'.repeat(32);
	return { message: `Reveal private key\nExact text\nOwner action v2\nIssued at ${ts} (${iso(ts)})\nValid until ${ts + 300} (${iso(ts + 300)})\nCommitment SHA-256 ${c}\nRef ${c.slice(0, 8)}`, ts, validUntil: ts + 300, ref: c.slice(0, 8), previewId: 'pv2.c3ludGhldGlj.c2lnbmVk' };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { url: string; init: RequestInit };

let calls: Call[] = [];
let routes: Record<string, () => Response> = {};
beforeEach(async () => {
	const pub = fixture.target_public_key_hex;
	const curve = { name: 'ECDH', namedCurve: 'P-256' };
	const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(2, 66)), y: b64u(pub.slice(66, 130)) };
	const privateKey = await crypto.subtle.importKey('jwk', { ...jwk, d: b64u(fixture.target_private_key_hex) }, curve, false, ['deriveBits']);
	const publicKey = await crypto.subtle.importKey('jwk', jwk, curve, true, []);
	vi.spyOn(crypto.subtle, 'generateKey').mockImplementation((async () => ({ privateKey, publicKey })) as never);
	calls = [];
	const p = previewBody();
	routes = {
		'/auth/wallet/export/frame-session': () => json(200, { frameSession: SESSION, expiresAt: Math.floor(Date.now() / 1000) + 300 }),
		'/auth/wallet/export/preview': () => json(200, p),
		'/auth/wallet/export': () => json(200, { exportBundle: BUNDLE })
	};
	vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
		calls.push({ url: String(url), init });
		const path = new URL(String(url)).pathname;
		return routes[path]?.() ?? json(404, {});
	}));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function setup() {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const parent = { name: 'parent' };
	const posted: Array<{ message: any; targetOrigin: string }> = [];
	const frame = createExportFrame({
		root, parent, signers: parseSigners(fixture.export_signer_public_key_hex)!, authOrigin: location.origin,
		post: (message, targetOrigin) => posted.push({ message: JSON.parse(JSON.stringify(message)), targetOrigin })
	});
	const base = { v: 2, contextId: CTX, userId: USER, orgId: ORG };
	const send = (data: unknown, origin = PARENT) => frame.receive({ source: parent, origin, data });
	const init = () => send({ type: 'owner-frame:init', ...base, format: 'SOLANA_PRIVATE_KEY', token: 'bearer-token' });
	return { root, posted, frame, base, send, init };
}
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
const path = (c: Call) => new URL(c.url).pathname;

describe('export frame in-memory session', () => {
	it('init opens the session with one POST carrying the bearer and the ECDH key, credentials omitted', async () => {
		const t = setup();
		await t.init();
		expect(calls.map((c) => [c.init.method ?? 'GET', path(c)])).toEqual([['POST', '/auth/wallet/export/frame-session'], ['POST', '/auth/wallet/export/preview']]);
		const open = calls[0];
		expect(open.url).toBe(location.origin + '/auth/wallet/export/frame-session');
		expect(open.init.credentials).toBe('omit');
		expect(header(open, 'authorization')).toBe('Bearer bearer-token');
		expect(JSON.parse(String(open.init.body))).toEqual({ contextId: CTX, format: 'SOLANA_PRIVATE_KEY', target_public_key: fixture.target_public_key_hex, parent_origin: PARENT });
		for (const c of calls) expect(header(c, 'x-waas-csrf')).toBeNull();
	});

	it('preview sends the frame session header and the frame posts ready to the parent', async () => {
		const t = setup();
		await t.init();
		const preview = calls[1];
		expect(preview.init.credentials).toBe('omit');
		expect(header(preview, 'x-waas-frame-session')).toBe(SESSION);
		expect(JSON.parse(String(preview.init.body))).toEqual({ contextId: CTX, format: 'SOLANA_PRIVATE_KEY', target_public_key: fixture.target_public_key_hex, parent_origin: PARENT });
		expect(t.posted.at(-1)).toMatchObject({ message: { type: 'owner-frame:ready', ...t.base, targetPublicKey: fixture.target_public_key_hex }, targetOrigin: PARENT });
	});

	it('export sends the same header, the parent gets only shown, and the key appears after the hold', async () => {
		const t = setup();
		await t.init();
		const ready = t.posted.at(-1)!.message;
		await t.send({ type: 'owner-frame:approve', ...t.base, previewId: ready.preview.previewId, proof: { kind: 'google', id_token: 'a.b.c', ts: ready.preview.ts } });
		const exp = calls[2];
		expect(path(exp)).toBe('/auth/wallet/export');
		expect(exp.init.credentials).toBe('omit');
		expect(header(exp, 'x-waas-frame-session')).toBe(SESSION);
		expect(header(exp, 'authorization')).toBe('Bearer bearer-token');
		expect(JSON.parse(String(exp.init.body))).toMatchObject({ contextId: CTX, parent_origin: PARENT, preview_id: ready.preview.previewId, owner_proof: { kind: 'google', id_token: 'a.b.c' } });
		expect(t.posted.at(-1)).toEqual({ message: { type: 'owner-frame:shown', ...t.base }, targetOrigin: PARENT });
		const all = JSON.stringify(t.posted);
		expect(all).not.toContain(PLAINTEXT);
		expect(all).not.toContain(SESSION);
		expect(all).not.toContain('bearer-token');
		const hold = t.root.querySelector('[data-testid="reveal-key-hold"]') as HTMLElement;
		hold.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		await new Promise((r) => setTimeout(r, HOLD_MS + 150));
		expect(t.root.querySelector('[data-testid="reveal-key-secret"]')?.textContent).toBe(PLAINTEXT);
	});

	it('writes no cookie and no web storage', async () => {
		const t = setup();
		await t.init();
		expect(document.cookie).toBe('');
		expect(localStorage.length).toBe(0);
		expect(sessionStorage.length).toBe(0);
	});

	it('a frame-session reply without frameSession is EXPORT_FRAME_SESSION_FAILED and no preview call', async () => {
		routes['/auth/wallet/export/frame-session'] = () => json(200, { csrf: 'c'.repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 300 });
		const t = setup();
		await t.init();
		expect(calls.map(path)).toEqual(['/auth/wallet/export/frame-session']);
		expect(t.posted.at(-1)).toEqual({ message: { type: 'owner-frame:error', ...t.base, code: 'EXPORT_FRAME_SESSION_FAILED' }, targetOrigin: PARENT });
	});

	it('a preview 403 WAAS_EXPORT_FRAME_INVALID is posted as that error code', async () => {
		routes['/auth/wallet/export/preview'] = () => json(403, { code: 'WAAS_EXPORT_FRAME_INVALID' });
		const t = setup();
		await t.init();
		expect(t.posted.at(-1)).toEqual({ message: { type: 'owner-frame:error', ...t.base, code: 'WAAS_EXPORT_FRAME_INVALID' }, targetOrigin: PARENT });
	});

	it('pins the first valid parent: a second origin cannot init, approve or wipe, and gets nothing', async () => {
		const t = setup();
		const other = 'https://random-client.test';
		await t.init();
		const ready = t.posted.at(-1)!.message;
		const count = calls.length;
		const posts = t.posted.length;
		await t.send({ type: 'owner-frame:init', ...t.base, format: 'SOLANA_PRIVATE_KEY', token: 'other-token' }, other);
		await t.send({ type: 'owner-frame:approve', ...t.base, previewId: ready.preview.previewId, proof: { kind: 'google', id_token: 'a.b.c', ts: ready.preview.ts } }, other);
		await t.send({ type: 'owner-frame:wipe', ...t.base }, other);
		expect(calls.length).toBe(count);
		expect(t.posted.length).toBe(posts);
		expect(t.posted.every((p) => p.targetOrigin === PARENT)).toBe(true);
		await t.send({ type: 'owner-frame:approve', ...t.base, previewId: ready.preview.previewId, proof: { kind: 'google', id_token: 'a.b.c', ts: ready.preview.ts } });
		expect(calls.length).toBe(count + 1);
		expect(t.posted.at(-1)).toMatchObject({ targetOrigin: PARENT });
	});

	it('any https origin and loopback can be the first parent, and the frame reports it to the server', async () => {
		for (const origin of ['https://random-client.test', 'https://a.b.example:8443', 'http://localhost:5173', 'http://127.0.0.1:3000']) {
			calls = [];
			const t = setup();
			await t.send({ type: 'owner-frame:init', ...t.base, format: 'SOLANA_PRIVATE_KEY', token: 'bearer-token' }, origin);
			expect(JSON.parse(String(calls[0].init.body)).parent_origin).toBe(origin);
			expect(t.posted.at(-1)).toMatchObject({ message: { type: 'owner-frame:ready' }, targetOrigin: origin });
			t.frame.destroy();
		}
	});

	it('an init from a non-parent window, a bad origin or the auth origin is ignored and pins nothing', async () => {
		const t = setup();
		const bad = ['null', 'http://app.test', 'javascript:alert(1)', 'https://app.test/', 'https://*.test', location.origin, ''];
		for (const origin of bad) await t.send({ type: 'owner-frame:init', ...t.base, format: 'SOLANA_PRIVATE_KEY', token: 'bearer-token' }, origin);
		await t.frame.receive({ source: { name: 'other window' }, origin: PARENT, data: { type: 'owner-frame:init', ...t.base, format: 'SOLANA_PRIVATE_KEY', token: 'bearer-token' } });
		await t.send({ type: 'owner-frame:init', ...t.base, format: 'SOLANA_PRIVATE_KEY' });
		expect(calls).toHaveLength(0);
		expect(t.posted).toHaveLength(0);
		await t.init();
		expect(calls.length).toBeGreaterThan(0);
		expect(t.posted.at(-1)).toMatchObject({ targetOrigin: PARENT });
	});

	it('after a wipe the session is gone: approve and a new init make no request', async () => {
		const t = setup();
		await t.init();
		const ready = t.posted.at(-1)!.message;
		await t.send({ type: 'owner-frame:wipe', ...t.base });
		const before = calls.length;
		await t.send({ type: 'owner-frame:approve', ...t.base, previewId: ready.preview.previewId, proof: { kind: 'google', id_token: 'a.b.c', ts: ready.preview.ts } });
		await t.init();
		expect(calls.length).toBe(before);
	});
});
