import type { CustomSignalFieldDefinition } from './contracts';
import { canonicalDecimalFromNumber } from './json-number';
import { unicodeDefaultCaseFold } from './unicode-case-fold';

export { canonicalDecimalFromNumber } from './json-number';

export const MAX_CUSTOM_SIGNAL_FIELDS = 32;
export const MAX_ENUM_OPTIONS = 64;
export const MAX_LIST_ITEMS = 64;

export const META_OPERATORS = [
	'eq',
	'contains',
	'in',
	'gte',
	'lte',
	'exists',
	'countEq',
	'countGte',
	'countLte',
	'containsAny',
	'containsAll',
	'itemContains',
	'itemEq',
	'itemGte',
	'itemLte',
	'itemBetween'
] as const;

export type MetaOperator = (typeof META_OPERATORS)[number];

export interface ParsedCustomSignalSchema {
	revision: number;
	fields: CustomSignalFieldDefinition[];
	jsonSchema: Record<string, unknown>;
}

export type HistoricalFilterFieldDefinition =
	| { key: string; type: 'string'; everOptional: boolean }
	| { key: string; type: 'enum'; everOptional: boolean; knownEnumOptions: string[] }
	| { key: string; type: 'number'; everOptional: boolean }
	| { key: string; type: 'boolean'; everOptional: boolean }
	| { key: string; type: 'list'; itemType: 'string'; everOptional: boolean }
	| { key: string; type: 'list'; itemType: 'enum'; everOptional: boolean; knownEnumOptions: string[] }
	| { key: string; type: 'list'; itemType: 'number'; everOptional: boolean };

const RESERVED_KEYS = new Set(['tokenaddress', 'pairaddress', 'chain', 'callername', 'calleravatar', 'integrationid']);
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = []
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new Error(`Unknown property: ${key}`);
	}
	for (const key of required) {
		if (!Object.hasOwn(value, key)) throw new Error(`Missing property: ${key}`);
	}
}

function normalizedText(value: unknown, maximum: number, name: string): string {
	if (typeof value !== 'string') throw new Error(`${name} must be a string`);
	const normalized = value.trim().normalize('NFC');
	if (!normalized) throw new Error(`${name} must not be empty`);
	if ([...normalized].length > maximum) throw new Error(`${name} is too long`);
	return normalized;
}

function parseCanonicalBound(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new Error(`${name} must be a canonical decimal string`);
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value) || value === '-0') {
		throw new Error(`${name} must be a canonical decimal string`);
	}
	const unsigned = value.startsWith('-') ? value.slice(1) : value;
	const [integer, fraction = ''] = unsigned.split('.');
	if (integer.length > 20 || fraction.length > 18) throw new Error(`${name} is outside the supported range`);
	return value;
}

export function compareCanonicalDecimals(left: string, right: string): number {
	const leftNegative = left.startsWith('-');
	const rightNegative = right.startsWith('-');
	if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;
	const leftUnsigned = leftNegative ? left.slice(1) : left;
	const rightUnsigned = rightNegative ? right.slice(1) : right;
	const [leftInteger, leftFraction = ''] = leftUnsigned.split('.');
	const [rightInteger, rightFraction = ''] = rightUnsigned.split('.');
	let absolute = leftInteger.length - rightInteger.length;
	if (absolute === 0) absolute = leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
	if (absolute === 0) {
		const width = Math.max(leftFraction.length, rightFraction.length);
		const leftPadded = leftFraction.padEnd(width, '0');
		const rightPadded = rightFraction.padEnd(width, '0');
		absolute = leftPadded < rightPadded ? -1 : leftPadded > rightPadded ? 1 : 0;
	}
	return leftNegative ? -absolute : absolute;
}

function parseOptions(value: unknown, field: string, maximum?: number): string[] {
	if (!Array.isArray(value) || value.length === 0 || maximum !== undefined && value.length > maximum) {
		throw new Error(maximum === undefined
			? `${field} must have at least one enum option`
			: `${field} must have 1 through ${maximum} enum options`);
	}
	const options = value.map((option) => normalizedText(option, 256, `${field} option`));
	const normalizedOptions = new Set<string>();
	for (const option of options) {
		const folded = unicodeDefaultCaseFold(option);
		if (normalizedOptions.has(folded)) throw new Error(`${field} enum options must be unique after case folding`);
		normalizedOptions.add(folded);
	}
	return options;
}

