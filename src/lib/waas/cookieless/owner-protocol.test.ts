// Frozen acceptance test (goal codex-waas-cookieless, node fe-plumb). Planner-owned. Workers never edit it.
// The popup result message: exact auth origin, the popup window as source, the ticket, versioned shape.
import { describe, expect, it } from 'vitest';
import { openParentOrigin, popupMessage, reviewTicket, OWNER_POPUP_VERSION } from '../owner-protocol';

const AUTH = 'https://api.opendex.test';
const TICKET = 'T'.repeat(43);
const popup = { name: 'popup' };
const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJub25jZSI6Im4ifQ.c2ln';
const result = () => ({
	type: 'waas-owner-proof:result',
	v: 1,
	ticket: TICKET,
	owner_proof: { kind: 'google', id_token: ID_TOKEN, ts: 1_700_000_000 }
});
const expected = { authOrigin: AUTH, popup, ticket: TICKET };
const ev = (data: unknown, origin = AUTH, source: unknown = popup) => ({ origin, source, data });

describe('owner popup protocol', () => {
	it('accepts the exact result from the auth origin and the popup', () => {
		expect(OWNER_POPUP_VERSION).toBe(1);
		expect(popupMessage(ev(result()), expected)).toEqual(result());
	});

	it('ignores another origin', () => {
		for (const origin of ['http://api.opendex.test', 'https://evil.test', 'https://api.opendex.test:444', 'null', AUTH + '/'])
			expect(popupMessage(ev(result(), origin), expected)).toBeNull();
	});

	it('ignores another source window', () => {
		expect(popupMessage(ev(result(), AUTH, { name: 'other' }), expected)).toBeNull();
		expect(popupMessage(ev(result(), AUTH, null), expected)).toBeNull();
	});

	it('ignores another ticket, version, type, a missing or an extra key', () => {
		const bad: unknown[] = [
			{ ...result(), ticket: 'U'.repeat(43) },
			{ ...result(), v: 2 },
			{ ...result(), v: '1' },
			{ ...result(), type: 'owner-proof-result' },
			{ ...result(), extra: true },
			(({ ticket: _t, ...rest }) => rest)(result()),
			'string',
			null
		];
		for (const data of bad) expect(popupMessage(ev(data), expected)).toBeNull();
	});

	it('ignores a malformed owner_proof', () => {
		const proofs: unknown[] = [
			{ kind: 'wallet', id_token: ID_TOKEN, ts: 1 },
			{ kind: 'google', id_token: 'not-a-jwt', ts: 1 },
			{ kind: 'google', id_token: ID_TOKEN, ts: 0 },
			{ kind: 'google', id_token: ID_TOKEN, ts: 1.5 },
			{ kind: 'google', id_token: ID_TOKEN, ts: 1, extra: 1 },
			{ kind: 'google', ts: 1 }
		];
		for (const owner_proof of proofs) expect(popupMessage(ev({ ...result(), owner_proof }), expected)).toBeNull();
	});

	it('accepts a versioned error with a known code only', () => {
		const error = { type: 'waas-owner-proof:error', v: 1, ticket: TICKET, code: 'owner_mismatch' };
		expect(popupMessage(ev(error), expected)).toEqual(error);
		for (const code of ['google_exchange_failed', 'nonce_mismatch', 'id_token_invalid', 'owner_proof_replay'])
			expect(popupMessage(ev({ ...error, code }), expected)).toEqual({ ...error, code });
		expect(popupMessage(ev({ ...error, code: 'anything' }), expected)).toBeNull();
		expect(popupMessage(ev({ ...error, owner_proof: result().owner_proof }), expected)).toBeNull();
	});

	it('reviewTicket returns the ticket of a review URL on the auth origin only', () => {
		expect(reviewTicket(`${AUTH}/auth/owner-proof/review/${TICKET}`, AUTH)).toBe(TICKET);
		for (const url of [
			`https://evil.test/auth/owner-proof/review/${TICKET}`,
			`${AUTH}/auth/owner-proof/review/short`,
			`${AUTH}/auth/owner-proof/review/${TICKET}?x=1`,
			`${AUTH}/auth/owner-proof/review/${TICKET}#x`,
			`${AUTH}/other/${TICKET}`
		])
			expect(() => reviewTicket(url, AUTH)).toThrow('OWNER_PROOF_URL_INVALID');
	});
});

describe('open parent origin', () => {
	const AUTH = 'https://api.opendex.test';
	it('accepts any https origin and loopback http', () => {
		for (const o of ['https://random-client.test', 'https://a.b.example:8443', 'http://localhost', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:8080'])
			expect(openParentOrigin(o, AUTH)).toBe(o);
	});
	it('rejects null, http, other schemes, paths, wildcards, junk and the auth origin', () => {
		for (const o of ['null', '', 'http://x.example', 'javascript:alert(1)', 'data:text/html,x', 'chrome-extension://abc', 'https://x.example/', 'https://x.example/p', 'https://u@x.example', 'https://*.example', AUTH, 'HTTPS://X.EXAMPLE', null, undefined, 1])
			expect(openParentOrigin(o, AUTH)).toBeNull();
	});
});
