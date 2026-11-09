import { describe, expect, it } from 'vitest';
import { proofFailure, PROOF_MISMATCH_MESSAGE } from './proof-failure';

describe('proofFailure', () => {
	it('treats a proof mismatch as restartable', () => {
		expect(proofFailure(403, 'OWNER_PROOF_INVALID')).toEqual({ code: 'OWNER_PROOF_INVALID', message: PROOF_MISMATCH_MESSAGE, restart: true });
	});
	it('does not report a policy refusal as a mismatch', () => {
		const f = proofFailure(403, 'CAPABILITY_DISABLED');
		expect(f.restart).toBe(false);
		expect(f.message).not.toBe(PROOF_MISMATCH_MESSAGE);
	});
});
