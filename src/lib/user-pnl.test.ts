import { describe, expect, it } from 'vitest';
import {
	chainRows,
	dexRows,
	historyIsPartial,
	launchpadPlatform,
	launchpadRows,
	seriesPoints,
	sortByImpact,
	totalSeries,
	type UserPnlResponse
} from '$lib/utils/user-pnl';

const metrics = (total: number, active = 0, closed = 0) => ({
	totalPnlUsd: total,
	activePnlUsd: active,
	closedPnlUsd: closed
});

const base = (over: Partial<UserPnlResponse> = {}) =>
	({
		activeHistoryComplete: true,
		asOf: '2026-01-01T00:00:00Z',
		byChain: [],
		byDexProtocol: [],
		byLaunchpad: [],
		from: '2025-12-02T00:00:00Z',
		history: { bucketSeconds: 3600, byChain: [], byDexProtocol: [], byLaunchpad: [], gaps: [], timestamps: [], totals: { activePnlUsd: [], closedPnlUsd: [], totalPnlUsd: [] }, unattributed: {} },
		historyCoverageFrom: '2025-12-02T00:00:00Z',
		range: '30d',
		revision: 'r1',
		totals: metrics(0),
		unattributed: { dexProtocol: metrics(0), launchpad: metrics(0) },
		...over
	}) as unknown as UserPnlResponse;

describe('launchpadPlatform', () => {
	it('uses the canonical platform returned by the API', () => {
		expect(launchpadPlatform({ platformType: 'BAGS' })).toBe('BAGS');
	});
});

describe('breakdown rows', () => {
	it('keys launchpad rows by chain and platform so two chains do not collide', () => {
		const rows = launchpadRows(
			base({
				byLaunchpad: [
					{ chain: 'SOL', platformType: 'BAGS', ...metrics(5) }
				]
			} as never)
		);
		expect(rows[0].key).toBe('SOL:BAGS');
		expect(rows[0].platform).toBe('BAGS');
	});

	it('reads chain and dex rows', () => {
		expect(chainRows(base({ byChain: [{ chain: 'SOL', ...metrics(3) }] } as never))[0].label).toBe('SOL');
		expect(dexRows(base({ byDexProtocol: [{ chain: 'SOL', platformType: 'WHIRLPOOL', ...metrics(3) }] } as never))[0].label).toBe('WHIRLPOOL');
	});

	it('orders by absolute impact, so a big loss outranks a small gain', () => {
		const rows = sortByImpact([
			{ key: 'a', label: 'a', platform: null, metrics: metrics(10) },
			{ key: 'b', label: 'b', platform: null, metrics: metrics(-90) }
		]);
		expect(rows.map((r) => r.key)).toEqual(['b', 'a']);
	});

	it('returns nothing for a missing payload', () => {
		expect(chainRows(null)).toEqual([]);
		expect(launchpadRows(null)).toEqual([]);
	});
});

describe('totalSeries', () => {
	it('pairs timestamps with values', () => {
		const out = totalSeries(
			base({
				history: {
					timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'],
					totals: { totalPnlUsd: [1, 2], activePnlUsd: [], closedPnlUsd: [] },
					gaps: []
				}
			} as never)
		);
		expect(out.map((p) => p.v)).toEqual([1, 2]);
	});

	it('stops at the shorter array rather than inventing points', () => {
		const out = totalSeries(
			base({
				history: {
					timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'],
					totals: { totalPnlUsd: [1], activePnlUsd: [], closedPnlUsd: [] },
					gaps: []
				}
			} as never)
		);
		expect(out).toHaveLength(1);
	});
});

describe('seriesPoints', () => {
	it('flat-lines a constant series instead of dividing by zero', () => {
		expect(seriesPoints([{ t: 1, v: 5 }, { t: 2, v: 5 }], 100, 50)).toBe('0.00,25.00 100.00,25.00');
	});

	it('is empty with no points', () => {
		expect(seriesPoints([], 100, 50)).toBe('');
	});
});

describe('historyIsPartial', () => {
	it('flags an incomplete active history', () => {
		expect(historyIsPartial(base({ activeHistoryComplete: false }))).toBe(true);
	});

	it('flags recorded gaps', () => {
		expect(
			historyIsPartial(base({ history: { gaps: [{ from: 'a', to: 'b' }], timestamps: [], totals: {} } } as never))
		).toBe(true);
	});

	it('is false for a complete range', () => {
		expect(historyIsPartial(base())).toBe(false);
	});
});
