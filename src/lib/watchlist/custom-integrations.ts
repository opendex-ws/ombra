import {
	api,
	type QueryOf,
	type WatchlistFeedResponse,
	type WatchlistRankItem,
	type WatchlistRankingResponse
} from '$lib/api/client';
import type { components } from '$lib/api/v2.d.ts';
import type {
	CustomMetaFilter,
	CustomSignalIntegrationDescriptor,
	CustomSignalIntegrationsResponse
} from '$lib/custom-signals/contracts';
import { parseCustomSignalSchema, type ParsedCustomSignalSchema } from '$lib/custom-signals/schema';
import { encodeRestMetaFilter, nativeMetaFilter } from '$lib/custom-signals/transport';

export const BUILT_IN_WATCHLIST_TABS = ['Callers', 'Telegram', 'Lists', 'Wallets'] as const;

export type BuiltInWatchlistTab = (typeof BUILT_IN_WATCHLIST_TABS)[number];
export type IntegrationWatchlistTab = `integration:${string}`;
export type RuntimeWatchlistTab = BuiltInWatchlistTab | IntegrationWatchlistTab;

export type RuntimeWatchlistTabDescriptor = {
	key: RuntimeWatchlistTab;
	label: string;
	integration?: CustomSignalIntegrationDescriptor;
};

export type IntegrationCallerSourceItem = components['schemas']['CustomSignalWatchlistSourceItem'];

export type IntegrationCallerCatalog = {
	sources: IntegrationCallerSourceItem[];
	cursor?: string;
	prevCursor?: string;
	nextCursor?: string;
	totalCount?: number;
};

export type IntegrationRankingQueryState = {
	timeframe: '1d' | '3d' | '7d' | '30d';
	rankBy: 'performanceScore' | 'winRatePct' | 'totalCalls' | 'averageMultiplier' | 'highestMultiplier';
	orderBy: 'asc' | 'desc';
	winRatePctMin?: string;
	winRatePctMax?: string;
	totalCallsMin?: string;
	totalCallsMax?: string;
	performanceScoreMin?: string;
	performanceScoreMax?: string;
};

