import type { CustomMetaFilter, CustomMetaPredicate, CustomSignalFieldDefinition } from './contracts';
import {
	canonicalDecimalFromJsonNumber,
	isExactJsonNumber,
	type JsonNumber
} from './json-number';
import {
	MAX_LIST_ITEMS,
	META_OPERATORS,
	allowedOperatorsForField,
	compareCanonicalDecimals,
	historicalFilterFieldsToDefinitions,
	type HistoricalFilterFieldDefinition,
	type MetaOperator
} from './schema';
import { unicodeDefaultCaseFold } from './unicode-case-fold';

export const MAX_META_FILTER_PREDICATES = 32;
export const MAX_META_FILTER_BYTES = 8_192;

export function assertMetaFilterEnvelope(value: readonly unknown[]): void {
	if (value.length > MAX_META_FILTER_PREDICATES) {
		throw new Error(`Metadata filter can have at most ${MAX_META_FILTER_PREDICATES} predicates`);
	}
	const serialized = JSON.stringify(value);
	if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_META_FILTER_BYTES) {
		throw new Error(`Metadata filter cannot exceed ${MAX_META_FILTER_BYTES} bytes`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertMetaPredicateStructure(value: unknown): asserts value is CustomMetaPredicate {
	if (!isRecord(value)) throw new Error('Metadata predicates must be objects');
	const keys = Object.keys(value);
	if (keys.length !== 3 || !keys.includes('field') || !keys.includes('op') || !keys.includes('value')) {
		throw new Error('Each metadata predicate must contain only field, op, and value');
	}
	if (typeof value.field !== 'string' || typeof value.op !== 'string') {
		throw new Error('Metadata predicate field and op must be strings');
	}
	if (!META_OPERATORS.some((operator) => operator === value.op)) {
		throw new Error('Metadata predicate operator is not supported');
	}
	if (value.op === 'exists' && typeof value.value !== 'boolean') throw new Error('exists requires a Boolean');
	if (value.op === 'in' || value.op === 'containsAny' || value.op === 'containsAll') {
		if (!Array.isArray(value.value) || value.value.length === 0 || value.value.some((item) => typeof item !== 'string')) {
			throw new Error(`${value.op} requires a non-empty string array`);
		}
		return;
	}
	if ((value.op === 'contains' || value.op === 'itemContains') && typeof value.value !== 'string') {
		throw new Error(`${value.op} requires a string`);
	}
	if (value.op === 'countEq' || value.op === 'countGte' || value.op === 'countLte') {
		if (!Number.isInteger(value.value) || (value.value as number) < 0) throw new Error(`${value.op} requires a non-negative integer`);
		return;
	}
	if (value.op === 'itemBetween') {
		if (!isRecord(value.value)
			|| Object.keys(value.value).length !== 2
			|| (typeof value.value.min !== 'number' && !isExactJsonNumber(value.value.min))
			|| (typeof value.value.max !== 'number' && !isExactJsonNumber(value.value.max))) {
			throw new Error('itemBetween requires numeric min and max values');
		}
		return;
	}
	if (value.op === 'eq') {
		if (typeof value.value !== 'string'
			&& typeof value.value !== 'boolean'
			&& typeof value.value !== 'number'
			&& !isExactJsonNumber(value.value)) throw new Error('eq requires a scalar value');
		return;
	}
	if (value.op !== 'exists' && value.op !== 'contains' && value.op !== 'itemContains'
		&& typeof value.value !== 'number' && !isExactJsonNumber(value.value)) {
		throw new Error(`${value.op} requires a JSON number`);
	}
}

function normalizeText(value: unknown, maximum = 2_048): string {
	if (typeof value !== 'string') throw new Error('Filter value must be a string');
	const normalized = value.trim().normalize('NFC');
	if (!normalized) throw new Error('Filter value must not be empty');
	if ([...normalized].length > maximum) throw new Error(`Filter value cannot exceed ${maximum} characters`);
	return normalized;
}

function normalizeSearchText(value: unknown, maximum?: number): string {
	return unicodeDefaultCaseFold(normalizeText(value, maximum));
}

function normalizeNumber(value: unknown, field: CustomSignalFieldDefinition): JsonNumber {
	if (typeof value !== 'number' && !isExactJsonNumber(value) || typeof value === 'number' && !Number.isFinite(value)) {
		throw new Error(`${field.key} requires a JSON number`);
	}
	const normalized = typeof value === 'number' && Object.is(value, -0) ? 0 : value as JsonNumber;
	const exact = canonicalDecimalFromJsonNumber(normalized);
	if ('integerOnly' in field && field.integerOnly && exact.includes('.')) {
		throw new Error(`${field.key} requires an integer`);
	}
	const unsigned = exact.startsWith('-') ? exact.slice(1) : exact;
	const [integer, fraction = ''] = unsigned.split('.');
	if (integer.length > 20 || fraction.length > 18) throw new Error(`${field.key} is outside the supported number range`);
	if ('min' in field && field.min !== undefined && compareCanonicalDecimals(exact, field.min) < 0) {
		throw new Error(`${field.key} cannot be less than ${field.min}`);
	}
	if ('max' in field && field.max !== undefined && compareCanonicalDecimals(exact, field.max) > 0) {
		throw new Error(`${field.key} cannot exceed ${field.max}`);
	}
	return normalized;
}

function normalizeCount(value: unknown): number {
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_LIST_ITEMS) {
		throw new Error(`List count must be an integer from 0 through ${MAX_LIST_ITEMS}`);
	}
	return value as number;
}

function normalizeStringSet(value: unknown, field: CustomSignalFieldDefinition): string[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIST_ITEMS) {
		throw new Error(`Filter value must contain 1 through ${MAX_LIST_ITEMS} items`);
	}
	const enumOptions = 'options' in field
		? new Set(field.options.map((option) => unicodeDefaultCaseFold(option)))
		: undefined;
	const normalized = value.map((item) => {
		const text = normalizeSearchText(item, enumOptions ? 256 : 2_048);
		if (enumOptions && !enumOptions.has(text)) throw new Error(`${String(item)} is not an option for ${field.key}`);
		return text;
	});
	normalized.sort(compareUtf8);
	if (normalized.some((item, index) => index > 0 && item === normalized[index - 1])) {
		throw new Error('Filter array values must be unique');
	}
	return normalized;
}

