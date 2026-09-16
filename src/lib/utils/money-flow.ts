/**
 * Aggregates a labeled-wallet swap feed into a token money-flow graph.
 *
 * Nodes are TOKENS. Nothing connects two tokens: a buy is a strand arriving from
 * off-graph into the circle, a sell is a strand leaving the circle for off-graph.
 * Wallets are deliberately absent — this tracks where filtered volume goes, not
 * who moved it.
 */

export interface FlowSwap {
	id: string;
	walletAddress: string;
	chain: string;
	token: { address: string; symbol?: string | null };
	side: 'BUY' | 'SELL';
	amountUsd: number;
	/** Unix epoch milliseconds. */
	timestamp: number;
}

export interface FlowNode {
	key: string;
	chain: string;
	address: string;
	symbol: string;
	/** Buy volume: money flowing IN to the token. */
	inUsd: number;
	/** Sell volume: money flowing OUT of the token. */
	outUsd: number;
	totalUsd: number;
	count: number;
}

export interface MoneyFlow {
	nodes: FlowNode[];
	maxNodeUsd: number;
	/** Largest single swap in the window, the reference a pulse is scaled against. */
	maxSwapUsd: number;
	totalInUsd: number;
	totalOutUsd: number;
	/** Tokens dropped from the graph because they ranked outside `maxNodes`. */
	hiddenNodeCount: number;
}

export interface MoneyFlowOptions {
	/** Upper bound on plotted tokens. Generous: the view pans and auto-fits. */
	maxNodes?: number;
}

const DEFAULT_MAX_NODES = 50;

export function tokenKey(chain: string, address: string): string {
	return `${chain}:${address}`;
}

/**
 * Running per-token totals for the money-flow view.
 *
 * The rendered swap feed is capped at a few hundred rows, but the whole point of
 * this view is spotting that everyone is piling into (or dumping) one token over
 * a long session, so it must not inherit that cap. Totals are folded into one
 * record per token as swaps arrive, so an hour of flow costs the same as a
 * minute: bounded by the number of distinct tokens, not the number of swaps.
 *
 * Swaps are deduped by id, which makes `add` safe to call with overlapping
 * batches (a REST reseed replaying rows already delivered over the socket).
 */
export interface FlowAccumulator {
	add(swaps: readonly FlowSwap[]): void;
	snapshot(options?: MoneyFlowOptions): MoneyFlow;
	reset(): void;
	/** Distinct swaps folded in so far. */
	readonly size: number;
}

export function createFlowAccumulator(): FlowAccumulator {
	let nodes = new Map<string, FlowNode>();
	let seen = new Set<string>();
	let maxSwapUsd = 0;

	return {
		get size() {
			return seen.size;
		},
		reset() {
			nodes = new Map();
			seen = new Set();
			maxSwapUsd = 0;
		},
		add(swaps) {
			for (const swap of swaps) {
				if (!swap?.id || seen.has(swap.id)) continue;
				const usd = Number(swap.amountUsd);
				if (!Number.isFinite(usd) || usd <= 0) continue;
				seen.add(swap.id);
				const key = tokenKey(swap.chain, swap.token.address);
				let node = nodes.get(key);
				if (!node) {
					node = {
						key,
						chain: swap.chain,
						address: swap.token.address,
						symbol: swap.token.symbol ?? '',
						inUsd: 0,
						outUsd: 0,
						totalUsd: 0,
						count: 0
					};
					nodes.set(key, node);
				}
				// A symbol can arrive empty on an early frame and be filled in later.
				if (!node.symbol && swap.token.symbol) node.symbol = swap.token.symbol;
				if (swap.side === 'BUY') node.inUsd += usd;
				else node.outUsd += usd;
				if (usd > maxSwapUsd) maxSwapUsd = usd;
				node.totalUsd += usd;
				node.count += 1;
			}
		},
		snapshot(options: MoneyFlowOptions = {}) {
			return rank([...nodes.values()], maxSwapUsd, options);
		}
	};
}

export function buildMoneyFlow(swaps: readonly FlowSwap[], options: MoneyFlowOptions = {}): MoneyFlow {
	const acc = createFlowAccumulator();
	acc.add(swaps);
	return acc.snapshot(options);
}

function rank(all: FlowNode[], maxSwapUsd: number, options: MoneyFlowOptions): MoneyFlow {
	const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
	const nodes = { size: all.length };
	const ranked = [...all].sort((a, b) => b.totalUsd - a.totalUsd).slice(0, maxNodes);

	let totalInUsd = 0;
	let totalOutUsd = 0;
	for (const node of ranked) {
		totalInUsd += node.inUsd;
		totalOutUsd += node.outUsd;
	}

	return {
		nodes: ranked,
		maxNodeUsd: ranked.length > 0 ? ranked[0].totalUsd : 0,
		maxSwapUsd,
		totalInUsd,
		totalOutUsd,
		hiddenNodeCount: Math.max(0, nodes.size - ranked.length)
	};
}

