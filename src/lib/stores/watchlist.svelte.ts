import type { CallerSource } from '$lib/api/types';

type SourceType = CallerSource;
type CallerSelection = { id: string; sourceType: SourceType };

let pendingCallerSelection = $state<CallerSelection | null>(null);

export function selectWatchlistCaller(id: string, sourceType: SourceType = 'CALLER') {
	pendingCallerSelection = { id, sourceType };
}

export function getPendingWatchlistCaller(): CallerSelection | null {
	return pendingCallerSelection;
}

export function clearPendingWatchlistCaller() {
	pendingCallerSelection = null;
}
