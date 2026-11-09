/** Robinhood USDG. The wallet payload leaves isFiat false on this chain. */
const RH_USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
/** Solana USDC. The backend flags it isFiat; the mint is the fallback if a payload does not. */
const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Chains whose buys can be funded from either the native coin or the stable.
 * Robinhood spends ETH (7702) or USDG. Solana spends SOL or USDC; a USDC buy has
 * its network fees paid by the engine's gas sponsor, so it needs no SOL.
 */
const EITHER_POT_CHAINS = new Set(['RH', 'SOL']);

export function fundsFromEitherPot(chain: string): boolean {
	return EITHER_POT_CHAINS.has(chain);
}

export type DepositAsset = {
	isFiat: boolean;
	isNative: boolean;
	valueUsd: number;
	tokensBalance: number;
	tokensBalanceStr: string;
	token: { symbol: string; address: string };
};

/** A holding counts when it has a USD value or a non-zero token amount. */
export function assetPresent(asset: DepositAsset | null | undefined): boolean {
	if (!asset) return false;
	if (asset.valueUsd > 0) return true;
	const raw = asset.tokensBalanceStr || String(asset.tokensBalance ?? '');
	const n = Number(raw);
	return Number.isFinite(n) && n > 0;
}

/**
 * The stable a FIAT buy spends: USDG on Robinhood, USDC on Solana, matched by
 * mint when the payload leaves isFiat unset.
 */
export function findFiatAsset<T extends DepositAsset>(chain: string, assets: T[] | undefined): T | null {
	if (!assets?.length) return null;
	const flagged = assets.find((asset) => asset.isFiat);
	if (flagged) return flagged;
	if (chain === 'RH') {
		return (
			assets.find((asset) => {
				const address = asset.token.address.toLowerCase();
				return address === RH_USDG || asset.token.symbol.toUpperCase() === 'USDG';
			}) ?? null
		);
	}
	if (chain === 'SOL') {
		// Solana mints are case-sensitive base58, so match the mint exactly.
		return assets.find((asset) => asset.token.address === SOL_USDC) ?? null;
	}
	return null;
}

/**
 * Robinhood (ETH or USDG) and Solana (SOL or USDC) open the form on either balance.
 * Other chains still follow the selected Buy With pot.
 */
export function needsTradeDeposit(args: {
	chain: string;
	hasSelectedBalance: boolean;
	native: DepositAsset | null;
	fiat: DepositAsset | null;
}): boolean {
	if (fundsFromEitherPot(args.chain)) return !assetPresent(args.native) && !assetPresent(args.fiat);
	return !args.hasSelectedBalance;
}

export function depositAssetLabel(chain: string, fundingSymbol: string): string {
	if (chain === 'RH') return 'USDG or ETH';
	if (chain === 'SOL') return 'USDC or SOL';
	return fundingSymbol;
}

export type FundingSide = 'NATIVE' | 'FIAT';

/**
 * Robinhood and Solana spend the larger of the native and stable balances.
 * Equal value keeps the Buy With setting. Other chains always keep that setting.
 */
export function fundingChoice(args: {
	chain: string;
	buyWith: FundingSide;
	native: DepositAsset | null;
	fiat: DepositAsset | null;
}): FundingSide {
	if (!fundsFromEitherPot(args.chain)) return args.buyWith;
	const nativeUsd = args.native?.valueUsd ?? 0;
	const fiatUsd = args.fiat?.valueUsd ?? 0;
	if (fiatUsd > nativeUsd) return 'FIAT';
	if (nativeUsd > fiatUsd) return 'NATIVE';
	const fiatHeld = assetPresent(args.fiat);
	const nativeHeld = assetPresent(args.native);
	if (fiatHeld !== nativeHeld) return fiatHeld ? 'FIAT' : 'NATIVE';
	return args.buyWith;
}