function canonicalOperand(
	field: CustomSignalFieldDefinition,
	op: MetaOperator,
	value: unknown
): CustomMetaPredicate['value'] {
	switch (op) {
		case 'exists':
			if (typeof value !== 'boolean') throw new Error('exists requires a Boolean');
			return value;
		case 'countEq':
		case 'countGte':
		case 'countLte':
			return normalizeCount(value);
		case 'contains':
		case 'itemContains':
			return normalizeSearchText(value);
		case 'in':
		case 'containsAny':
		case 'containsAll':
			return normalizeStringSet(value, field);
		case 'gte':
		case 'lte':
		case 'itemEq':
		case 'itemGte':
		case 'itemLte':
			return normalizeNumber(value, field);
		case 'itemBetween': {
			if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'min') || !Object.hasOwn(value, 'max')) {
				throw new Error('itemBetween requires only min and max');
			}
			const min = normalizeNumber(value.min, field);
			const max = normalizeNumber(value.max, field);
			if (compareCanonicalDecimals(canonicalDecimalFromJsonNumber(min), canonicalDecimalFromJsonNumber(max)) > 0) {
				throw new Error('itemBetween min cannot exceed max');
			}
			return { min, max };
		}
		case 'eq':
			if (field.type === 'string') return normalizeSearchText(value);
			if (field.type === 'number') return normalizeNumber(value, field);
			if (field.type === 'boolean') {
				if (typeof value !== 'boolean') throw new Error(`${field.key} requires a Boolean`);
				return value;
			}
			throw new Error(`eq is not valid for ${field.key}`);
	}
}

function canonicalOperandKey(value: CustomMetaPredicate['value']): string {
	if (typeof value === 'number' || isExactJsonNumber(value)) return canonicalDecimalFromJsonNumber(value);
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return `{"min":${canonicalDecimalFromJsonNumber(value.min)},"max":${canonicalDecimalFromJsonNumber(value.max)}}`;
	}
	const serialized = JSON.stringify(value);
	if (serialized === undefined) throw new Error('Metadata filter value is not serializable');
	return serialized;
}

