import type { Chain } from '$lib/api/types';

export const DISPLAY_CHAINS = ['SOL', 'RH'] as unknown as readonly Chain[];

export const SCANNER_CHAIN_FILTERS: Array<'All' | Chain> = ['All', ...DISPLAY_CHAINS];

export function isDisplayChain(value: string | null | undefined): value is Chain {
	return value != null && (DISPLAY_CHAINS as readonly string[]).includes(value);
}
