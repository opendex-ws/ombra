import type { TokenMarketPumpfun, TokenMarketPumpfunFeeShareholder } from '$lib/api/types';
import { shortAddress } from './format';

export type { TokenMarketPumpfunFeeShareholder };

export function feeShareholders(
	pumpfun: TokenMarketPumpfun | null | undefined
): TokenMarketPumpfunFeeShareholder[] {
	return pumpfun?.feeSharing?.shareholders ?? [];
}

export function feeShareName(share: TokenMarketPumpfunFeeShareholder): string {
	if (share.kind === 'social' && share.social?.username) {
		return `@${share.social.username}`;
	}
	if (share.kind === 'donation') {
		const names = (share.donation?.charities ?? [])
			.map((c) => c.name)
			.filter((name): name is string => !!name);
		return names.length ? names.join(', ') : 'Donation';
	}
	return shortAddress(share.address) || 'Wallet';
}

export function feeSharePctLabel(share: TokenMarketPumpfunFeeShareholder): string {
	return `${(share.shareBps / 100).toString()}%`;
}

export function feeShareLabel(share: TokenMarketPumpfunFeeShareholder): string {
	return `${feeSharePctLabel(share)} ${feeShareName(share)}`;
}

export function feeShareTitle(shares: TokenMarketPumpfunFeeShareholder[]): string {
	return shares.map(feeShareLabel).join(' · ');
}

export function feeShareSocialUrl(share: TokenMarketPumpfunFeeShareholder): string | undefined {
	const username = share.social?.username;
	if (share.kind !== 'social' || !username) return undefined;
	return `https://x.com/${username}`;
}
