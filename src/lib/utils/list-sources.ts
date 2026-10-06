import type { TokenSourceFilter, TokenSourceFilterRead, TokenSourceGroup } from '$lib/api/types';
import type { CustomMetaFilter, SavedListIntegrationClause } from '$lib/custom-signals/contracts';
import { nativeMetaFilter } from '$lib/custom-signals/transport';

export type SourceKind = 'callers' | 'tgConnections' | 'wallets' | 'theses';

export const SOURCE_KINDS: SourceKind[] = ['callers', 'tgConnections', 'wallets', 'theses'];

export type SourceSelection = {
	ids: Record<SourceKind, string[]>;
	integrations: EditableSavedListIntegrationClause[];
	/** id -> group index. Absent or negative means ungrouped. */
	groups: Record<string, number>;
	/** id -> display name, for rendering chips. */
	names: Record<string, string>;
};

export type EditableSavedListIntegrationClause = SavedListIntegrationClause & {
	/** Form-only identity. It keeps duplicate clauses and group membership distinct. */
	uiId: string;
	integration: SavedListIntegrationIdentity;
	callers: SavedListIntegrationCallerIdentity[];
};

export type SavedListIntegrationIdentity = {
	id: string;
	name: string;
	photoId: string | null;
};

export type SavedListIntegrationCallerIdentity = {
	id: string;
	name: string;
	photoId: string | null;
};

let clauseSequence = 0;

export function newIntegrationClauseUiId(): string {
	clauseSequence += 1;
	return `integration-clause-${clauseSequence}`;
}

export function editableIntegrationClause(
	clause: SavedListIntegrationClause,
	identities: {
		uiId?: string;
		integration?: SavedListIntegrationIdentity;
		callers?: SavedListIntegrationCallerIdentity[];
	} = {}
): EditableSavedListIntegrationClause {
	return {
		uiId: identities.uiId ?? newIntegrationClauseUiId(),
		integrationId: clause.integrationId,
		callerIds: [...clause.callerIds],
		metaFilter: nativeMetaFilter(clause.metaFilter),
		integration: identities.integration ?? { id: clause.integrationId, name: clause.integrationId, photoId: null },
		callers: [...(identities.callers ?? [])]
	};
}

export function emptySelection(): SourceSelection {
	return {
		ids: { callers: [], tgConnections: [], wallets: [], theses: [] },
		integrations: [],
		groups: {},
		names: {}
	};
}

/** Re-pack group indices so they are contiguous 0..k after removals. */
export function normalizeGroups(g: Record<string, number>): Record<string, number> {
	const idx = [...new Set(Object.values(g))].filter((n) => n >= 0).sort((a, b) => a - b);
	const remap = new Map(idx.map((v, i) => [v, i]));
	const out: Record<string, number> = {};
	for (const [id, v] of Object.entries(g)) if (v >= 0 && remap.has(v)) out[id] = remap.get(v)!;
	return out;
}

type Entry = { id?: string | null; name?: string | null };

function readSourceIdentity(value: unknown): SavedListIntegrationIdentity | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const identity = value as Record<string, unknown>;
	if (
		typeof identity.id !== 'string' ||
		typeof identity.name !== 'string' ||
		identity.photoId !== null && typeof identity.photoId !== 'string'
	) return null;
	return { id: identity.id, name: identity.name, photoId: identity.photoId };
}

/** The list read DTO is identity-enriched and intentionally differs from the
 * flat write clause. This parser is the only read-to-edit adapter.
 */
function readIntegrationClause(value: unknown): EditableSavedListIntegrationClause | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const clause = value as Record<string, unknown>;
	const integration = readSourceIdentity(clause.integration);
	if (!integration || !Array.isArray(clause.callers) || !Array.isArray(clause.metaFilter)) return null;
	const callers = clause.callers.map(readSourceIdentity);
	if (callers.some((caller) => caller === null)) return null;
	const callerIdentities = callers as SavedListIntegrationCallerIdentity[];
	return editableIntegrationClause({
		integrationId: integration.id,
		callerIds: callerIdentities.map((caller) => caller.id),
		metaFilter: nativeMetaFilter(clause.metaFilter as CustomMetaFilter)
	}, { integration, callers: callerIdentities });
}

/**
 * Membership comes from the enriched read view, which is the only shape that
 * carries display names. Every kind must be read here or its members are
 * dropped on the next save, since `buildSourceFilter` rebuilds from scratch.
 */