export type IntegrationFeedQuery = QueryOf<'/v2/watchlist/feed/integrations/{integrationId}'>;
type IntegrationRankingQuery = QueryOf<'/v2/watchlist/ranking/integrations/{integrationId}'>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function nullableString(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a string or null`);
	return value;
}

function optionalCursor(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	return requiredString(value, field);
}

function requestCursor(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') throw new Error(`${field} must be a string`);
	return value;
}

function parseIntegrationDescriptor(value: unknown): CustomSignalIntegrationDescriptor {
	if (!isRecord(value)) throw new Error('Integration descriptor must be an object');
	if (typeof value.enabled !== 'boolean') throw new Error('Integration enabled must be a Boolean');
	return {
		id: requiredString(value.id, 'Integration id'),
		name: requiredString(value.name, 'Integration name'),
		photoId: nullableString(value.photoId, 'Integration photoId'),
		enabled: value.enabled
	};
}

export function parseIntegrationDiscovery(value: unknown): CustomSignalIntegrationsResponse {
	if (!isRecord(value)) throw new Error('Integration discovery must be an object');
	if (typeof value.enabled !== 'boolean') throw new Error('Custom signals enabled must be a Boolean');
	if (!Array.isArray(value.integrations)) throw new Error('Integration discovery integrations must be an array');
	return {
		enabled: value.enabled,
		integrations: value.integrations.map(parseIntegrationDescriptor)
	};
}

function parseIntegrationCaller(value: unknown, integrationId: string): IntegrationCallerSourceItem {
	if (!isRecord(value)) throw new Error('Integration caller source must be an object');
	if (value.type !== 'INTEGRATION') throw new Error('Integration caller source type must be INTEGRATION');
	if (!isRecord(value.automation) || !Array.isArray(value.automation.bots) || typeof value.automation.hasBot !== 'boolean') {
		throw new Error('Integration caller source automation is invalid');
	}
	const sourceIntegrationId = requiredString(value.integrationId, 'Caller integrationId');
	if (sourceIntegrationId !== integrationId) throw new Error('Caller belongs to a different integration');
	return {
		type: 'INTEGRATION',
		id: requiredString(value.id, 'Caller id'),
		name: requiredString(value.name, 'Caller name'),
		photoId: nullableString(value.photoId, 'Caller photoId'),
		integrationId: sourceIntegrationId,
		integrationName: requiredString(value.integrationName, 'Caller integrationName'),
		integrationPhotoId: nullableString(value.integrationPhotoId, 'Caller integrationPhotoId'),
		automation: value.automation as IntegrationCallerSourceItem['automation']
	};
}

export function parseIntegrationCallerCatalog(
	value: unknown,
	integrationId: string
): IntegrationCallerCatalog {
	if (!isRecord(value) || !Array.isArray(value.sources)) {
		throw new Error('Integration caller catalog must contain sources');
	}
	if (value.totalCount !== undefined && (!Number.isSafeInteger(value.totalCount) || (value.totalCount as number) < 0)) {
		throw new Error('Integration caller catalog totalCount must be a non-negative integer');
	}
	return {
		sources: value.sources.map((source) => parseIntegrationCaller(source, integrationId)),
		cursor: requestCursor(value.cursor, 'Caller catalog cursor'),
		prevCursor: optionalCursor(value.prevCursor, 'Caller catalog prevCursor'),
		nextCursor: optionalCursor(value.nextCursor, 'Caller catalog nextCursor'),
		...(value.totalCount === undefined ? {} : { totalCount: value.totalCount as number })
	};
}

export async function fetchIntegrationDiscovery(): Promise<CustomSignalIntegrationsResponse> {
	const result = await api.GET('/v2/watchlist/integrations');
	if (!result.response.ok || result.data === undefined) {
		throw new Error(`Runtime request failed with status ${result.response.status}`);
	}
	return parseIntegrationDiscovery(result.data);
}

export async function fetchIntegrationSchema(integrationId: string): Promise<ParsedCustomSignalSchema> {
	const result = await api.GET('/v2/watchlist/integrations/{integrationId}/schema', {
		params: { path: { integrationId } }
	});
	if (!result.response.ok || result.data === undefined) {
		throw new Error(`Runtime request failed with status ${result.response.status}`);
	}
	return parseCustomSignalSchema(result.data);
}

export async function fetchIntegrationCallers(
	integrationId: string,
	query: { search?: string; cursor?: string } = {}
): Promise<IntegrationCallerCatalog> {
	const params: QueryOf<'/v2/watchlist/sources/integrations/{integrationId}'> = {
		...(query.search ? { search: query.search } : {}),
		...(query.cursor ? { cursor: query.cursor } : {})
	};
	const result = await api.GET('/v2/watchlist/sources/integrations/{integrationId}', {
		params: { path: { integrationId }, query: params }
	});
	if (!result.response.ok || result.data === undefined) {
		throw new Error(`Runtime request failed with status ${result.response.status}`);
	}
	return parseIntegrationCallerCatalog(result.data, integrationId);
}

export async function fetchIntegrationWatchlistFeed(
	integrationId: string,
	callerId: string | null,
	query: IntegrationFeedQuery
): Promise<WatchlistFeedResponse> {
	const result = callerId
		? await api.GET('/v2/watchlist/sources/integrations/{callerId}/feed', {
			params: { path: { callerId }, query }
		})
		: await api.GET('/v2/watchlist/feed/integrations/{integrationId}', {
			params: { path: { integrationId }, query }
		});
	if (!result.response.ok || result.data === undefined) {
		throw new Error(`Runtime request failed with status ${result.response.status}`);
	}
	const value = result.data;
	if (!isRecord(value) || !Array.isArray(value.items)) {
		throw new Error('Integration watchlist feed must contain items');
	}
	return value as WatchlistFeedResponse;
}

export function integrationFeedRestQuery(
	query: IntegrationFeedQuery,
	metaFilter: CustomMetaFilter
): IntegrationFeedQuery {
	const encoded = encodeRestMetaFilter(metaFilter);
	return encoded !== undefined
		? { ...query, metaFilter: encoded }
		: { ...query };
}

export function integrationFeedSubscriptionParams(
	params: Record<string, unknown>,
	metaFilter: CustomMetaFilter
): Record<string, unknown> {
	return metaFilter.length > 0
		? { ...params, metaFilter: nativeMetaFilter(metaFilter) }
		: { ...params };
}

export async function fetchIntegrationRanking(
	integrationId: string,
	query: IntegrationRankingQuery
): Promise<WatchlistRankingResponse> {
	const result = await api.GET('/v2/watchlist/ranking/integrations/{integrationId}', {
		params: { path: { integrationId }, query }
	});
	if (!result.response.ok || result.data === undefined) {
		throw new Error(`Runtime request failed with status ${result.response.status}`);
	}
	const value = result.data;
	if (!isRecord(value) || !Array.isArray(value.items)) {
		throw new Error('Integration ranking must contain items');
	}
	return value as WatchlistRankingResponse;
}

function optionalRankingNumber(
	value: string | undefined,
	name: string,
	minimum: number,
	maximum: number,
	integer: boolean
): number | undefined {
	if (value === undefined || value.trim() === '') return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) {
		throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} from ${minimum} through ${maximum}`);
	}
	return parsed;
}

