import { api, type QueryOf } from '$lib/api/client';
import type { CustomMetaFilter, CustomSignalFieldDefinition } from './contracts';
import { canonicalizeMetaFilter } from './predicates';
import { parseHistoricalFilterFields, type HistoricalFilterFieldDefinition } from './schema';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requestedHistoricalFieldKeys(
	filter: CustomMetaFilter,
	activeFields: readonly CustomSignalFieldDefinition[]
): string[] {
	return [...new Set(filter.flatMap((predicate) => {
		try {
			canonicalizeMetaFilter([predicate], activeFields);
			return [];
		} catch {
			return [predicate.field];
		}
	}))];
}

export async function fetchIntegrationFilterFields(
	integrationId: string,
	fieldKeys: readonly string[]
): Promise<HistoricalFilterFieldDefinition[]> {
	const requested = [...new Set(fieldKeys)];
	if (requested.length === 0) return [];
	const query: QueryOf<'/v2/watchlist/integrations/{integrationId}/filter-fields'> = {
		fieldKeys: JSON.stringify(requested)
	};
	const result = await api.GET('/v2/watchlist/integrations/{integrationId}/filter-fields', {
		params: { path: { integrationId }, query }
	});
	if (!result.response.ok || !isRecord(result.data) || !Array.isArray(result.data.fields)) {
		throw new Error(`Filter history request failed with status ${result.response.status}`);
	}
	return parseHistoricalFilterFields(result.data.fields);
}
