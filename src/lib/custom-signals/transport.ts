import type { CustomMetaFilter } from './contracts';
import { isExactJsonNumber, jsonNumberFromText, supportsExactJsonNumbers } from './json-number';
import { MAX_META_FILTER_BYTES, assertMetaFilterEnvelope } from './predicates';

const EXACT_NUMBER_SUPPORT_ERROR = 'This browser cannot preserve exact JSON numbers in metaFilter URLs';

type JsonParseWithSource = (
	text: string,
	reviver: (key: string, value: unknown, context?: { source?: string }) => unknown
) => unknown;

function serializedMetaFilter(filter: readonly unknown[]): string {
	const serialized = JSON.stringify(filter);
	if (serialized === undefined) throw new Error('Metadata filter is not serializable');
	if (new TextEncoder().encode(serialized).byteLength > MAX_META_FILTER_BYTES) {
		throw new Error(`Metadata filter cannot exceed ${MAX_META_FILTER_BYTES} bytes`);
	}
	return serialized;
}

/** Return the JSON text used as the single REST metaFilter query value.
 * Empty filters are omitted so omitted and [] have one request identity.
 */
export function encodeRestMetaFilter(filter: CustomMetaFilter): string | undefined {
	assertMetaFilterEnvelope(filter);
	return filter.length === 0 ? undefined : serializedMetaFilter(filter);
}

/** Add one metaFilter value. URLSearchParams performs the required URL encoding. */
export function setRestMetaFilter(params: URLSearchParams, filter: CustomMetaFilter): URLSearchParams {
	params.delete('metaFilter');
	const encoded = encodeRestMetaFilter(filter);
	if (encoded !== undefined) params.set('metaFilter', encoded);
	return params;
}

/** Parse the one allowed REST/URL value before schema validation. */
export function decodeRestMetaFilter(params: URLSearchParams): unknown[] | undefined {
	const values = params.getAll('metaFilter');
	if (values.length === 0) return undefined;
	if (values.length !== 1) throw new Error('Only one metaFilter value is allowed');
	const text = values[0];
	if (!text) throw new Error('metaFilter must not be empty');
	if (new TextEncoder().encode(text).byteLength > MAX_META_FILTER_BYTES) {
		throw new Error(`Metadata filter cannot exceed ${MAX_META_FILTER_BYTES} bytes`);
	}
	let value: unknown;
	try {
		value = (JSON.parse as JsonParseWithSource)(text, (_key, parsed, context) => {
			if (typeof parsed !== 'number') return parsed;
			if (!context?.source || !supportsExactJsonNumbers()) throw new Error(EXACT_NUMBER_SUPPORT_ERROR);
			return jsonNumberFromText(context.source);
		});
	} catch (cause) {
		if (cause instanceof Error && cause.message === EXACT_NUMBER_SUPPORT_ERROR) throw cause;
		throw new Error('metaFilter must be valid JSON');
	}
	if (!Array.isArray(value)) throw new Error('metaFilter must be a JSON array');
	assertMetaFilterEnvelope(value);
	return value;
}

/** Native JSON form for WebSocket, saved-list, and bot payloads. */
export function nativeMetaFilter(filter: CustomMetaFilter): CustomMetaFilter {
	assertMetaFilterEnvelope(filter);
	serializedMetaFilter(filter);
	return filter.map((predicate) => ({
		...predicate,
		value: isExactJsonNumber(predicate.value)
			? predicate.value
			: Array.isArray(predicate.value)
			? [...predicate.value]
			: typeof predicate.value === 'object' && predicate.value !== null
				? { ...predicate.value }
				: predicate.value
	})) as CustomMetaFilter;
}
