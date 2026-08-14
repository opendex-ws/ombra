export interface CandleDiagnosticsSnapshot {
	rawCandles: number;
	distinctCandles: number;
	drains: number;
	seriesUpdates: number;
	fullProjections: number;
	suppressedProjections: number;
	staleDrops: number;
	indexRebuilds: number;
	extremaScans: number;
	maxPendingCandles: number;
	maxLoadedCandles: number;
}

const emptySnapshot = (): CandleDiagnosticsSnapshot => ({
	rawCandles: 0,
	distinctCandles: 0,
	drains: 0,
	seriesUpdates: 0,
	fullProjections: 0,
	suppressedProjections: 0,
	staleDrops: 0,
	indexRebuilds: 0,
	extremaScans: 0,
	maxPendingCandles: 0,
	maxLoadedCandles: 0
});

export interface CandleDiagnostics {
	add: (metric: keyof CandleDiagnosticsSnapshot, amount?: number) => void;
	max: (metric: 'maxPendingCandles' | 'maxLoadedCandles', value: number) => void;
	snapshot: () => CandleDiagnosticsSnapshot;
}

export function createCandleDiagnostics(enabled: boolean): CandleDiagnostics {
	const values = emptySnapshot();
	if (!enabled) {
		return { add: () => {}, max: () => {}, snapshot: emptySnapshot };
	}
	return {
		add(metric, amount = 1) {
			values[metric] += amount;
		},
		max(metric, value) {
			values[metric] = Math.max(values[metric], value);
		},
		snapshot() {
			return { ...values };
		}
	};
}
