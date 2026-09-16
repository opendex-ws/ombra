import { describe, expect, it } from 'vitest';
import type { TokenSourceFilterRead } from '$lib/api/types';
import {
	SOURCE_KINDS,
	buildSourceFilter,
	normalizeGroups,
	readSourceSelection
} from '$lib/utils/list-sources';

const enriched = {
	callers: [{ id: 'c1', name: '@alpha' }],
	tgConnections: [{ id: 't1', name: 'Chat' }],
	wallets: [{ id: 'w1', name: 'Schoen', walletAddress: 'So1...', chain: 'SOL' }],
	theses: [{ id: 'Auth0r1', name: 'thinker', walletAddress: 'Auth0r1', chain: 'SOL' }],
	groups: [
		{
			callers: [{ id: 'c2', name: '@beta' }],
			theses: [{ id: 'Auth0r2', name: 'poster', walletAddress: 'Auth0r2', chain: 'SOL' }]
		}
	]
} as unknown as TokenSourceFilterRead;

describe('readSourceSelection', () => {
	it('reads every source kind, including thesis authors', () => {
		const sel = readSourceSelection(enriched);
		expect(sel.ids.callers).toEqual(['c1', 'c2']);
		expect(sel.ids.tgConnections).toEqual(['t1']);
		expect(sel.ids.wallets).toEqual(['w1']);
		expect(sel.ids.theses).toEqual(['Auth0r1', 'Auth0r2']);
	});

	it('records group membership and leaves flat members ungrouped', () => {
		const sel = readSourceSelection(enriched);
		expect(sel.groups).toEqual({ c2: 0, Auth0r2: 0 });
		expect(sel.groups.c1).toBeUndefined();
		expect(sel.groups.Auth0r1).toBeUndefined();
	});

	it('keeps display names for chips', () => {
		const sel = readSourceSelection(enriched);
		expect(sel.names.Auth0r1).toBe('thinker');
		expect(sel.names.Auth0r2).toBe('poster');
	});

	it('returns an empty selection when the enriched view is absent', () => {
		const sel = readSourceSelection(null);
		for (const kind of SOURCE_KINDS) expect(sel.ids[kind]).toEqual([]);
		expect(sel.groups).toEqual({});
	});

	it('drops entries with no id and dedupes repeats', () => {
		const sel = readSourceSelection({
			theses: [{ id: 'a' }, { id: null }, { id: 'a' }]
		} as unknown as TokenSourceFilterRead);
		expect(sel.ids.theses).toEqual(['a']);
	});
});

describe('buildSourceFilter', () => {
	it('splits flat and grouped members per kind', () => {
		const out = buildSourceFilter(
			{ callers: ['c1', 'c2'], tgConnections: [], wallets: [], theses: ['a1', 'a2'] },
			{ c2: 0, a2: 0 }
		);
		expect(out.callers).toEqual(['c1']);
		expect(out.theses).toEqual(['a1']);
		expect(out.groups).toEqual([{ callers: ['c2'], theses: ['a2'] }]);
	});

	it('omits empty kinds rather than sending empty arrays', () => {
		const out = buildSourceFilter(
			{ callers: [], tgConnections: [], wallets: [], theses: ['a1'] },
			{}
		);
		expect(out).toEqual({ theses: ['a1'] });
		expect('callers' in out).toBe(false);
		expect('groups' in out).toBe(false);
	});

	it('emits groups in ascending index order', () => {
		const out = buildSourceFilter(
			{ callers: [], tgConnections: [], wallets: [], theses: ['x', 'y'] },
			{ y: 0, x: 1 }
		);
		expect(out.groups).toEqual([{ theses: ['y'] }, { theses: ['x'] }]);
	});

	it('round-trips a read selection without losing thesis authors', () => {
		const sel = readSourceSelection(enriched);
		const out = buildSourceFilter(sel.ids, sel.groups);
		expect(out.theses).toEqual(['Auth0r1']);
		expect(out.groups?.[0]?.theses).toEqual(['Auth0r2']);
		expect(out.callers).toEqual(['c1']);
		expect(out.wallets).toEqual(['w1']);
	});
});

describe('normalizeGroups', () => {
	it('re-packs indices to be contiguous after a removal', () => {
		expect(normalizeGroups({ a: 0, b: 2, c: 2 })).toEqual({ a: 0, b: 1, c: 1 });
	});

	it('drops negative indices', () => {
		expect(normalizeGroups({ a: -1, b: 3 })).toEqual({ b: 0 });
	});
});
