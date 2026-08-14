import { browser } from '$app/environment';

type CurrencyMode = 'usd' | 'native';

const STORAGE_KEY = 'ombra_currency';

let mode = $state<CurrencyMode>('usd');

export function initCurrency() {
	if (!browser) return;
	const stored = localStorage.getItem(STORAGE_KEY) as CurrencyMode | null;
	if (stored === 'native') mode = 'native';
}

export function getCurrencyMode(): CurrencyMode {
	return mode;
}

export function isUsd(): boolean {
	return mode === 'usd';
}

export function toggleCurrency() {
	mode = mode === 'usd' ? 'native' : 'usd';
	if (browser) localStorage.setItem(STORAGE_KEY, mode);
}

export function cv(usdVal: number | string | undefined | null, nativeVal: number | string | undefined | null): number | string | undefined | null {
	return mode === 'usd' ? usdVal : nativeVal;
}

export function cvStr(usdStr: string | undefined | null, nativeStr: string | undefined | null): string | undefined | null {
	return mode === 'usd' ? usdStr : nativeStr;
}
