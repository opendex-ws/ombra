import { describe, expect, it } from 'vitest';
import { applyScannerWsEvent } from '$lib/utils/scanner-ws';
import type { ScannerItem } from '$lib/api/types';

/**
 * SCANNER_UPDATE merges an explicit allowlist of fields, it does not replace the
 * row. A field the backend starts sending is silently ignored until it is listed
 * here — `theses` was exactly that: present in every frame, never applied, so the
 * scanner/memescope thesis chip never moved.
 */
const row = { pairAddress: 'P1', tokenAddress: 'T1', calls: 8, theses: 28 } as unknown as ScannerItem;

describe('SCANNER_UPDATE field coverage', () => {
	it('applies a live theses count', () => {
		const { tokens } = applyScannerWsEvent(
			'SCANNER_UPDATE',
			{ tokens: [{ pairAddress: 'P1', theses: 33 }] } as never,
			[row]
		);
		expect((tokens[0] as unknown as { theses: number }).theses).toBe(33);
	});

	it('leaves the count alone when the frame omits it', () => {
		const { tokens } = applyScannerWsEvent(
			'SCANNER_UPDATE',
			{ tokens: [{ pairAddress: 'P1', calls: 9 }] } as never,
			[row]
		);
		expect((tokens[0] as unknown as { theses: number }).theses).toBe(28);
		expect((tokens[0] as unknown as { calls: number }).calls).toBe(9);
	});

	it('keeps the identical array reference when nothing matched', () => {
		const current = [row];
		const { tokens } = applyScannerWsEvent(
			'SCANNER_UPDATE',
			{ tokens: [{ pairAddress: 'OTHER', theses: 1 }] } as never,
			current
		);
		expect(tokens).toBe(current);
	});
});
