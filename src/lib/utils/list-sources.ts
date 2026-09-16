import type { TokenSourceFilter, TokenSourceFilterRead, TokenSourceGroup } from '$lib/api/types';

export type SourceKind = 'callers' | 'tgConnections' | 'wallets' | 'theses';

export const SOURCE_KINDS: SourceKind[] = ['callers', 'tgConnections', 'wallets', 'theses'];

export type SourceSelection = {
	ids: Record<SourceKind, string[]>;
	/** id -> group index. Absent or negative means ungrouped. */
	groups: Record<string, number>;
	/** id -> display name, for rendering chips. */
	names: Record<string, string>;
};

export function emptySelection(): SourceSelection {
	return {
		ids: { callers: [], tgConnections: [], wallets: [], theses: [] },
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
	(enriched.groups ?? []).forEach((g: unknown, gi: number) => {
		const group = g as Record<string, unknown>;
		for (const kind of SOURCE_KINDS) take(kind, group[kind] as Entry[] | undefined, gi);
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
	groups: Record<string, number>
): TokenSourceFilter {
	const flat: Record<SourceKind, string[]> = { callers: [], tgConnections: [], wallets: [], theses: [] };
	const buckets = new Map<number, TokenSourceGroup>();

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

	const sources: TokenSourceFilter = {};
	for (const kind of SOURCE_KINDS) if (flat[kind].length > 0) sources[kind] = flat[kind];
	const groupList = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
	if (groupList.length > 0) sources.groups = groupList;
	return sources;
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
