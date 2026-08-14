import type { TokenSwap } from '$lib/api/types';

type TradeFeeFields = Partial<NonNullable<TokenSwap['fees']>>;
type TradeWithFees = { fees?: TradeFeeFields | null };

function finiteFee(exact: string | null | undefined, approximate: number | null | undefined): number | null {
	if (exact !== null && exact !== undefined && exact !== '') {
		const parsed = Number(exact);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Number.isFinite(approximate) ? (approximate as number) : null;
}

function exactOrApproximate(exact: string | null | undefined, approximate: number | null | undefined): number {
	return finiteFee(exact, approximate) ?? 0;
}

export function calculateTradeFees(trade: TradeWithFees) {
	const fees = trade.fees;
	const gas = exactOrApproximate(fees?.gasFeeUsdStr, fees?.gasFeeUsd);
	const mev = exactOrApproximate(fees?.mevFeeUsdStr, fees?.mevFeeUsd);
	const platform = exactOrApproximate(fees?.platformFeeUsdStr, fees?.platformFeeUsd);
	const creator = exactOrApproximate(fees?.creatorFeeUsdStr, fees?.creatorFeeUsd);
	const cashback = exactOrApproximate(fees?.cashbackUsdStr, fees?.cashbackUsd);
	const componentGross = gas + mev + platform + creator;
	const publishedGross = finiteFee(fees?.totalFeeUsdStr, fees?.totalFeeUsd);
	const total = publishedGross === null || (publishedGross === 0 && componentGross !== 0)
		? componentGross
		: publishedGross;
	const calculatedNet = total - cashback;
	const publishedNet = finiteFee(fees?.netFeeUsdStr, fees?.netFeeUsd);
	const net = publishedNet === null || (publishedNet === 0 && calculatedNet !== 0)
		? calculatedNet
		: publishedNet;

	return { gas, mev, platform, creator, cashback, total, net };
}
