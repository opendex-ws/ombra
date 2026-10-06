import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '$lib/api/client';
import {
	BUILT_IN_WATCHLIST_TABS,
	buildIntegrationRankingQuery,
	buildRuntimeWatchlistTabs,
	fetchIntegrationWatchlistFeed,
	integrationFeedRestQuery,
	integrationFeedSubscriptionParams,
	integrationIdFromTab,
	integrationRankingTopic,
	integrationRankingSubscriptionParams,
	integrationRankingPageItems,
	integrationTabKey,
	parseIntegrationCallerCatalog,
	parseIntegrationDiscovery,
	type IntegrationCallerSourceItem
} from './custom-integrations';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('custom signal watchlist discovery', () => {
	it('keeps all built-in tabs and adds one tab for each enabled integration', () => {
		const discovery = parseIntegrationDiscovery({
			enabled: true,
			integrations: [
				{ id: 'integration-a', name: 'Desk A', photoId: 'user-images/a.webp', enabled: true },
				{ id: 'integration-b', name: 'Desk B', photoId: null, enabled: false },
				{ id: 'integration-c', name: 'Desk C', photoId: null, enabled: true }
			]
		});

		const tabs = buildRuntimeWatchlistTabs(discovery);
		expect(tabs.map((tab) => tab.key)).toEqual([
			...BUILT_IN_WATCHLIST_TABS,
			'integration:integration-a',
			'integration:integration-c'
		]);
		expect(tabs.map((tab) => tab.label)).toEqual([
			'Callers',
			'Telegram',
			'Lists',
			'Wallets',
			'Desk A',
			'Desk C'
		]);
		expect(tabs.some((tab) => tab.label === 'All Integrations')).toBe(false);
	});

	it('shows no integration tabs while the organization feature is disabled', () => {
		const tabs = buildRuntimeWatchlistTabs({
			enabled: false,
			integrations: [{ id: 'integration-a', name: 'Desk A', photoId: null, enabled: true }]
		});
		expect(tabs.map((tab) => tab.key)).toEqual(BUILT_IN_WATCHLIST_TABS);
	});

	it('uses an unambiguous tab key for direct integration navigation', () => {
		const tab = integrationTabKey('caller-looking-id');
		expect(tab).toBe('integration:caller-looking-id');
		expect(integrationIdFromTab(tab)).toBe('caller-looking-id');
		expect(integrationIdFromTab('Callers')).toBeNull();
	});

	it('rejects a malformed integration descriptor', () => {
		expect(() => parseIntegrationDiscovery({
			enabled: true,
			integrations: [{
				id: 'integration-a',
				name: 'Desk A',
				photoId: null,
				enabled: 'yes'
			}]
		})).toThrow('Integration enabled must be a Boolean');
	});
});

