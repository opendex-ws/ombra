// @vitest-environment jsdom
// Frozen acceptance test (goal codex-waas-cookieless, node fe-popup). Planner-owned. Workers never edit it.
// getOwnerProof with a Google login uses the popup module with the auth origin and the session token.
import { afterEach, describe, expect, it, vi } from 'vitest';
const popup = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/auth.svelte', () => ({
	getAuthToken: () => 'session-token', getWalletAddress: () => null, signConnectedWalletMessageHex: vi.fn()
}));
vi.mock('../auth-base', () => ({ authBackendBase: () => 'https://api.opendex.test' }));
vi.mock('../owner-popup', async (orig) => ({ ...(await orig<typeof import('../owner-popup')>()), googleOwnerProofPopup: popup }));
import { getOwnerProof, OwnerProofError } from '../owner-proof';
import { OwnerPopupError } from '../owner-popup';

const ts = Math.floor(Date.now() / 1000);
const iso = (v: number) => new Date(v * 1000).toISOString().replace('.000Z', 'Z');
const c = '56'.repeat(32);
const preview = {
	message: `Reveal private key\nOwner action v2\nIssued at ${ts} (${iso(ts)})\nValid until ${ts + 300} (${iso(ts + 300)})\nCommitment SHA-256 ${c}\nRef ${c.slice(0, 8)}`,
	ts, validUntil: ts + 300, ref: c.slice(0, 8), previewId: 'pv2.c3ludGhldGlj.c2lnbmVk'
};

afterEach(() => vi.resetAllMocks());

describe('getOwnerProof google', () => {
	it('calls the popup synchronously with the auth origin, the token, the action and the preview', async () => {
		const proof = { kind: 'google', id_token: 'a.b.c', ts };
		popup.mockResolvedValue(proof);
		const pending = getOwnerProof('social_withdraw', preview, { kind: 'google' });
		expect(popup).toHaveBeenCalledTimes(1);
		expect(popup.mock.calls[0][0]).toMatchObject({ authOrigin: 'https://api.opendex.test', token: 'session-token', action: 'social_withdraw', preview });
		await expect(pending).resolves.toEqual(proof);
	});

	it('maps a popup error code to OwnerProofError with the same code', async () => {
		popup.mockRejectedValue(new OwnerPopupError('OWNER_MISMATCH'));
		const err = await getOwnerProof('export', preview, { kind: 'google' }).catch((e) => e);
		expect(err).toBeInstanceOf(OwnerProofError);
		expect(err.code).toBe('OWNER_MISMATCH');
	});
});
