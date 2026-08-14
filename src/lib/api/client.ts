import createClient, { type Middleware } from 'openapi-fetch';
import type { paths, components } from './v2.d.ts';
import { getAuthToken, disconnect, refreshToken } from '$lib/stores/auth.svelte';
import { apiOrigin } from './config';

// API paths already include the `/v2` prefix. Base is same-origin ('') in proxy
// mode or the backend origin in direct mode — see api/config.ts.
export const api = createClient<paths>({ baseUrl: apiOrigin() });

const REFRESH_PATH = '/v2/auth/refresh';

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = getAuthToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401 || !getAuthToken()) return response;
    // Don't try to refresh the refresh call itself, or requests that already
    // carried a freshly refreshed token (retried once via `x-auth-retry`).
    const url = new URL(request.url);
    if (url.pathname.endsWith(REFRESH_PATH) || request.headers.get('x-auth-retry')) {
      disconnect();
      return response;
    }
    // Attempt a coalesced token refresh, then retry the original request once.
    const next = await refreshToken();
    if (!next) return response;
    const retry = request.clone();
    retry.headers.set('Authorization', `Bearer ${next}`);
    retry.headers.set('x-auth-retry', '1');
    try {
      return await fetch(retry as unknown as Request);
    } catch {
      return response;
    }
  }
};

api.use(authMiddleware);