export function buildIntegrationRankingQuery(
	state: IntegrationRankingQueryState,
	cursor?: string
): IntegrationRankingQuery {
	const query: IntegrationRankingQuery = {
		timeframe: state.timeframe,
		rankBy: state.rankBy,
		orderBy: state.orderBy
	};
	if (cursor) query.cursor = cursor;
	const ranges = [
		['winRatePct', optionalRankingNumber(state.winRatePctMin, 'Minimum win rate', 0, 100, false), optionalRankingNumber(state.winRatePctMax, 'Maximum win rate', 0, 100, false)],
		['totalCalls', optionalRankingNumber(state.totalCallsMin, 'Minimum total calls', 0, 2_147_483_647, true), optionalRankingNumber(state.totalCallsMax, 'Maximum total calls', 0, 2_147_483_647, true)],
		['performanceScore', optionalRankingNumber(state.performanceScoreMin, 'Minimum performance score', 0, 30, true), optionalRankingNumber(state.performanceScoreMax, 'Maximum performance score', 0, 30, true)]
	] as const;
	for (const [key, minimum, maximum] of ranges) {
		if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
			throw new Error(`${key} minimum cannot exceed maximum`);
		}
		if (minimum !== undefined) query[`${key}Min`] = minimum;
		if (maximum !== undefined) query[`${key}Max`] = maximum;
	}
	return query;
}

export function integrationRankingSubscriptionParams(
	query: Record<string, unknown>,
	pageCursor?: string
): Record<string, unknown> {
	const { cursor: _cursor, metaFilter: _metaFilter, ...params } = query;
	if (pageCursor) params.endCursor = pageCursor;
	return params;
}

export function integrationRankingPageItems(page: WatchlistRankingResponse): WatchlistRankItem[] {
	return [...page.items];
}

export function integrationRankingTopic(integrationId: string): string {
	return `watchlist:ranking:integrations:${integrationId}`;
}

export async function fetchIntegrationCallerRanking(
	integrationId: string,
	callerId: string,
	timeframe: string
): Promise<WatchlistRankingResponse> {
	const query: QueryOf<'/v2/watchlist/ranking/integrations/{integrationId}/{callerId}'> = {
		timeframe: timeframe as IntegrationRankingQueryState['timeframe']
	};
	const result = await api.GET('/v2/watchlist/ranking/integrations/{integrationId}/{callerId}', {
		params: { path: { integrationId, callerId }, query }
	});
	if (!result.response.ok || result.data === undefined) {
		throw new Error(`Runtime request failed with status ${result.response.status}`);
	}
	const value = result.data;
	if (!isRecord(value) || !Array.isArray(value.items)) {
		throw new Error('Integration caller ranking must contain items');
	}
	return value as WatchlistRankingResponse;
}

export function integrationTabKey(integrationId: string): IntegrationWatchlistTab {
	return `integration:${integrationId}`;
}

export function integrationIdFromTab(tab: RuntimeWatchlistTab): string | null {
	return tab.startsWith('integration:') ? tab.slice('integration:'.length) || null : null;
}

export function buildRuntimeWatchlistTabs(
	discovery: CustomSignalIntegrationsResponse | null
): RuntimeWatchlistTabDescriptor[] {
	const builtIn = BUILT_IN_WATCHLIST_TABS.map((key) => ({ key, label: key }));
	if (!discovery?.enabled) return builtIn;
	return [
		...builtIn,
		...discovery.integrations
			.filter((integration) => integration.enabled)
			.map((integration) => ({
				key: integrationTabKey(integration.id),
				label: integration.name,
				integration
			}))
	];
}
