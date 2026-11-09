import { afterEach, describe, expect, it, vi } from 'vitest';
const sign = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/auth.svelte', () => ({
    getAuthToken: () => 'token', getWalletAddress: () => '11111111111111111111111111111111',
    signConnectedWalletMessageHex: sign
}));
import { getOwnerProof } from './owner-proof';
const preview = () => {
    const ts = Math.floor(Date.now() / 1000);
    const commitment = '12'.repeat(32);
    const iso = (value: number) => new Date(value * 1000).toISOString().replace('.000Z', 'Z');
    return {
        message: `Reveal private key\nExact text\nOwner action v2\nIssued at ${ts} (${iso(ts)})\nValid until ${ts + 300} (${iso(ts + 300)})\nCommitment SHA-256 ${commitment}\nRef ${commitment.slice(0, 8)}`,
        ts, validUntil: ts + 300, ref: commitment.slice(0, 8), previewId: 'pv2.c3ludGhldGlj.c2lnbmVk'
    };
};
afterEach(() => vi.resetAllMocks());
describe('wallet owner proof', () => {
    it('preserves the exact text and signature', async () => {
        sign.mockResolvedValue('AB'.repeat(64));
        const p = preview();
        const proof = await getOwnerProof('export', p, {kind: 'wallet'});
        expect(sign).toHaveBeenCalledWith(p.message);
        expect(proof).toMatchObject({kind: 'wallet', sig: 'ab'.repeat(64), pubkey: '00'.repeat(32), ts: p.ts});
    });
    it('keeps the wallet error available for display', async () => {
        sign.mockRejectedValue({code: -32603, message: 'Unexpected error'});
        await expect(getOwnerProof('export', preview(), {kind: 'wallet'})).rejects.toMatchObject({code: 'WALLET_SIGN_FAILED', message: 'Unexpected error'});
    });
    it('distinguishes cancellation from signing failure', async () => {
        sign.mockRejectedValue({code: 4001, message: 'User rejected'});
        await expect(getOwnerProof('export', preview(), {kind: 'wallet'})).rejects.toMatchObject({code: 'WALLET_SIGN_REJECTED'});
    });
});