describe('custom signal watchlist request transport', () => {
	const metaFilter = [
		{ field: 'followers', op: 'gte' as const, value: 1000 },
		{ field: 'tags', op: 'containsAll' as const, value: ['college', 'dog'] }
	];

	it('sends REST metadata predicates as one JSON text parameter', () => {
		expect(integrationFeedRestQuery({ minMarketcap: '1000' }, metaFilter)).toEqual({
			minMarketcap: '1000',
			metaFilter: JSON.stringify(metaFilter)
		});
		expect(integrationFeedRestQuery({ minMarketcap: '1000' }, [])).toEqual({ minMarketcap: '1000' });
	});

	it('sends integration feed filters as flat query parameters', async () => {
		const get = vi.spyOn(api, 'GET').mockResolvedValue({
			data: { items: [] },
			response: { ok: true, status: 200 }
		} as never);
		const query = integrationFeedRestQuery({
			minMarketcap: '1000',
			chains: ['SOL'],
			cursor: 'opaque-next'
		}, metaFilter);

		await fetchIntegrationWatchlistFeed('integration-a', null, query);

		expect(get).toHaveBeenCalledWith('/v2/watchlist/feed/integrations/{integrationId}', {
			params: {
				path: { integrationId: 'integration-a' },
				query: {
					minMarketcap: '1000',
					chains: ['SOL'],
					cursor: 'opaque-next',
					metaFilter: JSON.stringify(metaFilter)
				}
			}
		});
	});

	it('sends caller feed filters as flat query parameters', async () => {
		const get = vi.spyOn(api, 'GET').mockResolvedValue({
			data: { items: [] },
			response: { ok: true, status: 200 }
		} as never);
		const query = integrationFeedRestQuery({ maxPrice: '5', cursor: 'caller-next' }, metaFilter);

		await fetchIntegrationWatchlistFeed('integration-a', 'caller-a', query);

		expect(get).toHaveBeenCalledWith('/v2/watchlist/sources/integrations/{callerId}/feed', {
			params: {
				path: { callerId: 'caller-a' },
				query: {
					maxPrice: '5',
					cursor: 'caller-next',
					metaFilter: JSON.stringify(metaFilter)
				}
			}
		});
	});

	it('sends WebSocket metadata predicates as a native array', () => {
		const params = integrationFeedSubscriptionParams({ endCursor: 'cursor-a' }, metaFilter);
		expect(params).toEqual({ endCursor: 'cursor-a', metaFilter });
		expect(params.metaFilter).toEqual(metaFilter);
		expect(integrationFeedSubscriptionParams({ endCursor: 'cursor-a' }, [])).toEqual({ endCursor: 'cursor-a' });
	});

	it('keeps requests on the applied metadata filter while a new draft is edited', () => {
		const applied = metaFilter;
		const draft = [{ field: 'followers', op: 'lte' as const, value: 50 }];
		expect(integrationFeedRestQuery({}, applied).metaFilter).toBe(JSON.stringify(applied));
		expect(integrationFeedSubscriptionParams({}, applied).metaFilter).toEqual(applied);
		expect(integrationFeedRestQuery({}, applied).metaFilter).not.toBe(JSON.stringify(draft));
	});

	it('uses the fixed integration ranking topic without client organization data', () => {
		expect(integrationRankingTopic('integration-a')).toBe('watchlist:ranking:integrations:integration-a');
	});

	it('shares all normal ranking values between REST and WebSocket without metadata filters', () => {
		const query = buildIntegrationRankingQuery({
			timeframe: '7d', rankBy: 'winRatePct', orderBy: 'asc',
			winRatePctMin: '20.5', winRatePctMax: '90', totalCallsMin: '2', totalCallsMax: '50',
			performanceScoreMin: '5', performanceScoreMax: '25'
		}, 'next-page');
		expect(query).toEqual({
			timeframe: '7d', rankBy: 'winRatePct', orderBy: 'asc', cursor: 'next-page',
			winRatePctMin: 20.5, winRatePctMax: 90, totalCallsMin: 2, totalCallsMax: 50,
			performanceScoreMin: 5, performanceScoreMax: 25
		});
		expect(integrationRankingSubscriptionParams({ ...query, metaFilter: [{ field: 'x' }] }, 'page-window')).toEqual({
			timeframe: '7d', rankBy: 'winRatePct', orderBy: 'asc', endCursor: 'page-window',
			winRatePctMin: 20.5, winRatePctMax: 90, totalCallsMin: 2, totalCallsMax: 50,
			performanceScoreMin: 5, performanceScoreMax: 25
		});
	});

	it('rejects invalid normal ranking ranges', () => {
		const base = { timeframe: '30d' as const, rankBy: 'performanceScore' as const, orderBy: 'desc' as const };
		expect(() => buildIntegrationRankingQuery({ ...base, totalCallsMin: '1.5' })).toThrow('integer');
		expect(() => buildIntegrationRankingQuery({ ...base, winRatePctMin: '80', winRatePctMax: '20' })).toThrow('minimum');
		expect(() => buildIntegrationRankingQuery({ ...base, performanceScoreMax: '31' })).toThrow('through 30');
	});

	it('replaces the visible ranking page instead of appending an earlier page', () => {
		const oldItem = { source: { id: 'old' } } as never;
		const nextItem = { source: { id: 'next' } } as never;
		const nextPage = { items: [nextItem] } as never;
		const visible = integrationRankingPageItems(nextPage);
		expect(visible).toEqual([nextItem]);
		expect(visible).not.toContain(oldItem);
	});
});

describe('custom signal caller catalog', () => {
	const automation: IntegrationCallerSourceItem['automation'] = {
		hasBot: true,
		bots: [{
			id: 'bot-a',
			isEnabled: true,
			source: {
				type: 'INTEGRATION',
				id: 'opaque-caller-uuid',
				name: 'Case Sensitive Caller',
				photoId: 'user-images/caller.webp',
				integrationId: 'integration-a',
				integrationName: 'Current integration name',
				integrationPhotoId: 'user-images/integration.webp'
			}
		}]
	};
	const source = {
		type: 'INTEGRATION',
		id: 'opaque-caller-uuid',
		name: 'Case Sensitive Caller',
		photoId: 'user-images/caller.webp',
		integrationId: 'integration-a',
		integrationName: 'Current integration name',
		integrationPhotoId: 'user-images/integration.webp',
		automation
	};

	it('keeps the opaque caller identity and current caller and integration presentation', () => {
		const catalog = parseIntegrationCallerCatalog({
			sources: [source],
			cursor: '',
			nextCursor: 'opaque-next',
			totalCount: 1
		}, 'integration-a');

		expect(catalog.sources[0]).toMatchObject(source);
		expect(catalog.cursor).toBe('');
		expect(catalog.nextCursor).toBe('opaque-next');
		expect(catalog.totalCount).toBe(1);
	});

	it('rejects a caller returned under a different integration', () => {
		expect(() => parseIntegrationCallerCatalog({ sources: [source] }, 'integration-b'))
			.toThrow('Caller belongs to a different integration');
	});
});