function compareUtf8(left: string, right: string): number {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const width = Math.min(leftBytes.length, rightBytes.length);
	for (let index = 0; index < width; index += 1) {
		if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
	}
	return leftBytes.length - rightBytes.length;
}

export function compareMetaPredicates(left: CustomMetaPredicate, right: CustomMetaPredicate): number {
	return compareUtf8(left.field, right.field) || compareUtf8(left.op, right.op) || compareUtf8(canonicalOperandKey(left.value), canonicalOperandKey(right.value));
}

export function metaPredicateIdentity(predicate: CustomMetaPredicate): string {
	return `${predicate.field}\u0000${predicate.op}\u0000${canonicalOperandKey(predicate.value)}`;
}

function assertNoContradictions(predicates: readonly CustomMetaPredicate[]): void {
	const byField = new Map<string, CustomMetaPredicate[]>();
	for (const predicate of predicates) {
		const group = byField.get(predicate.field) ?? [];
		group.push(predicate);
		byField.set(predicate.field, group);
	}

	for (const [field, group] of byField) {
		const existsFalse = group.some((item) => item.op === 'exists' && item.value === false);
		if (existsFalse && group.some((item) => item.op !== 'exists' || item.value === true)) {
			throw new Error(`Contradictory predicates for ${field}`);
		}

		const scalarEqual = group.filter((item) => item.op === 'eq');
		if (new Set(scalarEqual.map((item) => canonicalOperandKey(item.value))).size > 1) {
			throw new Error(`Contradictory predicates for ${field}`);
		}
		const stringEqual = scalarEqual.find((item) => typeof item.value === 'string')?.value;
		if (typeof stringEqual === 'string' && group.some((item) => item.op === 'contains' && typeof item.value === 'string' && !stringEqual.includes(item.value))) {
			throw new Error(`Contradictory predicates for ${field}`);
		}

		const enumSets = group.filter((item) => item.op === 'in').map((item) => new Set(item.value as string[]));
		if (enumSets.length > 1) {
			const intersection = [...enumSets[0]].filter((value) => enumSets.slice(1).every((set) => set.has(value)));
			if (intersection.length === 0) throw new Error(`Contradictory predicates for ${field}`);
		}

		const numericEquals = scalarEqual
			.filter((item) => typeof item.value === 'number' || isExactJsonNumber(item.value))
			.map((item) => canonicalDecimalFromJsonNumber(item.value as JsonNumber));
		const lower = group
			.filter((item) => item.op === 'gte')
			.map((item) => canonicalDecimalFromJsonNumber(item.value as JsonNumber))
			.reduce<string | undefined>((current, value) => current === undefined || compareCanonicalDecimals(value, current) > 0 ? value : current, undefined);
		const upper = group
			.filter((item) => item.op === 'lte')
			.map((item) => canonicalDecimalFromJsonNumber(item.value as JsonNumber))
			.reduce<string | undefined>((current, value) => current === undefined || compareCanonicalDecimals(value, current) < 0 ? value : current, undefined);
		if (
			(lower !== undefined && upper !== undefined && compareCanonicalDecimals(lower, upper) > 0) ||
			numericEquals.some((value) =>
				(lower !== undefined && compareCanonicalDecimals(value, lower) < 0) ||
				(upper !== undefined && compareCanonicalDecimals(value, upper) > 0)
			)
		) {
			throw new Error(`Contradictory predicates for ${field}`);
		}

		const countEquals = group.filter((item) => item.op === 'countEq').map((item) => item.value as number);
		const countLower = Math.max(...group.filter((item) => item.op === 'countGte').map((item) => item.value as number), 0);
		const countUpper = Math.min(...group.filter((item) => item.op === 'countLte').map((item) => item.value as number), MAX_LIST_ITEMS);
		if (
			countLower > countUpper ||
			new Set(countEquals).size > 1 ||
			countEquals.some((value) => value < countLower || value > countUpper)
		) {
			throw new Error(`Contradictory predicates for ${field}`);
		}
		const effectiveUpper = countEquals[0] ?? countUpper;
		const itemOperators = new Set(['containsAny', 'containsAll', 'itemContains', 'itemEq', 'itemGte', 'itemLte', 'itemBetween']);
		if (effectiveUpper === 0 && group.some((item) => itemOperators.has(item.op))) {
			throw new Error(`Contradictory predicates for ${field}`);
		}
		const requiredItems = new Set(
			group.filter((item) => item.op === 'containsAll').flatMap((item) => item.value as string[])
		).size;
		if (requiredItems > effectiveUpper) throw new Error(`Contradictory predicates for ${field}`);
	}
}

