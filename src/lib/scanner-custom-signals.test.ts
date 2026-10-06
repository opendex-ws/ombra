import { describe, expect, it } from 'vitest';
import {
	createScannerIntegrationClause,
	decodeScannerIntegrationClauses,
	encodeScannerIntegrationClauses,
	scannerIntegrationSources,
	withScannerIntegrationSources
} from './scanner-custom-signals';

const INTEGRATION_A = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_B = '22222222-2222-4222-8222-222222222222';
const CALLER_A = '33333333-3333-4333-8333-333333333333';
const CALLER_B = '44444444-4444-4444-8444-444444444444';

describe('scanner Custom Signal filters', () => {
	it('uses one canonical source shape for request bodies, WebSocket params, and cursor identity', () => {
		const clause = createScannerIntegrationClause(
			{ id: INTEGRATION_A, name: 'Desk A', photoId: null },
			{
				callerIds: [CALLER_A, CALLER_B],
				metaFilter: [{ field: 'followers', op: 'gte', value: 1000 }]
			}
		);
		const tokenFilter = withScannerIntegrationSources(
			{ callCount: { min: 2 }, market: { marketCapUsd: { min: 10000 } } },
			[clause]
		);

		expect(tokenFilter).toEqual({
			callCount: { min: 2 },
			market: { marketCapUsd: { min: 10000 } },
			sources: {
				integrations: [{
					integrationId: INTEGRATION_A,
					callerIds: [CALLER_A, CALLER_B],
					metaFilter: [{ field: 'followers', op: 'gte', value: 1000 }]
				}]
			}
		});
		expect(JSON.stringify(tokenFilter)).not.toContain('swapType');
		expect(JSON.stringify(tokenFilter)).not.toContain('uiId');
		expect(JSON.stringify(tokenFilter)).not.toContain('Desk A');
	});

	it('round-trips all clauses through one compact URL value and creates new stable UI ids', () => {
		const clauses = [
			createScannerIntegrationClause({ id: INTEGRATION_A, name: 'Desk A', photoId: null }),
			createScannerIntegrationClause(
				{ id: INTEGRATION_B, name: 'Desk B', photoId: null },
				{ metaFilter: [{ field: 'tags', op: 'containsAny', value: ['alpha', 'beta'] }] }
			)
		];
		const encoded = encodeScannerIntegrationClauses(clauses);
		const restored = decodeScannerIntegrationClauses(encoded ?? null);

		expect(encoded).toBe(JSON.stringify(scannerIntegrationSources(clauses)));
		expect(scannerIntegrationSources(restored)).toEqual(scannerIntegrationSources(clauses));
		expect(new Set(restored.map((clause) => clause.uiId)).size).toBe(2);
		expect(restored.every((clause) => clause.uiId.startsWith('scanner-integration-'))).toBe(true);
		expect(encodeScannerIntegrationClauses([])).toBeUndefined();
	});

	it('drops an invalid restored value instead of sending an untrusted partial filter', () => {
		expect(decodeScannerIntegrationClauses('not-json')).toEqual([]);
		expect(decodeScannerIntegrationClauses(JSON.stringify([
			{ integrationId: 'integration-a', callerIds: [], metaFilter: [] }
		]))).toEqual([]);
		expect(decodeScannerIntegrationClauses(JSON.stringify([
			{ integrationId: INTEGRATION_A, callerIds: ['caller-a'], metaFilter: [] }
		]))).toEqual([]);
		expect(decodeScannerIntegrationClauses(JSON.stringify([
			{ integrationId: INTEGRATION_A, callerIds: [CALLER_A, CALLER_A], metaFilter: [] }
		]))).toEqual([]);
		expect(decodeScannerIntegrationClauses(JSON.stringify([
			{ integrationId: INTEGRATION_A, callerIds: [], metaFilter: [{ field: 'x', op: 'unknown', value: 1 }] }
		]))).toEqual([]);
	});
});
