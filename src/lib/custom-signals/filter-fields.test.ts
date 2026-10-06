import { describe, expect, it } from 'vitest';
import type { CustomMetaFilter, CustomSignalFieldDefinition } from './contracts';
import { requestedHistoricalFieldKeys } from './filter-fields';

describe('custom signal filter-history requests', () => {
	it('requests only fields whose stored predicates cannot use the active schema', () => {
		const fields: CustomSignalFieldDefinition[] = [
			{ key: 'status', type: 'enum', required: true, filterable: true, options: ['active'] },
			{ key: 'followers', type: 'number', required: true, filterable: true, integerOnly: true }
		];
		const filter: CustomMetaFilter = [
			{ field: 'followers', op: 'gte', value: 1000 },
			{ field: 'removed', op: 'contains', value: 'dog' },
			{ field: 'status', op: 'in', value: ['archived'] }
		];

		expect(requestedHistoricalFieldKeys(filter, fields)).toEqual(['removed', 'status']);
	});
});
