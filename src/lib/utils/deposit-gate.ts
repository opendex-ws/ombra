/** Robinhood USDG. The wallet payload leaves isFiat false on this chain. */
const RH_USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';

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

/** The stable a FIAT buy spends. On Robinhood that is USDG even when isFiat is unset. */
export function findFiatAsset<T extends DepositAsset>(chain: string, assets: T[] | undefined): T | null {
	if (!assets?.length) return null;
	const flagged = assets.find((asset) => asset.isFiat);
	if (flagged) return flagged;
	if (chain !== 'RH') return null;
	return (
		assets.find((asset) => {
			const address = asset.token.address.toLowerCase();
			return address === RH_USDG || asset.token.symbol.toUpperCase() === 'USDG';
		}) ?? null
	);
}

/**
 * Robinhood can spend ETH (7702) or USDG, so either balance opens the form.
 * Other chains still follow the selected Buy With pot.
 */
export function needsTradeDeposit(args: {
	chain: string;
	hasSelectedBalance: boolean;
	native: DepositAsset | null;
	fiat: DepositAsset | null;
}): boolean {
	if (args.chain === 'RH') return !assetPresent(args.native) && !assetPresent(args.fiat);
	return !args.hasSelectedBalance;
}

export function depositAssetLabel(chain: string, fundingSymbol: string): string {
	return chain === 'RH' ? 'USDG or ETH' : fundingSymbol;
}

export type FundingSide = 'NATIVE' | 'FIAT';

/**
 * Robinhood spends the larger of the ETH and USDG balances.
 * Equal value keeps the Buy With setting. Other chains always keep that setting.
 */
export function fundingChoice(args: {
	chain: string;
	buyWith: FundingSide;
	native: DepositAsset | null;
	fiat: DepositAsset | null;
}): FundingSide {
	if (args.chain !== 'RH') return args.buyWith;
	const nativeUsd = args.native?.valueUsd ?? 0;
	const fiatUsd = args.fiat?.valueUsd ?? 0;
	if (fiatUsd > nativeUsd) return 'FIAT';
	if (nativeUsd > fiatUsd) return 'NATIVE';
	const fiatHeld = assetPresent(args.fiat);
	const nativeHeld = assetPresent(args.native);
	if (fiatHeld !== nativeHeld) return fiatHeld ? 'FIAT' : 'NATIVE';
	return args.buyWith;
}
