import type {
  BotIntegrationSourceRef,
  CustomMetaFilter,
  CustomSignalFeedSubscriptionParams,
  IntegrationSourceIdentity,
  SavedListIntegrationClause
} from '../../src/lib/custom-signals/contracts';

export const integrationIdentity = {
  type: 'INTEGRATION',
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Alpha Desk',
  photoId: null,
  integrationId: '00000000-0000-4000-8000-000000000001',
  integrationName: 'Momentum Signals',
  integrationPhotoId: 'integration-images/momentum.webp'
} satisfies IntegrationSourceIdentity;

export const metaFilter = [
  { field: 'note', op: 'eq', value: 'launch' },
  { field: 'note', op: 'contains', value: 'aun' },
  { field: 'tier', op: 'in', value: ['Gold'] },
  { field: 'followers', op: 'eq', value: 1000 },
  { field: 'followers', op: 'gte', value: 100 },
  { field: 'followers', op: 'lte', value: 5000 },
  { field: 'verified', op: 'eq', value: true },
  { field: 'verified', op: 'exists', value: false },
  { field: 'tags', op: 'countEq', value: 2 },
  { field: 'tags', op: 'countGte', value: 1 },
  { field: 'tags', op: 'countLte', value: 5 },
  { field: 'tags', op: 'containsAny', value: ['college'] },
  { field: 'tags', op: 'containsAll', value: ['college', 'dog'] },
  { field: 'tags', op: 'itemContains', value: 'dog' },
  { field: 'scores', op: 'itemEq', value: 1.25 },
  { field: 'scores', op: 'itemGte', value: 0.5 },
  { field: 'scores', op: 'itemLte', value: 10.25 },
  { field: 'scores', op: 'itemBetween', value: { min: 0.5, max: 10.25 } }
] satisfies CustomMetaFilter;

export const botIntegrationSource = {
  type: 'INTEGRATION',
  integrationId: integrationIdentity.integrationId,
  callerId: integrationIdentity.id,
  metaFilter
} satisfies BotIntegrationSourceRef;

export const botIntegrationSourceAnyCaller = {
  type: 'INTEGRATION',
  integrationId: integrationIdentity.integrationId,
  metaFilter: []
} satisfies BotIntegrationSourceRef;

export const savedListIntegrationClause = {
  integrationId: integrationIdentity.integrationId,
  callerIds: [],
  metaFilter
} satisfies SavedListIntegrationClause;

export const savedListSources = {
  integrations: [savedListIntegrationClause],
  groups: [{ integrations: [{ ...savedListIntegrationClause, callerIds: [integrationIdentity.id] }] }]
};

export const aggregateIntegrationsRest = {
  path: '/v2/watchlist/feed/integrations',
  query: { chains: ['SOL'] }
} as const;

export const integrationSubscriptionParams = {
  chains: ['SOL'],
  metaFilter
} satisfies CustomSignalFeedSubscriptionParams;

export const aggregateIntegrationsSubscription = {
  type: 'subscribe',
  requestId: 'request-aggregate',
  topic: 'watchlist:integrations',
  params: { chains: ['SOL'] }
} as const;

export const builtInCallItem = {
  id: 'builtin-call-1',
  caller: { type: 'CALLER', id: 'builtin-caller', name: 'Built In', photoId: null },
  callDetails: { chain: 'SOL' }
} as const;

export const fullCustomCallItem = {
  id: '00000000-0000-4000-8000-000000000003',
  caller: integrationIdentity,
  callDetails: { chain: 'SOL' },
  callerMeta: {
    integrationId: integrationIdentity.integrationId,
    followers: 1000
  }
} as const;

export const compactRankingTopCall = {
  token: {
    address: 'So11111111111111111111111111111111111111112',
    chain: 'SOL',
    symbol: 'SOL'
  },
  multiplier: '2.50',
  calledAt: '2026-09-29T12:00:00Z'
} as const;

export const invalidCustomSignalShapes = [
  { field: 'followers', op: 'gte', value: '1000' },
  { field: 'tags', op: 'containsAny', value: [] },
  { field: 'scores', op: 'itemBetween', value: { min: 10, max: 1 } },
  { field: 'note', op: 'regex', value: '.*' },
  { field: 'note', op: 'eq', value: 'launch', schemaRevision: 3 },
  { type: 'INTEGRATION', id: integrationIdentity.integrationId },
  { version: 1, metaFilter: [] }
] as const;