/**
 * Stable slot assignment. A live graph that re-ranks every frame would have nodes
 * swapping places constantly, so a token keeps the slot it was first given and a
 * new token only ever takes the lowest free one.
 */
export function assignSlots(
	keys: readonly string[],
	previous: ReadonlyMap<string, number>
): Map<string, number> {
	const next = new Map<string, number>();
	const taken = new Set<number>();
	for (const key of keys) {
		const slot = previous.get(key);
		if (slot !== undefined && !taken.has(slot)) {
			next.set(key, slot);
			taken.add(slot);
		}
	}
	let cursor = 0;
	for (const key of keys) {
		if (next.has(key)) continue;
		while (taken.has(cursor)) cursor++;
		next.set(key, cursor);
		taken.add(cursor);
	}
	return next;
}

/** Spacing between rings, in the same units as node radii. */
const RING_GAP = 76;
/** Room each node needs along a ring, so neighbours never touch. */
const NODE_PITCH = 66;

/** How many nodes fit on a ring; ring 0 is the single centre slot. */
export function ringCapacity(ring: number): number {
	if (ring === 0) return 1;
	return Math.max(6, Math.round((2 * Math.PI * ring * RING_GAP) / NODE_PITCH));
}

export interface SlotPosition {
	x: number;
	y: number;
	ring: number;
	/** Direction pointing away from the graph centre, where ribbons live. */
	angle: number;
}

/**
 * Position for a slot, centred on the origin. Rings grow outwards without bound
 * so the graph never has to evict a token to make room — the view auto-fits and
 * pans instead.
 */
export function slotPosition(slot: number): SlotPosition {
	let ring = 0;
	let index = slot;
	while (index >= ringCapacity(ring)) {
		index -= ringCapacity(ring);
		ring++;
	}
	if (ring === 0) return { x: 0, y: 0, ring, angle: -Math.PI / 2 };
	const count = ringCapacity(ring);
	const radius = ring * RING_GAP;
	// Offset alternate rings so nodes do not line up spoke-on-spoke.
	const angle = (index / count) * Math.PI * 2 + (ring % 2 === 0 ? Math.PI / count : 0) - Math.PI / 2;
	return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, ring, angle };
}

/** Node radius scaled by volume, on a sqrt curve so one whale cannot swamp the view. */
export function nodeRadius(usd: number, maxUsd: number, min = 11, max = 24): number {
	if (!(maxUsd > 0) || !(usd > 0)) return min;
	return min + (max - min) * Math.sqrt(Math.min(1, usd / maxUsd));
}

/** Ribbon width scaled by directional volume, same sqrt curve. */
export function ribbonWidth(usd: number, maxUsd: number, min = 2.5, max = 14): number {
	if (!(maxUsd > 0) || !(usd > 0)) return min;
	return min + (max - min) * Math.sqrt(Math.min(1, usd / maxUsd));
}

export interface RibbonGeometry {
	/** Centre line, oriented along the direction of travel, for stroke and motion. */
	line: string;
	/** Gradient anchors: the token end and the off-graph end. */
	nodeX: number;
	nodeY: number;
	farX: number;
	farY: number;
}

/**
 * One aggregate ribbon of flow per direction, drawn as a constant-width stroke.
 * Volume is the width; a gradient along the line carries the direction, faint at
 * the token and strong off-graph. (A tapered fill read as devil horns.)
 */
export function ribbonGeometry(
	x: number,
	y: number,
	r: number,
	baseAngle: number,
	inbound: boolean,
	length = 56
): RibbonGeometry {
	const angle = baseAngle + (inbound ? -0.62 : 0.62);
	const nodeX = x + Math.cos(angle) * (r + 1);
	const nodeY = y + Math.sin(angle) * (r + 1);
	const farX = x + Math.cos(angle) * (r + length);
	const farY = y + Math.sin(angle) * (r + length);
	// Bow sideways so the ribbon sweeps instead of radiating straight out.
	const bow = 20 * (inbound ? 1 : -1);
	const midX = (nodeX + farX) / 2 + Math.cos(angle + Math.PI / 2) * bow;
	const midY = (nodeY + farY) / 2 + Math.sin(angle + Math.PI / 2) * bow;
	const f = (v: number) => v.toFixed(2);
	const line = inbound
		? `M ${f(farX)} ${f(farY)} Q ${f(midX)} ${f(midY)} ${f(nodeX)} ${f(nodeY)}`
		: `M ${f(nodeX)} ${f(nodeY)} Q ${f(midX)} ${f(midY)} ${f(farX)} ${f(farY)}`;
	return { line, nodeX, nodeY, farX, farY };
}

/**
 * How loud a single swap should read, 0..1 against the largest swap in view.
 * A sqrt curve so a whale does not flatten everything else to nothing.
 */
export function pulseIntensity(usd: number, maxUsd: number): number {
	if (!(usd > 0) || !(maxUsd > 0)) return 0;
	return Math.min(1, Math.sqrt(usd / maxUsd));
}
