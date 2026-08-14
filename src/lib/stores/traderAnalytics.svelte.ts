import type { Chain, TokenIdentity } from '$lib/api/types';

export type TraderTokenIdentity = TokenIdentity;

export type TraderOverviewTarget = {
	chain: Chain;
	walletAddress: string;
	token: TraderTokenIdentity;
};

export type TraderPortfolioTarget = {
	chain: Chain;
	walletAddress: string;
};

let traderOverviewTarget = $state<TraderOverviewTarget | null>(null);
let traderPortfolioTarget = $state<TraderPortfolioTarget | null>(null);

export function getTraderOverviewTarget() {
	return traderOverviewTarget;
}

export function openTraderOverview(target: TraderOverviewTarget) {
	traderOverviewTarget = target;
}

export function closeTraderOverview() {
	traderOverviewTarget = null;
}

export function getTraderPortfolioTarget() {
	return traderPortfolioTarget;
}

export function openTraderPortfolio(target: TraderPortfolioTarget) {
	traderPortfolioTarget = target;
}

export function closeTraderPortfolio() {
	traderPortfolioTarget = null;
}
