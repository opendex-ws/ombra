import type { TradeTargetTrigger } from '$lib/api/types';

export function positivePercentTargetTrigger(value: number): TradeTargetTrigger {
	return {
		type: 'PERCENT',
		changePct: Math.abs(value)
	};
}
