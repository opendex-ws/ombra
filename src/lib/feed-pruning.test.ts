import { describe, expect, it } from 'vitest';

/**
 * Windowing bounds the DOM, not the array behind it. These mirror the prepend and
 * paging caps in SwapFeedPanel / ThesisFeedPanel.
 */
const MAX_LIVE = 500;
const MAX_LOADED = 2000;

function prepend<T>(existing: readonly T[], batch: readonly T[], cap: number): T[] {
	return [...[...batch].reverse(), ...existing].slice(0, cap);
}

function appendPage<T>(existing: readonly T[], page: readonly T[], cap: number): T[] {
	return [...existing, ...page].slice(0, cap);
}

function pruneSeen(seen: Set<string>, rendered: readonly { id: string }[], slack: number): Set<string> {
	if (seen.size <= rendered.length + slack) return seen;
	return new Set(rendered.map((r) => r.id));
}

describe('live prepend cap', () => {
	it('keeps the newest rows and drops the tail', () => {
		const existing = Array.from({ length: MAX_LOADED }, (_, i) => `old${i}`);
		const next = prepend(existing, ['a', 'b'], MAX_LOADED);
		expect(next).toHaveLength(MAX_LOADED);
		// batch arrives oldest-first, so the newest ends up at the head
		expect(next.slice(0, 2)).toEqual(['b', 'a']);
		expect(next.at(-1)).toBe(`old${MAX_LOADED - 3}`);
	});

	it('does not grow without bound under sustained load', () => {
		let rows: string[] = [];
		for (let flush = 0; flush < 50; flush++) {
			rows = prepend(rows, Array.from({ length: 100 }, (_, i) => `f${flush}-${i}`), MAX_LOADED);
		}
		expect(rows).toHaveLength(MAX_LOADED);
	});
});

describe('paging cap', () => {
	it('stops the array growing past the ceiling', () => {
		let rows: string[] = [];
		for (let page = 0; page < 20; page++) {
			rows = appendPage(rows, Array.from({ length: 200 }, (_, i) => `p${page}-${i}`), MAX_LOADED);
		}
		expect(rows).toHaveLength(MAX_LOADED);
		// paging appends, so the oldest page is retained at the head
		expect(rows[0]).toBe('p0-0');
	});
});

describe('seen-set pruning', () => {
	it('rebuilds from rendered rows once it outgrows them', () => {
		const rendered = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
		const seen = new Set(Array.from({ length: 5000 }, (_, i) => `x${i}`));
		const pruned = pruneSeen(seen, rendered, MAX_LIVE);
		expect(pruned.size).toBe(10);
		expect(pruned.has('r3')).toBe(true);
	});

	it('leaves a small set alone so dedupe still covers the overlap', () => {
		const rendered = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
		const seen = new Set(['a', 'b']);
		expect(pruneSeen(seen, rendered, MAX_LIVE)).toBe(seen);
	});
});
