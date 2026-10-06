import type { CallerSource } from '$lib/api/types';

type BuiltInSourceType = Exclude<CallerSource, 'INTEGRATION'>;
type BuiltInCallerSelection = { id: string; sourceType: BuiltInSourceType; integrationId?: never };
type IntegrationCallerSelection = { id: string; sourceType: 'INTEGRATION'; integrationId: string };
export type CallerSelection = BuiltInCallerSelection | IntegrationCallerSelection;

let pendingCallerSelection = $state<CallerSelection | null>(null);

export function makeWatchlistCallerSelection(id: string, sourceType?: BuiltInSourceType): BuiltInCallerSelection;
export function makeWatchlistCallerSelection(id: string, sourceType: 'INTEGRATION', integrationId: string): IntegrationCallerSelection;
export function makeWatchlistCallerSelection(
	id: string,
	sourceType: BuiltInSourceType | 'INTEGRATION' = 'CALLER',
	integrationId?: string
): CallerSelection {
	if (sourceType === 'INTEGRATION') {
		if (!integrationId) throw new Error('An integration caller selection requires integrationId');
		return { id, sourceType, integrationId };
	}
	return { id, sourceType };
}

export function selectWatchlistCaller(id: string, sourceType?: BuiltInSourceType): void;
export function selectWatchlistCaller(id: string, sourceType: 'INTEGRATION', integrationId: string): void;
export function selectWatchlistCaller(
	id: string,
	sourceType: BuiltInSourceType | 'INTEGRATION' = 'CALLER',
	integrationId?: string
) {
	if (sourceType === 'INTEGRATION') {
		if (!integrationId) throw new Error('An integration caller selection requires integrationId');
		pendingCallerSelection = makeWatchlistCallerSelection(id, sourceType, integrationId);
		return;
	}
	pendingCallerSelection = makeWatchlistCallerSelection(id, sourceType);
}

export function getPendingWatchlistCaller(): CallerSelection | null {
	return pendingCallerSelection;
}

export function clearPendingWatchlistCaller() {
	pendingCallerSelection = null;
}