export function canonicalizeMetaFilter(
	value: unknown,
	fields: readonly CustomSignalFieldDefinition[]
): CustomMetaFilter {
	let submittedJson: string;
	try {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) throw new Error('not serializable');
		submittedJson = serialized;
	} catch {
		throw new Error('Metadata filter must be valid JSON');
	}
	if (new TextEncoder().encode(submittedJson).byteLength > MAX_META_FILTER_BYTES) {
		throw new Error(`Metadata filter cannot exceed ${MAX_META_FILTER_BYTES} bytes`);
	}
	if (!Array.isArray(value)) throw new Error('Metadata filter must be an array');
	assertMetaFilterEnvelope(value);

	const fieldMap = new Map(fields.map((field) => [field.key, field]));
	const canonical = value.map((predicate): CustomMetaPredicate => {
		assertMetaPredicateStructure(predicate);
		const field = fieldMap.get(predicate.field);
		if (!field || !field.filterable) throw new Error(`Unknown or non-filterable field: ${predicate.field}`);
		const operators = allowedOperatorsForField(field);
		if (!operators.includes(predicate.op as MetaOperator)) throw new Error(`Unsupported operator for ${field.key}`);
		const op = predicate.op as MetaOperator;
		return { field: field.key, op, value: canonicalOperand(field, op, predicate.value) } as CustomMetaPredicate;
	});
	canonical.sort(compareMetaPredicates);
	for (let index = 1; index < canonical.length; index += 1) {
		if (compareMetaPredicates(canonical[index - 1], canonical[index]) === 0) {
			throw new Error('Duplicate metadata predicate');
		}
	}
	assertNoContradictions(canonical);
	if (new TextEncoder().encode(JSON.stringify(canonical)).byteLength > MAX_META_FILTER_BYTES) {
		throw new Error(`Metadata filter cannot exceed ${MAX_META_FILTER_BYTES} bytes`);
	}
	return canonical;
}

export interface LegacyMetaPredicate {
	predicate: CustomMetaPredicate;
	legacy: true;
	readOnly: true;
	reason: string;
}

export interface MetaFilterReconciliation {
	filter: CustomMetaFilter;
	editable: CustomMetaFilter;
	legacy: LegacyMetaPredicate[];
}

function stableFieldType(field: CustomSignalFieldDefinition): string {
	return field.type === 'list' ? `list:${field.itemType}` : field.type;
}

/** Preserve predicates that the active schema can no longer generate.
 * Legacy rows stay in the wire filter and can only be removed by the UI.
 */
export function reconcileMetaFilter(
	value: unknown,
	fields: readonly CustomSignalFieldDefinition[],
	historicalFields: readonly HistoricalFilterFieldDefinition[]
): MetaFilterReconciliation {
	const historyDefinitions = historicalFilterFieldsToDefinitions(historicalFields);
	const historyByKey = new Map(historyDefinitions.map((field) => [field.key, field]));
	const activeByKey = new Map(fields.map((field) => [field.key, field]));
	for (const field of fields) {
		const historical = historyByKey.get(field.key);
		if (historical && stableFieldType(historical) !== stableFieldType(field)) {
			throw new Error(`Historical field type does not match active field: ${field.key}`);
		}
	}
	const validationFields = [
		...fields.map((field) => historyByKey.get(field.key) ?? field),
		...historyDefinitions.filter((field) => !activeByKey.has(field.key))
	];
	const filter = canonicalizeMetaFilter(value, validationFields);
	const editable: CustomMetaFilter = [];
	const legacy: LegacyMetaPredicate[] = [];
	for (const predicate of filter) {
		try {
			const [active] = canonicalizeMetaFilter([predicate], fields);
			editable.push(active);
		} catch (cause) {
			if (!historyByKey.has(predicate.field)) throw cause;
			legacy.push({
				predicate,
				legacy: true,
				readOnly: true,
				reason: cause instanceof Error ? cause.message : 'Not available in the active schema'
			});
		}
	}
	return { filter, editable, legacy };
}