export type ScannerItem = components['schemas']['ScannerItem'];
export type ScannerListResponse = components['schemas']['ScannerListResponse'];
export type TokenMarketLiveSnapshot = components['schemas']['TokenMarketLiveSnapshot'];
export type TokenMarketQuote = components['schemas']['TokenMarketQuote'];
export type TokenMarketStats = components['schemas']['TokenMarketStats'];
export type TokenMarketTimeframeStats = components['schemas']['TokenMarketTimeframeStats'];
export type TokenMarketAth = components['schemas']['TokenMarketAth'];
export type TokenMarketAudit = components['schemas']['TokenMarketAudit'];
export type TokenSocialData = components['schemas']['TokenSocialData'];
export type SocialLinks = components['schemas']['SocialLinks'];
export type TokenMarketHolderInfo = components['schemas']['TokenMarketHolderInfo'];
export type CandlesResponse = components['schemas']['CandlesResponse'];
export type CandleItem = components['schemas']['CandleItem'];
export type TokenHoldersResponse = components['schemas']['TokenHoldersResponse'];
export type TokenHolderDistribution = components['schemas']['TokenHolderDistribution'];
export type TokenHolder = components['schemas']['TokenHolder'];
export type TokenSafetyResponse = components['schemas']['TokenSafetyResponse'];
export type TokenSwap = components['schemas']['TokenSwap'];
export type TokenTopTrader = components['schemas']['TokenTopTrader'];
export type TokenTopTradersResponse = components['schemas']['TokenTopTradersResponse'];
export type WatchlistCallItem = components['schemas']['WatchlistCallItem'];
export type WatchlistCallDetails = components['schemas']['WatchlistCallDetails'];
export type WatchlistFeedResponse = components['schemas']['WatchlistFeedResponse'];
export type Chain = components['schemas']['Chain'];
export type TimeFrame = components['schemas']['TimeFrame'];
export type CandleFrame = components['schemas']['CandleFrame'];
export type TrenchesPhase = components['schemas']['TrenchesPhase'];
export type ActiveTrade = components['schemas']['ActiveTrade'];
export type CompletedTrade = components['schemas']['CompletedTrade'];
export type ActiveTradesResponse = components['schemas']['ActiveTradesResponse'];
export type CompletedTradesResponse = components['schemas']['CompletedTradesResponse'];
export type TradeBase = components['schemas']['TradeBase'];
export type TradeTarget = components['schemas']['TradeTarget'];
export type TradeMetTarget = components['schemas']['TradeMetTarget'];
export type TradeSettings = components['schemas']['TradeSettings'];
export type TradeTargetConfig = components['schemas']['TradeTargetConfig'];
export type TradeTargetTrigger = components['schemas']['TradeTargetTrigger'];
export type TradePreset = components['schemas']['TradePreset'];
export type TradePresetsResponse = components['schemas']['TradePresetsResponse'];
export type TradePresetSlot = components['schemas']['TradePresetSlot'];
export type ExecutedTradeSwapRow = components['schemas']['ExecutedTradeSwapRow'];
export type PendingTradeSwapRow = components['schemas']['PendingTradeSwapRow'];
export type TradeSwapValue = components['schemas']['TradeSwapValue'];
export type GasPreset = components['schemas']['GasPreset'];
export type SlippageSetting = components['schemas']['SlippageSetting'];
export type BuyStrategy = components['schemas']['BuyStrategy'];
export type BuyAmount = components['schemas']['BuyAmount'];
export type Bot = components['schemas']['Bot'];
export type CreateBotRequest = components['schemas']['CreateBotRequest'];
export type BotChainConfig = components['schemas']['BotChainConfig'];
export type UserWalletsResponse = components['schemas']['UserWalletsResponse'];
export type ManagedWallet = components['schemas']['ManagedWallet'];
export type ConnectedWallet = components['schemas']['ConnectedWallet'];
export type WalletAsset = components['schemas']['WalletAsset'];
export type ProfileResponse = components['schemas']['ProfileResponse'];
export type PublicUserSettings = components['schemas']['PublicUserSettings'];
export type SettingsResponse = components['schemas']['SettingsResponse'];
export type UserFavouriteToken = components['schemas']['UserFavouriteToken'];
export type UserFavouritesResponse = components['schemas']['UserFavouritesResponse'];
export type TokenIdentity = components['schemas']['TokenIdentity'];
export type DevTokensResponse = components['schemas']['DevTokensResponse'];
export type DevTokenItem = components['schemas']['DevTokenItem'];
export type DevTokensStats = components['schemas']['DevTokensStats'];
export type TokenCallsResponse = components['schemas']['TokenCallsResponse'];
export type ErrorResponse = components['schemas']['ErrorResponse'];
export type TradeFeeEstimateResponse = components['schemas']['TradeFeeEstimateResponse'];
export type FeeEstimate = components['schemas']['FeeEstimate'];
export type CommissionSummaryResponse = components['schemas']['CommissionSummaryResponse'];
export type FeeRateResponse = components['schemas']['FeeRateResponse'];
export type ReferralCodeResponse = components['schemas']['ReferralCodeResponse'];
export type TgManagedChat = components['schemas']['TgManagedChat'];
export type TgChatFilter = components['schemas']['TgChatFilter'];
export type TgChatFilterConfig = components['schemas']['TgChatFilterConfig'];
export type TgSenderEntry = components['schemas']['TgSenderEntry'];
export type TgTopicEntry = components['schemas']['TgTopicEntry'];
export type TgChatFilterResponse = components['schemas']['TgChatFilterResponse'];
export type UpdateTgChatFilterRequest = components['schemas']['UpdateTgChatFilterRequest'];
export type PaginatedProfileResponse = components['schemas']['PaginatedProfileResponse'];
export type TokenMarketLaunchPad = components['schemas']['TokenMarketLaunchPad'];
export type TokenMarketBondingCurve = components['schemas']['TokenMarketBondingCurve'];
export type TokenMigrationSummary = components['schemas']['TokenMigrationSummary'];
export type TokenSnapshot = components['schemas']['TokenSnapshot'];
export type TokenSnapshotBase = components['schemas']['TokenSnapshotBase'];
export type ScannerTokensRequest = components['schemas']['ScannerTokensRequest'];
export type TokenFilter = components['schemas']['TokenFilter'];
export type TokenMarketFilter = components['schemas']['TokenMarketFilter'];
export type TokenSecurityFilter = components['schemas']['TokenSecurityFilter'];
export type TokenSocialFilter = components['schemas']['TokenSocialFilter'];
export type TokenSourceFilter = components['schemas']['TokenSourceFilter'];
export type TokenSourceGroup = components['schemas']['TokenSourceGroup'];
export type TokenTaxFilter = components['schemas']['TokenTaxFilter'];
export type WatchlistSourceItem = components['schemas']['WatchlistSourceItem'];
export type WalletSourceIdentity = components['schemas']['WalletSourceIdentity'];
export type TokenActivityFilter = components['schemas']['TokenActivityFilter'];
export type TokenActivityWindowFilter = components['schemas']['TokenActivityWindowFilter'];
export type TokenHolderFilter = components['schemas']['TokenHolderFilter'];
export type TokenFilterScope = components['schemas']['TokenFilterScope'];
export type ScannerGraduation = components['schemas']['ScannerGraduation'];
export type WatchlistRankItem = components['schemas']['WatchlistRankItem'];
export type WatchlistRankingResponse = components['schemas']['WatchlistRankingResponse'];
export type WatchlistSourcesResponse = components['schemas']['WatchlistSourcesResponse'];
export type CallerSource = components['schemas']['CallerSource'];
export type PlatformType = components['schemas']['PlatformType'];
export type TokenPairMarket = components['schemas']['TokenPairMarket'];
export type OrderBy = components['schemas']['OrderBy'];
export type RankBy = components['schemas']['RankBy'];
export type TransactionErrorResponse = components['schemas']['TransactionErrorResponse'];
export type PaginatedTransactionErrorResponse = components['schemas']['PaginatedTransactionErrorResponse'];
export type WatchlistRankingTimeframe = components['schemas']['WatchlistRankingTimeframe'];
export type WalletTimeRange = components['schemas']['WalletTimeRange'];
export type TokenTimeRange = components['schemas']['TokenTimeRange'];
export type TraderOverview = components['schemas']['TraderOverview'];
export type TraderPnlStats = components['schemas']['TraderPnlStats'];
export type TraderRankItem = components['schemas']['TraderRankItem'];
export type TraderRankingResponse = components['schemas']['TraderRankingResponse'];
export type WalletLabelInfo = components['schemas']['WalletLabelInfo'];
export type TraderSnapshotBase = components['schemas']['TraderSnapshotBase'];
export type TraderTokenPnlDetailResponse = components['schemas']['TraderTokenPnlDetailResponse'];
export type TraderTokenPnlItem = components['schemas']['TraderTokenPnlItem'];
export type TraderTokenPnlResponse = components['schemas']['TraderTokenPnlResponse'];
export type TraderTokenPnlSnapshot = components['schemas']['TraderTokenPnlSnapshot'];
export type TraderTokenPositionStatus = components['schemas']['TraderTokenPositionStatus'];
export type TraderTokenSwapEntry = components['schemas']['TraderTokenSwapEntry'];
export type TokenChartMarkersResponse = components['schemas']['TokenChartMarkersResponse'];
export type ChartMarker = components['schemas']['ChartMarker'];
export type ChartMarkerSwap = components['schemas']['ChartMarkerSwap'];
export type ChartMarkerKind = ChartMarker['kind'];
export type TokenMigrationMarker = components['schemas']['TokenMigrationMarker'];
export type TraderTokenSwapsResponse = components['schemas']['TraderTokenSwapsResponse'];