export function readSourceSelection(enriched: TokenSourceFilterRead | null | undefined): SourceSelection {
	const sel = emptySelection();
	if (!enriched) return sel;

	const take = (kind: SourceKind, entries: Entry[] | null | undefined, groupIndex?: number) => {
		for (const e of entries ?? []) {
			if (!e?.id) continue;
			sel.ids[kind].push(e.id);
			if (groupIndex !== undefined) sel.groups[e.id] = groupIndex;
			if (e.name) sel.names[e.id] = e.name;
		}
	};

	const source = enriched as Record<string, unknown>;
	for (const kind of SOURCE_KINDS) take(kind, source[kind] as Entry[] | undefined);
	for (const value of (source.integrations as unknown[] | undefined) ?? []) {
		const clause = readIntegrationClause(value);
		if (clause) sel.integrations.push(clause);
	}
	(enriched.groups ?? []).forEach((g: unknown, gi: number) => {
		const group = g as Record<string, unknown>;
		for (const kind of SOURCE_KINDS) take(kind, group[kind] as Entry[] | undefined, gi);
		for (const value of (group.integrations as unknown[] | undefined) ?? []) {
			const clause = readIntegrationClause(value);
			if (!clause) continue;
			sel.integrations.push(clause);
			sel.groups[clause.uiId] = gi;
		}
	});

	for (const kind of SOURCE_KINDS) sel.ids[kind] = [...new Set(sel.ids[kind])];
	sel.groups = normalizeGroups(sel.groups);
	return sel;
}

/**
 * Split each selected id into its group (AND-of-groups) or the flat list
 * (ungrouped, contributing only to the call count).
 */
export function buildSourceFilter(
	ids: Record<SourceKind, string[]>,
	groups: Record<string, number>,
	integrations: readonly EditableSavedListIntegrationClause[] = []
): TokenSourceFilter {
	type IntegrationSourceGroup = Omit<TokenSourceGroup, 'integrations'> & {
		integrations?: SavedListIntegrationClause[];
	};
	type IntegrationSourceFilter = Omit<TokenSourceFilter, 'integrations' | 'groups'> & {
		integrations?: SavedListIntegrationClause[];
		groups?: IntegrationSourceGroup[];
	};
	const flat: Record<SourceKind, string[]> & { integrations: SavedListIntegrationClause[] } = {
		callers: [], tgConnections: [], wallets: [], theses: [], integrations: []
	};
	const buckets = new Map<number, IntegrationSourceGroup>();

	for (const kind of SOURCE_KINDS) {
		for (const id of ids[kind] ?? []) {
			const gi = groups[id];
			if (gi === undefined || gi < 0) {
				flat[kind].push(id);
			} else {
				let bucket = buckets.get(gi);
				if (!bucket) { bucket = {}; buckets.set(gi, bucket); }
				((bucket[kind] ??= []) as string[]).push(id);
			}
		}
	}

	for (const clause of integrations) {
		const stored: SavedListIntegrationClause = {
			integrationId: clause.integrationId,
			callerIds: [...clause.callerIds],
			metaFilter: nativeMetaFilter(clause.metaFilter)
		};
		const gi = groups[clause.uiId];
		if (gi === undefined || gi < 0) {
			flat.integrations.push(stored);
		} else {
			let bucket = buckets.get(gi);
			if (!bucket) { bucket = {}; buckets.set(gi, bucket); }
			(bucket.integrations ??= []).push(stored);
		}
	}

	const sources: IntegrationSourceFilter = {};
	for (const kind of SOURCE_KINDS) if (flat[kind].length > 0) sources[kind] = flat[kind];
	if (flat.integrations.length > 0) sources.integrations = flat.integrations;
	const groupList = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
	if (groupList.length > 0) sources.groups = groupList;
	return sources as unknown as TokenSourceFilter;
}

type SourceRow = { id?: string | null; source?: string | null };

/**
 * The source catalogs are keyed by id — a wallet address for thesis authors —
 * and an author posting on more than one platform can arrive once per platform.
 * Those rows select the same member, so collapse them; a duplicate id would
 * otherwise render twice and both copies would highlight as selected.
 *
 * Cursor pages are appended, so this also absorbs a row repeated across pages.
 * The platform mark is dropped when the merged rows disagree on it.
 */
export function dedupeSourceItems<T extends SourceRow>(items: T[]): T[] {
	const byId = new Map<string, T>();
	const conflicted = new Set<string>();

	for (const item of items) {
		const id = item?.id;
		if (!id) continue;
		const existing = byId.get(id);
		if (!existing) {
			byId.set(id, { ...item });
			continue;
		}
		if (existing.source !== item.source) conflicted.add(id);
	}

	for (const id of conflicted) {
		const merged = byId.get(id);
		if (merged) merged.source = null;
	}

	return [...byId.values()];
}
