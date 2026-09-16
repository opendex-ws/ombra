import { describe, expect, it } from 'vitest';
import { assignSlots, buildMoneyFlow, createFlowAccumulator, nodeRadius, pulseIntensity, ribbonGeometry, ribbonWidth, ringCapacity, slotPosition, type FlowSwap } from '$lib/utils/money-flow';

function swap(over: Partial<FlowSwap> & { id: string }): FlowSwap {
	return {
		walletAddress: 'W1',
		chain: 'SOL',
		token: { address: 'A', symbol: 'AAA' },
		side: 'BUY',
		amountUsd: 100,
		timestamp: 1_000,
		...over
	};
}

describe('buildMoneyFlow', () => {
	it('splits volume into inflow (buys) and outflow (sells) per token', () => {
		const flow = buildMoneyFlow([
			swap({ id: '1', side: 'BUY', amountUsd: 300 }),
			swap({ id: '2', side: 'SELL', amountUsd: 120 }),
			swap({ id: '3', side: 'BUY', amountUsd: 80 })
		]);
		expect(flow.nodes).toHaveLength(1);
		expect(flow.nodes[0]).toMatchObject({ inUsd: 380, outUsd: 120, totalUsd: 500, count: 3 });
		expect(flow.totalInUsd).toBe(380);
		expect(flow.totalOutUsd).toBe(120);
	});

	it('never links two tokens — strands come from and go to nowhere', () => {
		const flow = buildMoneyFlow([
			swap({ id: '1', side: 'SELL', token: { address: 'A', symbol: 'AAA' }, timestamp: 1 }),
			swap({ id: '2', side: 'BUY', token: { address: 'B', symbol: 'BBB' }, timestamp: 2 })
		]);
		expect(flow.nodes.map((n) => n.address).sort()).toEqual(['A', 'B']);
		// the same wallet rotating A -> B must NOT produce a connection
		expect(Object.keys(flow)).not.toContain('edges');
		expect(flow.nodes.find((n) => n.address === 'A')?.outUsd).toBeGreaterThan(0);
		expect(flow.nodes.find((n) => n.address === 'A')?.inUsd).toBe(0);
		expect(flow.nodes.find((n) => n.address === 'B')?.inUsd).toBeGreaterThan(0);
		expect(flow.nodes.find((n) => n.address === 'B')?.outUsd).toBe(0);
	});

	it('keeps the busiest tokens and reports how many were dropped', () => {
		const swaps = Array.from({ length: 20 }, (_, i) =>
			swap({ id: `s${i}`, token: { address: `T${i}`, symbol: `T${i}` }, amountUsd: i + 1 })
		);
		const flow = buildMoneyFlow(swaps, { maxNodes: 5 });
		expect(flow.nodes).toHaveLength(5);
		expect(flow.nodes[0].totalUsd).toBe(20);
		expect(flow.hiddenNodeCount).toBe(15);
	});

	it('counts every swap into the token totals', () => {
		const swaps = Array.from({ length: 9 }, (_, i) =>
			swap({ id: `s${i}`, amountUsd: 10, timestamp: 1000 + i })
		);
		expect(buildMoneyFlow(swaps).nodes[0]).toMatchObject({ count: 9, inUsd: 90 });
	});

	it('ignores zero and non-finite amounts', () => {
		const flow = buildMoneyFlow([
			swap({ id: '1', amountUsd: 0 }),
			swap({ id: '2', amountUsd: Number.NaN }),
			swap({ id: '3', amountUsd: 50 })
		]);
		expect(flow.nodes[0].count).toBe(1);
		expect(flow.nodes[0].totalUsd).toBe(50);
	});

	it('is empty for an empty feed', () => {
		expect(buildMoneyFlow([])).toMatchObject({ nodes: [], maxNodeUsd: 0 });
	});
});