function parseBaseField(value: Record<string, unknown>): {
	key: string;
	type: unknown;
	required: boolean;
	filterable: boolean;
} {
	const key = value.key;
	if (typeof key !== 'string' || !FIELD_KEY.test(key) || RESERVED_KEYS.has(key.toLowerCase())) {
		throw new Error('Invalid custom signal field key');
	}
	if (typeof value.required !== 'boolean' || typeof value.filterable !== 'boolean') {
		throw new Error(`${key} must declare required and filterable as booleans`);
	}
	return { key, type: value.type, required: value.required, filterable: value.filterable };
}

function parseNumberProperties(
	value: Record<string, unknown>,
	key: string
): { integerOnly: boolean; min?: string; max?: string } {
	if (typeof value.integerOnly !== 'boolean') throw new Error(`${key}.integerOnly must be a boolean`);
	const min = Object.hasOwn(value, 'min') ? parseCanonicalBound(value.min, `${key}.min`) : undefined;
	const max = Object.hasOwn(value, 'max') ? parseCanonicalBound(value.max, `${key}.max`) : undefined;
	if (min !== undefined && max !== undefined && compareCanonicalDecimals(min, max) > 0) {
		throw new Error(`${key}.min must not exceed max`);
	}
	if (value.integerOnly && [min, max].some((bound) => bound?.includes('.'))) {
		throw new Error(`${key} bounds must be integers`);
	}
	return { integerOnly: value.integerOnly, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

function parseField(value: unknown): CustomSignalFieldDefinition {
	if (!isRecord(value)) throw new Error('Custom signal fields must be objects');
	const base = parseBaseField(value);

	switch (base.type) {
		case 'string':
		case 'boolean':
			assertExactKeys(value, ['key', 'type', 'required', 'filterable']);
			return { ...base, type: base.type };
		case 'enum':
			assertExactKeys(value, ['key', 'type', 'required', 'filterable', 'options']);
			return { ...base, type: 'enum', options: parseOptions(value.options, base.key, MAX_ENUM_OPTIONS) };
		case 'number': {
			assertExactKeys(value, ['key', 'type', 'required', 'filterable', 'integerOnly'], ['min', 'max']);
			return { ...base, type: 'number', ...parseNumberProperties(value, base.key) };
		}
		case 'list': {
			if (value.itemType === 'string') {
				assertExactKeys(value, ['key', 'type', 'required', 'filterable', 'itemType']);
				return { ...base, type: 'list', itemType: 'string' };
			}
			if (value.itemType === 'enum') {
				assertExactKeys(value, ['key', 'type', 'required', 'filterable', 'itemType', 'options']);
				return { ...base, type: 'list', itemType: 'enum', options: parseOptions(value.options, base.key, MAX_ENUM_OPTIONS) };
			}
			if (value.itemType === 'number') {
				assertExactKeys(value, ['key', 'type', 'required', 'filterable', 'itemType', 'integerOnly'], ['min', 'max']);
				return { ...base, type: 'list', itemType: 'number', ...parseNumberProperties(value, base.key) };
			}
			throw new Error(`${base.key} has an unsupported list item type`);
		}
		default:
			throw new Error(`${base.key} has an unsupported field type`);
	}
}

export function parseCustomSignalFields(value: unknown): CustomSignalFieldDefinition[] {
	if (!Array.isArray(value) || value.length > MAX_CUSTOM_SIGNAL_FIELDS) {
		throw new Error(`Custom signal schema can have at most ${MAX_CUSTOM_SIGNAL_FIELDS} fields`);
	}
	const fields = value.map(parseField);
	const keys = new Set<string>();
	for (const field of fields) {
		const folded = field.key.toLowerCase();
		if (keys.has(folded)) throw new Error(`Duplicate custom signal field: ${field.key}`);
		keys.add(folded);
	}
	return fields;
}

export function parseCustomSignalSchema(value: unknown): ParsedCustomSignalSchema {
	if (!isRecord(value)) throw new Error('Custom signal schema must be an object');
	assertExactKeys(value, ['revision', 'fields', 'jsonSchema']);
	if (!Number.isSafeInteger(value.revision) || (value.revision as number) <= 0) {
		throw new Error('Custom signal schema revision must be a positive integer');
	}
	if (!isRecord(value.jsonSchema)) {
		throw new Error('Custom signal jsonSchema must be an object');
	}
	return { revision: value.revision as number, fields: parseCustomSignalFields(value.fields), jsonSchema: value.jsonSchema };
}

export function allowedOperatorsForField(field: CustomSignalFieldDefinition): MetaOperator[] {
	const operators: MetaOperator[] = [];
	if (field.type === 'string') operators.push('eq', 'contains');
	else if (field.type === 'enum') operators.push('in');
	else if (field.type === 'number') operators.push('eq', 'gte', 'lte');
	else if (field.type === 'boolean') operators.push('eq');
	else {
		operators.push('countEq', 'countGte', 'countLte');
		if (field.itemType === 'string') operators.push('containsAny', 'containsAll', 'itemContains');
		else if (field.itemType === 'enum') operators.push('containsAny', 'containsAll');
		else operators.push('itemEq', 'itemGte', 'itemLte', 'itemBetween');
	}
	if (!field.required) operators.push('exists');
	return operators;
}

export function historicalFilterFieldsToDefinitions(
	fields: readonly HistoricalFilterFieldDefinition[]
): CustomSignalFieldDefinition[] {
	const keys = new Set<string>();
	return fields.map((field): CustomSignalFieldDefinition => {
		if (!FIELD_KEY.test(field.key) || RESERVED_KEYS.has(field.key.toLowerCase())) {
			throw new Error('Invalid historical filter field key');
		}
		const foldedKey = field.key.toLowerCase();
		if (keys.has(foldedKey)) throw new Error(`Duplicate historical filter field: ${field.key}`);
		keys.add(foldedKey);
		const base = { key: field.key, required: !field.everOptional, filterable: true };
		if (field.type === 'string' || field.type === 'boolean') return { ...base, type: field.type };
		if (field.type === 'enum') return { ...base, type: 'enum', options: parseOptions(field.knownEnumOptions, field.key) };
		if (field.type === 'number') return { ...base, type: 'number', integerOnly: false };
		if (field.itemType === 'string') return { ...base, type: 'list', itemType: 'string' };
		if (field.itemType === 'enum') return { ...base, type: 'list', itemType: 'enum', options: parseOptions(field.knownEnumOptions, field.key) };
		return { ...base, type: 'list', itemType: 'number', integerOnly: false };
	});
}

export function parseHistoricalFilterFields(value: unknown): HistoricalFilterFieldDefinition[] {
	if (!Array.isArray(value) || value.length > MAX_CUSTOM_SIGNAL_FIELDS) {
		throw new Error(`Filter history can have at most ${MAX_CUSTOM_SIGNAL_FIELDS} fields`);
	}
	const parsed = value.map((item): HistoricalFilterFieldDefinition => {
		if (!isRecord(item)) throw new Error('Filter history fields must be objects');
		if (typeof item.key !== 'string' || typeof item.everOptional !== 'boolean') {
			throw new Error('Filter history fields require key and everOptional');
		}
		if (item.type === 'string' || item.type === 'number' || item.type === 'boolean') {
			assertExactKeys(item, ['key', 'type', 'everOptional']);
			return { key: item.key, type: item.type, everOptional: item.everOptional };
		}
		if (item.type === 'enum') {
			assertExactKeys(item, ['key', 'type', 'everOptional', 'knownEnumOptions']);
			return {
				key: item.key,
				type: 'enum',
				everOptional: item.everOptional,
				knownEnumOptions: parseOptions(item.knownEnumOptions, item.key)
			};
		}
		if (item.type === 'list' && item.itemType === 'string') {
			assertExactKeys(item, ['key', 'type', 'itemType', 'everOptional']);
			return { key: item.key, type: 'list', itemType: 'string', everOptional: item.everOptional };
		}
		if (item.type === 'list' && item.itemType === 'enum') {
			assertExactKeys(item, ['key', 'type', 'itemType', 'everOptional', 'knownEnumOptions']);
			return {
				key: item.key,
				type: 'list',
				itemType: 'enum',
				everOptional: item.everOptional,
				knownEnumOptions: parseOptions(item.knownEnumOptions, item.key)
			};
		}
		if (item.type === 'list' && item.itemType === 'number') {
			assertExactKeys(item, ['key', 'type', 'itemType', 'everOptional']);
			return { key: item.key, type: 'list', itemType: 'number', everOptional: item.everOptional };
		}
		throw new Error(`${item.key} has an unsupported historical field type`);
	});
	// Reuse the strict DSL validator for keys, reserved names, and duplicates.
	historicalFilterFieldsToDefinitions(parsed);
	return parsed;
}
