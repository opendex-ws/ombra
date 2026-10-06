import type { components } from '$lib/api/v2.d.ts';

export type PnlRange = components['schemas']['PnlRange'];
export type UserPnlResponse = components['schemas']['UserPnlResponse'];
export type PnlMetrics = components['schemas']['PnlMetrics'];

export const PNL_RANGES: { value: PnlRange; label: string }[] = [
	{ value: '24h', label: '24H' },
	{ value: '7d', label: '7D' },
	{ value: '30d', label: '30D' }
];

export type PnlBreakdownRow = {
	key: string;
	label: string;
	/** Platform id for the router icon, when the row maps to one. */
	platform: string | null;
	metrics: PnlMetrics;
};

function metricsOf(v: PnlMetrics): PnlMetrics {
	return {
		activePnlUsd: v.activePnlUsd ?? 0,
		closedPnlUsd: v.closedPnlUsd ?? 0,
		totalPnlUsd: v.totalPnlUsd ?? 0
	};
}

export function launchpadPlatform(row: { platformType: string }): string {
	return row.platformType;
}

export function chainRows(data: UserPnlResponse | null): PnlBreakdownRow[] {
	return (data?.byChain ?? []).map((r) => ({
		key: r.chain,
		label: r.chain,
		platform: null,
		metrics: metricsOf(r)
	}));
}

export function launchpadRows(data: UserPnlResponse | null): PnlBreakdownRow[] {
	return (data?.byLaunchpad ?? []).map((r) => {
		const platform = launchpadPlatform(r);
		return { key: `${r.chain}:${platform}`, label: platform, platform, metrics: metricsOf(r) };
	});
}

export function dexRows(data: UserPnlResponse | null): PnlBreakdownRow[] {
	return (data?.byDexProtocol ?? []).map((r) => ({
		key: `${r.chain}:${r.platformType}`,
		label: r.platformType,
		platform: r.platformType,
		metrics: metricsOf(r)
	}));
}

/** Biggest absolute P&L first: the rows that moved the number lead. */
export function sortByImpact(rows: PnlBreakdownRow[]): PnlBreakdownRow[] {
	return [...rows].sort(
		(a, b) => Math.abs(b.metrics.totalPnlUsd) - Math.abs(a.metrics.totalPnlUsd)
	);
}

export type PnlPoint = { t: number; v: number };

/**
 * Cumulative total P&L over the range. Timestamps and series are index-aligned
 * by contract, so a length mismatch means a malformed payload rather than
 * something to interpolate around.
 */
export function totalSeries(data: UserPnlResponse | null): PnlPoint[] {
	const stamps = data?.history?.timestamps ?? [];
	const values = data?.history?.totals?.totalPnlUsd ?? [];
	const n = Math.min(stamps.length, values.length);
	const out: PnlPoint[] = [];
	for (let i = 0; i < n; i++) {
		const t = Date.parse(stamps[i]);
		const v = values[i];
		if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
		out.push({ t, v });
	}
	return out;
}

/** SVG polyline points for a series, flat-lined when every value is equal. */
export function seriesPoints(points: PnlPoint[], w: number, h: number): string {
	if (points.length === 0) return '';
	if (points.length === 1) return `0,${h / 2} ${w},${h / 2}`;
	let min = Infinity;
	let max = -Infinity;
	for (const p of points) {
		if (p.v < min) min = p.v;
		if (p.v > max) max = p.v;
	}
	const span = max - min;
	return points
		.map((p, i) => {
			const x = (i / (points.length - 1)) * w;
			const y = span === 0 ? h / 2 : h - ((p.v - min) / span) * h;
			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(' ');
}

/**
 * Whether the active-P&L history can be read as continuous. The endpoint is
 * explicit that it cannot always be, so a chart must say so rather than draw
 * straight through a hole.
 */
export function historyIsPartial(data: UserPnlResponse | null): boolean {
	if (!data) return false;
	return data.activeHistoryComplete === false || (data.history?.gaps?.length ?? 0) > 0;
}
