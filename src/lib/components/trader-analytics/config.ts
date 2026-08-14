import type { TokenTimeRange, WalletTimeRange } from '$lib/api/types';

export const WALLET_TIME_RANGE_OPTIONS: { value: WalletTimeRange; label: string }[] = [
	{ value: 'ONE_DAY', label: '1D' },
	{ value: 'SEVEN_DAY', label: '7D' },
	{ value: 'THIRTY_DAY', label: '30D' },
	{ value: 'NINETY_DAY', label: '90D' }
];

export const TOKEN_TIME_RANGE_OPTIONS: { value: TokenTimeRange; label: string }[] = [
	{ value: 'ONE_HOUR', label: '1H' },
	{ value: 'ONE_DAY', label: '1D' },
	{ value: 'NINETY_DAY', label: '90D' }
];

export const TRADER_RANKING_FILTER_KEYS = [
	'pnlUsdMin',
	'pnlUsdMax',
	'winRatePctMin',
	'winRatePctMax',
	'buyCountMin',
	'buyCountMax',
	'sellCountMin',
	'sellCountMax',
	'latestSwapAgeMinutesMin',
	'latestSwapAgeMinutesMax'
] as const;

export type TraderRankingFilterKey = (typeof TRADER_RANKING_FILTER_KEYS)[number];
export type TraderRankingFilterValues = Partial<Record<TraderRankingFilterKey, number>>;

export function walletTimeRangeLabel(timeRange: WalletTimeRange): string {
	return WALLET_TIME_RANGE_OPTIONS.find((option) => option.value === timeRange)?.label ?? timeRange;
}

export function valueColorClass(value: number | undefined, neutral = 'text-g7'): string {
	return value && value > 0 ? 'text-grn' : value && value < 0 ? 'text-red' : neutral;
}
