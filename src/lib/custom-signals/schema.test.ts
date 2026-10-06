import { describe, expect, it } from 'vitest';
import {
	allowedOperatorsForField,
	compareCanonicalDecimals,
	parseHistoricalFilterFields,
	parseCustomSignalSchema
} from './schema';
import { unicodeDefaultCaseFold } from './unicode-case-fold';

describe('custom signal runtime schema', () => {
	it('parses the strict v1 DSL and derives operators', () => {
		const schema = parseCustomSignalSchema({
			revision: 4,
			fields: [
				{ key: 'note', type: 'string', required: true, filterable: true },
				{ key: 'tier', type: 'enum', required: false, filterable: true, options: ['Gold', 'Silver'] },
				{ key: 'followers', type: 'number', required: false, filterable: true, integerOnly: true, min: '0', max: '10000000000000000000' },
				{ key: 'verified', type: 'boolean', required: false, filterable: true },
				{ key: 'tags', type: 'list', required: false, filterable: true, itemType: 'string' },
				{ key: 'ratings', type: 'list', required: true, filterable: true, itemType: 'enum', options: ['A', 'B'] },
				{ key: 'scores', type: 'list', required: true, filterable: true, itemType: 'number', integerOnly: false, min: '-1.5', max: '10.25' }
			],
			jsonSchema: {}
		});

		expect(schema.revision).toBe(4);
		expect(allowedOperatorsForField(schema.fields[0])).toEqual(['eq', 'contains']);
		expect(allowedOperatorsForField(schema.fields[1])).toEqual(['in', 'exists']);
		expect(allowedOperatorsForField(schema.fields[4])).toEqual([
			'countEq', 'countGte', 'countLte', 'containsAny', 'containsAll', 'itemContains', 'exists'
		]);
		expect(allowedOperatorsForField(schema.fields[6])).toEqual([
			'countEq', 'countGte', 'countLte', 'itemEq', 'itemGte', 'itemLte', 'itemBetween'
		]);
	});

	it('rejects unapproved DSL fields and Boolean lists', () => {
		expect(() => parseCustomSignalSchema({
			revision: 1,
			fields: [{ key: 'note', type: 'string', required: true, filterable: true, showInFeed: true }],
			jsonSchema: {}
		})).toThrow('Unknown property');
		expect(() => parseCustomSignalSchema({
			revision: 1,
			fields: [{ key: 'flags', type: 'list', itemType: 'boolean', required: false, filterable: true }],
			jsonSchema: {}
		})).toThrow('unsupported list item type');
	});

	it('rejects enum options that collide after Unicode Default Case Folding', () => {
		expect(() => parseCustomSignalSchema({
			revision: 1,
			fields: [{ key: 'tier', type: 'enum', required: true, filterable: true, options: ['Straße', 'STRASSE'] }],
			jsonSchema: {}
		})).toThrow('unique after case folding');
		expect(unicodeDefaultCaseFold('Straße')).toBe('strasse');
		expect(unicodeDefaultCaseFold('ΟΣ')).toBe('οσ');
		expect(unicodeDefaultCaseFold('Cafe\u0301')).toBe('café');
		// Georgian Mtavruli was added after the backend's Unicode 9 fold table.
		expect(unicodeDefaultCaseFold('\u1C90')).toBe('\u1C90');
	});

	it('compares supported decimal bounds without binary floating point', () => {
		expect(compareCanonicalDecimals('9999999999999999999', '10000000000000000000')).toBeLessThan(0);
		expect(compareCanonicalDecimals('-10000000000000000000', '-9999999999999999999')).toBeLessThan(0);
		expect(compareCanonicalDecimals('0.000000000000000001', '0.000000000000000002')).toBeLessThan(0);
		expect(() => parseCustomSignalSchema({
			revision: 1,
			fields: [{ key: 'score', type: 'number', required: true, filterable: true, integerOnly: false, min: '10000000000000000000', max: '9999999999999999999' }],
			jsonSchema: {}
		})).toThrow('min must not exceed max');
	});

	it('parses only the narrow archived filter-field contract', () => {
		expect(parseHistoricalFilterFields([
			{ key: 'oldTier', type: 'enum', everOptional: true, knownEnumOptions: ['Gold'] },
			{ key: 'oldScores', type: 'list', itemType: 'number', everOptional: false }
		])).toHaveLength(2);
		expect(() => parseHistoricalFilterFields([
			{ key: 'oldTier', type: 'enum', everOptional: true, knownEnumOptions: ['Gold'], operator: 'in' }
		])).toThrow('Unknown property');
		expect(() => parseHistoricalFilterFields([
			{ key: 'oldFlags', type: 'list', itemType: 'boolean', everOptional: true }
		])).toThrow('unsupported historical field type');
	});
});
