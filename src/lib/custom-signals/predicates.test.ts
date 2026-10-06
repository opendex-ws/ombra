import { describe, expect, it } from 'vitest';
import type { CustomSignalFieldDefinition } from './contracts';
import { jsonNumberFromText } from './json-number';
import { canonicalizeMetaFilter, reconcileMetaFilter } from './predicates';

const fields: CustomSignalFieldDefinition[] = [
	{ key: 'note', type: 'string', required: true, filterable: true },
	{ key: 'tier', type: 'enum', required: false, filterable: true, options: ['Gold', 'Silver'] },
	{ key: 'followers', type: 'number', required: false, filterable: true, integerOnly: true, min: '0', max: '5000' },
	{ key: 'verified', type: 'boolean', required: false, filterable: true },
	{ key: 'tags', type: 'list', required: false, filterable: true, itemType: 'string' },
	{ key: 'scores', type: 'list', required: true, filterable: true, itemType: 'number', integerOnly: false, min: '0.5', max: '10.25' }
];

describe('custom signal metadata predicates', () => {
	it('validates and sorts one native predicate array', () => {
		const filter = canonicalizeMetaFilter([
			{ field: 'tags', op: 'containsAll', value: ['dog', 'college'] },
			{ field: 'followers', op: 'gte', value: 1000 },
			{ field: 'scores', op: 'itemBetween', value: { min: 0.5, max: 10.25 } },
			{ field: 'verified', op: 'exists', value: false }
		], fields);

		expect(filter).toEqual([
			{ field: 'followers', op: 'gte', value: 1000 },
			{ field: 'scores', op: 'itemBetween', value: { min: 0.5, max: 10.25 } },
			{ field: 'tags', op: 'containsAll', value: ['college', 'dog'] },
			{ field: 'verified', op: 'exists', value: false }
		]);
	});

	it('fails closed on wrong operators, values, properties, and bounds', () => {
		expect(() => canonicalizeMetaFilter([{ field: 'verified', op: 'contains', value: 'true' }], fields)).toThrow('Unsupported operator');
		expect(() => canonicalizeMetaFilter([{ field: 'followers', op: 'gte', value: '1000' }], fields)).toThrow('JSON number');
		expect(() => canonicalizeMetaFilter([{ field: 'followers', op: 'gte', value: 1000, revision: 3 }], fields)).toThrow('only field, op, and value');
		expect(() => canonicalizeMetaFilter([{ field: 'followers', op: 'eq', value: 1.5 }], fields)).toThrow('integer');
		expect(() => canonicalizeMetaFilter([{ field: 'scores', op: 'itemEq', value: 0.25 }], fields)).toThrow('cannot be less');
		expect(() => canonicalizeMetaFilter([{ field: 'note', op: 'exists', value: false }], fields)).toThrow('Unsupported operator');
	});

	it('validates and compares exact JSON numbers without rounding them', () => {
		const exactFields: CustomSignalFieldDefinition[] = [
			{ key: 'supply', type: 'number', required: true, filterable: true, integerOnly: true, min: '9007199254740992', max: '9007199254740994' }
		];
		const filter = canonicalizeMetaFilter([
			{ field: 'supply', op: 'gte', value: jsonNumberFromText('9007199254740993') },
			{ field: 'supply', op: 'lte', value: jsonNumberFromText('9007199254740994') }
		], exactFields);
		expect(JSON.stringify(filter)).toBe('[{"field":"supply","op":"gte","value":9007199254740993},{"field":"supply","op":"lte","value":9007199254740994}]');
		expect(() => canonicalizeMetaFilter([
			{ field: 'supply', op: 'gte', value: jsonNumberFromText('9007199254740994') },
			{ field: 'supply', op: 'lte', value: jsonNumberFromText('9007199254740993') }
		], exactFields)).toThrow('Contradictory');
	});

	it('rejects duplicates and the fixed contradiction cases', () => {
		expect(() => canonicalizeMetaFilter([
			{ field: 'followers', op: 'gte', value: 1000 },
			{ field: 'followers', op: 'gte', value: 1000 }
		], fields)).toThrow('Duplicate');
		expect(() => canonicalizeMetaFilter([
			{ field: 'followers', op: 'gte', value: 3000 },
			{ field: 'followers', op: 'lte', value: 2000 }
		], fields)).toThrow('Contradictory');
		expect(() => canonicalizeMetaFilter([
			{ field: 'tags', op: 'countLte', value: 1 },
			{ field: 'tags', op: 'containsAll', value: ['dog', 'college'] }
		], fields)).toThrow('Contradictory');
		expect(() => canonicalizeMetaFilter([
			{ field: 'verified', op: 'exists', value: false },
			{ field: 'verified', op: 'eq', value: true }
		], fields)).toThrow('Contradictory');
	});

	it('removes stale predicates when a schema revision changes', () => {
		const existing = canonicalizeMetaFilter([
			{ field: 'note', op: 'contains', value: 'dog' },
			{ field: 'followers', op: 'gte', value: 1000 }
		], fields);
		const revisedFields = fields.filter((field) => field.key !== 'followers');
		const reconciled = reconcileMetaFilter(existing, revisedFields, [
			{ key: 'followers', type: 'number', everOptional: true }
		]);
		expect(reconciled.editable).toEqual([{ field: 'note', op: 'contains', value: 'dog' }]);
		expect(reconciled.legacy).toEqual([
			expect.objectContaining({
				predicate: { field: 'followers', op: 'gte', value: 1000 },
				legacy: true,
				readOnly: true
			})
		]);
		expect(reconciled.filter).toEqual(existing);
	});

	it('fails closed instead of preserving unproved or invalid legacy data', () => {
		const history = [{ key: 'followers', type: 'number', everOptional: true }] as const;
		expect(() => reconcileMetaFilter([
			{ field: 'removed', op: 'eq', value: 1 }
		], fields, history)).toThrow('Unknown or non-filterable field');
		expect(() => reconcileMetaFilter([
			{ field: 'followers', op: 'contains', value: 'bad' }
		], [], history)).toThrow('Unsupported operator');
		expect(() => reconcileMetaFilter([
			{ field: 'followers', op: 'gte', value: 1 },
			{ field: 'followers', op: 'gte', value: 1 }
		], [], history)).toThrow('Duplicate');
		expect(() => reconcileMetaFilter([
			{ field: 'followers', op: 'exists', value: false },
			{ field: 'followers', op: 'eq', value: 1 }
		], [{ key: 'followers', type: 'number', required: true, filterable: true, integerOnly: true }], history)).toThrow('Contradictory');
	});

	it('uses Unicode Default Case Folding for string and enum operands', () => {
		const unicodeFields: CustomSignalFieldDefinition[] = [
			{ key: 'name', type: 'string', required: true, filterable: true },
			{ key: 'tier', type: 'enum', required: true, filterable: true, options: ['Straße'] }
		];
		expect(canonicalizeMetaFilter([
			{ field: 'tier', op: 'in', value: ['STRASSE'] },
			{ field: 'name', op: 'eq', value: 'Straße' }
		], unicodeFields)).toEqual([
			{ field: 'name', op: 'eq', value: 'strasse' },
			{ field: 'tier', op: 'in', value: ['strasse'] }
		]);
	});

	it('sorts normalized multi-value operands by UTF-8 bytes', () => {
		expect(canonicalizeMetaFilter([
			{ field: 'tags', op: 'containsAll', value: ['\u{10000}', '\uE000'] }
		], fields)).toEqual([
			{ field: 'tags', op: 'containsAll', value: ['\uE000', '\u{10000}'] }
		]);
	});

	it('enforces the shared predicate-count and serialized-size limits', () => {
		expect(() => canonicalizeMetaFilter(
			Array.from({ length: 33 }, (_, index) => ({ field: 'note', op: 'contains', value: `value-${index}` })),
			fields
		)).toThrow('at most 32 predicates');
		expect(() => canonicalizeMetaFilter(
			Array.from({ length: 5 }, (_, index) => ({ field: 'note', op: 'contains', value: `${index}${'x'.repeat(2_047)}` })),
			fields
		)).toThrow('8192 bytes');
	});
});