describe('assignSlots', () => {
	it('keeps a token in the slot it already had as ranking churns', () => {
		const first = assignSlots(['a', 'b', 'c'], new Map());
		const second = assignSlots(['c', 'b', 'a'], first);
		expect(second.get('a')).toBe(first.get('a'));
		expect(second.get('c')).toBe(first.get('c'));
	});

	it('gives a new token the lowest free slot when one leaves', () => {
		const first = assignSlots(['a', 'b', 'c'], new Map());
		const second = assignSlots(['a', 'c', 'd'], first);
		expect(second.get('a')).toBe(first.get('a'));
		expect(second.get('c')).toBe(first.get('c'));
		expect(second.get('d')).toBe(first.get('b'));
	});

	it('assigns a contiguous block with no duplicates', () => {
		const slots = assignSlots(['a', 'b', 'c', 'd'], new Map());
		expect([...slots.values()].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
	});
});

describe('layout scales', () => {
	it('puts the first slot in the centre and later slots on rings around it', () => {
		expect(slotPosition(0)).toMatchObject({ x: 0, y: 0, ring: 0 });
		expect(slotPosition(1).ring).toBe(1);
		expect(slotPosition(1 + ringCapacity(1)).ring).toBe(2);
	});

	it('keeps growing rings so a token is never evicted for space', () => {
		const seen = new Set<string>();
		for (let slot = 0; slot < 50; slot++) {
			const p = slotPosition(slot);
			const key = `${p.x.toFixed(1)}:${p.y.toFixed(1)}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}
	});

	it('spaces neighbours on a ring far enough apart not to overlap', () => {
		const ring1 = Array.from({ length: ringCapacity(1) }, (_, i) => slotPosition(1 + i));
		const gap = Math.hypot(ring1[0].x - ring1[1].x, ring1[0].y - ring1[1].y);
		// two maximum-radius nodes are 48 across
		expect(gap).toBeGreaterThan(48);
	});

	it('scales radius and stroke on a sqrt curve, clamped at both ends', () => {
		expect(nodeRadius(0, 100)).toBe(11);
		expect(nodeRadius(100, 100)).toBe(24);
		expect(nodeRadius(25, 100)).toBeCloseTo(17.5);
		expect(ribbonWidth(100, 100)).toBe(14);
		expect(ribbonWidth(0, 0)).toBe(2.5);
	});
});

describe('ribbonGeometry', () => {
	const lineEnd = (line: string) => line.split('Q')[1].trim().split(/\s+/).slice(2).map(Number);

	it('runs inbound flow from off-graph into the token', () => {
		const inbound = ribbonGeometry(100, 100, 20, 0, true);
		const end = lineEnd(inbound.line);
		expect(Math.hypot(end[0] - 100, end[1] - 100)).toBeCloseTo(21, 0);
		expect(Math.hypot(inbound.nodeX - 100, inbound.nodeY - 100)).toBeCloseTo(21, 0);
		expect(Math.hypot(inbound.farX - 100, inbound.farY - 100)).toBeGreaterThan(60);
	});

	it('runs outbound flow from the token off-graph', () => {
		const outbound = ribbonGeometry(100, 100, 20, 0, false);
		const end = lineEnd(outbound.line);
		expect(Math.hypot(end[0] - 100, end[1] - 100)).toBeGreaterThan(60);
	});

	it('anchors the gradient at the token end for both directions', () => {
		for (const inbound of [true, false]) {
			const g = ribbonGeometry(100, 100, 20, 0, inbound);
			expect(Math.hypot(g.nodeX - 100, g.nodeY - 100)).toBeLessThan(Math.hypot(g.farX - 100, g.farY - 100));
		}
	});
});

describe('pulseIntensity', () => {
	it('scales a swap against the largest one in view', () => {
		expect(pulseIntensity(1000, 1000)).toBe(1);
		expect(pulseIntensity(250, 1000)).toBe(0.5);
		expect(pulseIntensity(10, 1000)).toBeCloseTo(0.1);
	});

	it('keeps small swaps visible rather than collapsing them to nothing', () => {
		// a 1-in-10000 swap still reads at 1% rather than 0.01%
		expect(pulseIntensity(1, 10_000)).toBeCloseTo(0.01);
	});

	it('is inert without a reference or amount', () => {
		expect(pulseIntensity(0, 1000)).toBe(0);
		expect(pulseIntensity(100, 0)).toBe(0);
	});

	it('never exceeds 1 if a swap arrives above the current reference', () => {
		expect(pulseIntensity(5000, 1000)).toBe(1);
	});
});

describe('buildMoneyFlow reference', () => {
	it('reports the largest single swap for pulse scaling', () => {
		const flow = buildMoneyFlow([
			swap({ id: '1', amountUsd: 40 }),
			swap({ id: '2', amountUsd: 900, side: 'SELL' }),
			swap({ id: '3', amountUsd: 120 })
		]);
		expect(flow.maxSwapUsd).toBe(900);
	});
});

describe('createFlowAccumulator', () => {
	it('keeps totals for swaps long past any render cap', () => {
		const acc = createFlowAccumulator();
		for (let i = 0; i < 5000; i++) {
			acc.add([swap({ id: `s${i}`, amountUsd: 10 })]);
		}
		const flow = acc.snapshot();
		expect(acc.size).toBe(5000);
		expect(flow.nodes[0].count).toBe(5000);
		expect(flow.nodes[0].inUsd).toBe(50000);
	});

	it('folds many swaps into one record per token', () => {
		const acc = createFlowAccumulator();
		for (let i = 0; i < 1000; i++) {
			acc.add([swap({ id: `a${i}` }), swap({ id: `b${i}`, token: { address: 'B', symbol: 'BBB' } })]);
		}
		expect(acc.snapshot().nodes).toHaveLength(2);
	});

	it('ignores a swap id it has already counted', () => {
		const acc = createFlowAccumulator();
		acc.add([swap({ id: 'dup' })]);
		acc.add([swap({ id: 'dup' })]);
		expect(acc.size).toBe(1);
		expect(acc.snapshot().nodes[0].count).toBe(1);
	});

	it('separates buy and sell volume', () => {
		const acc = createFlowAccumulator();
		acc.add([swap({ id: '1', side: 'BUY', amountUsd: 300 }), swap({ id: '2', side: 'SELL', amountUsd: 120 })]);
		const node = acc.snapshot().nodes[0];
		expect(node.inUsd).toBe(300);
		expect(node.outUsd).toBe(120);
		expect(node.totalUsd).toBe(420);
	});

	it('backfills a symbol that arrived empty on an earlier frame', () => {
		const acc = createFlowAccumulator();
		acc.add([swap({ id: '1', token: { address: 'A', symbol: null } })]);
		acc.add([swap({ id: '2', token: { address: 'A', symbol: 'AAA' } })]);
		expect(acc.snapshot().nodes[0].symbol).toBe('AAA');
	});

	it('tracks the largest single swap for pulse scaling', () => {
		const acc = createFlowAccumulator();
		acc.add([swap({ id: '1', amountUsd: 50 }), swap({ id: '2', amountUsd: 900 })]);
		expect(acc.snapshot().maxSwapUsd).toBe(900);
	});

	it('drops everything on reset, for a filter change', () => {
		const acc = createFlowAccumulator();
		acc.add([swap({ id: '1' })]);
		acc.reset();
		expect(acc.size).toBe(0);
		expect(acc.snapshot().nodes).toHaveLength(0);
		acc.add([swap({ id: '1' })]);
		expect(acc.size).toBe(1);
	});

	it('matches buildMoneyFlow for the same input', () => {
		const rows = [swap({ id: '1', amountUsd: 10 }), swap({ id: '2', side: 'SELL', amountUsd: 40 })];
		const acc = createFlowAccumulator();
		acc.add(rows);
		expect(acc.snapshot()).toEqual(buildMoneyFlow(rows));
	});
});
