import type {
	CustomMetaFilter,
	SavedListIntegrationClause
} from '$lib/custom-signals/contracts';
import { nativeMetaFilter } from '$lib/custom-signals/transport';
import { assertMetaPredicateStructure } from '$lib/custom-signals/predicates';
import {
	jsonNumberFromText,
	supportsExactJsonNumbers
} from '$lib/custom-signals/json-number';
import {
	editableIntegrationClause,
	type EditableSavedListIntegrationClause,
	type SavedListIntegrationCallerIdentity,
	type SavedListIntegrationIdentity
} from '$lib/utils/list-sources';

export const SCANNER_CUSTOM_SIGNALS_QUERY_KEY = 'customSignals';

export type ScannerIntegrationIdentity = SavedListIntegrationIdentity;
export type ScannerIntegrationCallerIdentity = SavedListIntegrationCallerIdentity;
export type ScannerIntegrationClause = EditableSavedListIntegrationClause;

let clauseSequence = 0;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nextClauseId(): string {
	clauseSequence += 1;
	return `scanner-integration-${clauseSequence}`;
}

export function createScannerIntegrationClause(
	integration: ScannerIntegrationIdentity,
	clause: Partial<Pick<SavedListIntegrationClause, 'callerIds' | 'metaFilter'>> = {}
): ScannerIntegrationClause {
	return editableIntegrationClause({
		integrationId: integration.id,
		callerIds: [...(clause.callerIds ?? [])],
		metaFilter: clause.metaFilter ?? []
	}, { uiId: nextClauseId(), integration });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonWithExactNumbers(text: string): unknown {
	type JsonParseWithSource = (
		text: string,
		reviver: (key: string, value: unknown, context?: { source?: string }) => unknown
	) => unknown;
	return (JSON.parse as JsonParseWithSource)(text, (_key, value, context) => {
		if (typeof value !== 'number') return value;
		if (!context?.source || !supportsExactJsonNumbers()) {
			throw new Error('Exact JSON numbers are not supported by this browser');
		}
		return jsonNumberFromText(context.source);
	});
}

function parseStoredClause(value: unknown): ScannerIntegrationClause | null {
	if (!isRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.some((key) => !['integrationId', 'callerIds', 'metaFilter'].includes(key))) return null;
	if (typeof value.integrationId !== 'string' || !UUID_PATTERN.test(value.integrationId)) return null;
	if (!Array.isArray(value.callerIds) || value.callerIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) return null;
	if (new Set(value.callerIds).size !== value.callerIds.length) return null;
	if (!Array.isArray(value.metaFilter)) return null;
	let metaFilter: CustomMetaFilter;
	try {
		for (const predicate of value.metaFilter) assertMetaPredicateStructure(predicate);
		metaFilter = nativeMetaFilter(value.metaFilter as CustomMetaFilter);
	} catch {
		return null;
	}
	return editableIntegrationClause({
		integrationId: value.integrationId,
		callerIds: [...value.callerIds] as string[],
		metaFilter
	}, { uiId: nextClauseId() });
}

export function decodeScannerIntegrationClauses(value: string | null): ScannerIntegrationClause[] {
	if (!value) return [];
	try {
		const parsed = parseJsonWithExactNumbers(value);
		if (!Array.isArray(parsed)) return [];
		const clauses = parsed.map(parseStoredClause);
		return clauses.some((clause) => clause === null)
			? []
			: clauses as ScannerIntegrationClause[];
	} catch {
		return [];
	}
}

export function scannerIntegrationSources(
	clauses: readonly ScannerIntegrationClause[]
): SavedListIntegrationClause[] {
	return clauses.map((clause) => ({
		integrationId: clause.integrationId,
		callerIds: [...clause.callerIds],
		metaFilter: nativeMetaFilter(clause.metaFilter)
	}));
}

export function encodeScannerIntegrationClauses(
	clauses: readonly ScannerIntegrationClause[]
): string | undefined {
	if (clauses.length === 0) return undefined;
	return JSON.stringify(scannerIntegrationSources(clauses));
}

export function withScannerIntegrationSources(
	tokenFilter: Record<string, unknown>,
	clauses: readonly ScannerIntegrationClause[]
): Record<string, unknown> {
	const integrations = scannerIntegrationSources(clauses);
	if (integrations.length === 0) return tokenFilter;
	const currentSources = isRecord(tokenFilter.sources) ? tokenFilter.sources : {};
	return {
		...tokenFilter,
		sources: { ...currentSources, integrations }
	};
}
