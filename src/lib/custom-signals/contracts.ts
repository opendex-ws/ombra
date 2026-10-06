import type { JsonNumber } from './json-number';

export type CustomSignalFieldDefinition =
  | { key: string; type: 'string'; required: boolean; filterable: boolean }
  | { key: string; type: 'enum'; required: boolean; filterable: boolean; options: string[] }
  | { key: string; type: 'number'; required: boolean; filterable: boolean; integerOnly: boolean; min?: string; max?: string }
  | { key: string; type: 'boolean'; required: boolean; filterable: boolean }
  | { key: string; type: 'list'; required: boolean; filterable: boolean; itemType: 'string' }
  | { key: string; type: 'list'; required: boolean; filterable: boolean; itemType: 'enum'; options: string[] }
  | { key: string; type: 'list'; required: boolean; filterable: boolean; itemType: 'number'; integerOnly: boolean; min?: string; max?: string };

export type CustomMetaPredicate =
  | { field: string; op: 'eq' | 'contains' | 'itemContains'; value: string }
  | { field: string; op: 'in' | 'containsAny' | 'containsAll'; value: string[] }
  | { field: string; op: 'eq' | 'gte' | 'lte' | 'itemEq' | 'itemGte' | 'itemLte'; value: JsonNumber }
  | { field: string; op: 'eq' | 'exists'; value: boolean }
  | { field: string; op: 'countEq' | 'countGte' | 'countLte'; value: number }
  | { field: string; op: 'itemBetween'; value: { min: JsonNumber; max: JsonNumber } };

export type CustomMetaFilter = CustomMetaPredicate[];

export interface CustomSignalSchemaResponse {
  revision: number;
  fields: CustomSignalFieldDefinition[];
  jsonSchema: Record<string, unknown>;
}

export interface CustomSignalIntegrationDescriptor {
  id: string;
  name: string;
  photoId: string | null;
  enabled: boolean;
}

export interface CustomSignalIntegrationsResponse {
  enabled: boolean;
  integrations: CustomSignalIntegrationDescriptor[];
}

export interface IntegrationSourceIdentity {
  type: 'INTEGRATION';
  id: string;
  name: string;
  photoId: string | null;
  integrationId: string;
  integrationName: string;
  integrationPhotoId: string | null;
}

export type CustomSignalCallerMeta = {
  integrationId: string;
  [field: string]: unknown;
};

export interface BotIntegrationSourceRef {
  type: 'INTEGRATION';
  integrationId: string;
  callerId?: string;
  metaFilter: CustomMetaFilter;
}

export interface SavedListIntegrationClause {
  integrationId: string;
  callerIds: string[];
  metaFilter: CustomMetaFilter;
}

export interface CustomSignalFeedSubscriptionParams {
  startCursor?: string;
  endCursor?: string;
  chains?: string[];
  minPrice?: string;
  maxPrice?: string;
  minMultiplier?: string;
  maxMultiplier?: string;
  minMarketcap?: string;
  maxMarketcap?: string;
  metaFilter?: CustomMetaFilter;
}
