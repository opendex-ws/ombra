<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { untrack } from 'svelte';
	import BarChart3 from 'lucide-svelte/icons/chart-column';
	import BotIcon from 'lucide-svelte/icons/bot';
	import List from 'lucide-svelte/icons/list';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import Settings from 'lucide-svelte/icons/settings';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Filter from 'lucide-svelte/icons/funnel';
	import ArrowUp from 'lucide-svelte/icons/arrow-up';
	import ArrowDown from 'lucide-svelte/icons/arrow-down';
	import ChainIcon from '$lib/components/ChainIcon.svelte';
	import { api } from '$lib/api/client';
	import { liveAccumulatedParams } from '$lib/utils/livecursor';
	import UserListModal from '$lib/components/UserListModal.svelte';
	import StarRating from '$lib/components/StarRating.svelte';
	import StarRatingInput from '$lib/components/StarRatingInput.svelte';
	import CreateBotModal from '$lib/components/CreateBotModal.svelte';
	import BotConfigSummary from '$lib/components/BotConfigSummary.svelte';
	import SourcePicker from '$lib/components/SourcePicker.svelte';
	import type { components } from '$lib/api/v2.d.ts';
	import type { WatchlistSourceItem, CallerSource } from '$lib/api/types';
	import { getIsLoggedIn, connectWallet, getIsConnecting, isPhantomInstalled, getAuthToken } from '$lib/stores/auth.svelte';
	import { authenticate, subscribe, unsubscribe } from '$lib/ws/client';
	import { fetchManagedWallets, getManagedWalletForChain } from '$lib/stores/trade.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { selectWatchlistCaller } from '$lib/stores/watchlist.svelte';
	import { setWatchlistOpen } from '$lib/stores/feSettings.svelte';
	import { formatUsd, shortAddress, timeAgo, fullDateTime, typeBadge, sourceBadge, parseTier, avatarUrl } from '$lib/utils/format';
	import { getWalletIconUrl, getWalletAddress } from '$lib/utils/walleticon';
	import { getNow } from '$lib/stores/tick.svelte';
	import type { BotSourceDescriptor } from '$lib/utils/bot-settings';

	let { routeActive = true }: { routeActive?: boolean } = $props();

	type Bot = components['schemas']['Bot'];
	type ActiveTrade = components['schemas']['ActiveTrade'];
	type CompletedTrade = components['schemas']['CompletedTrade'];
	type BotLog = components['schemas']['BotLog'];
	type BotStats = components['schemas']['BotStats'];
	type BotBalanceChange = components['schemas']['BotBalanceChange'];
	type BotsResponse = components['schemas']['BotsResponse'];
	type BotLogsResponse = components['schemas']['BotLogsResponse'];
	type BotBalanceChangesResponse = components['schemas']['BotBalanceChangesResponse'];
	type ActiveTradesResponse = components['schemas']['ActiveTradesResponse'];
	type CompletedTradesResponse = components['schemas']['CompletedTradesResponse'];
	type WatchlistSourceItem = components['schemas']['WatchlistSourceItem'];
	type WatchlistRankItem = components['schemas']['WatchlistRankItem'];
	type WatchlistRankingResponse = components['schemas']['WatchlistRankingResponse'];
	type TokenFilter = components['schemas']['TokenFilter'];
	type TokenMarketFilter = components['schemas']['TokenMarketFilter'];
	type TokenSecurityFilter = components['schemas']['TokenSecurityFilter'];
	type TokenSocialFilter = components['schemas']['TokenSocialFilter'];
	type TokenSourceFilter = components['schemas']['TokenSourceFilter'];
	type TokenTaxFilter = components['schemas']['TokenTaxFilter'];
	type Chain = components['schemas']['Chain'];
	type CallerSource = components['schemas']['CallerSource'];
	type WatchlistRankingTimeframe = components['schemas']['WatchlistRankingTimeframe'];
	type ErrorResponse = components['schemas']['ErrorResponse'];
	type UpdateBotStatusRequest = components['schemas']['UpdateBotStatusRequest'];
	type WalletSourceIdentity = components['schemas']['WalletSourceIdentity'];
	type TransactionErrorResponse = components['schemas']['TransactionErrorResponse'];
	type WatchlistRankingRankBy = components['schemas']['RankingRankBy'];
	type WatchlistRankingOrderBy = 'asc' | 'desc';
	type WatchlistRankingQuery = {
		timeframe: WatchlistRankingTimeframe;
		cursor?: string;
		winRatePctMin?: number;
		winRatePctMax?: number;
		totalCallsMin?: number;
		totalCallsMax?: number;
		rankBy: WatchlistRankingRankBy;
		orderBy: WatchlistRankingOrderBy;
		performanceScoreMin?: number;
		performanceScoreMax?: number;
	};

	type MainTab = 'leaderboard' | 'bots' | 'userlists' | 'errors';

	let mainTab = $state<MainTab>('leaderboard');

	const rankingRankOptions: { value: WatchlistRankingRankBy; label: string }[] = [
		{ value: 'performanceScore', label: 'Score' },
		{ value: 'winRatePct', label: 'Win %' },
		{ value: 'totalCalls', label: 'Calls' },
		{ value: 'averageMultiplier', label: 'Avg x' },
		{ value: 'highestMultiplier', label: 'Best x' }
	];

	let bots = $state<Bot[]>([]);
	// Server-reported total (accurate immediately from page 1, before/while the
	// cursor walk loads every bot). The list badge must use this, not bots.length.
	let botsTotal = $state<number | null>(null);
	let aggregateBotStats = $state<BotStats | null>(null);
	let globalBotTrades = $state<{ active: ActiveTrade[]; completed: CompletedTrade[] }>({ active: [], completed: [] });
	let globalBotLogs = $state<BotLog[]>([]);
	let globalBotBalanceChanges = $state<BotBalanceChange[]>([]);
	let walletSources = $state<WalletSourceIdentity[]>([]);

	let loading = $state(false);
	let error = $state('');

	let lbEntries = $state<WatchlistRankItem[]>([]);
	let lbLoading = $state(false);
	let lbTimeframe = $state<WatchlistRankingTimeframe>('7d');
	let lbRankBy = $state<WatchlistRankingRankBy>('performanceScore');
	let lbOrderBy = $state<WatchlistRankingOrderBy>('desc');
	let lbSearch = $state('');
	let lbCursor = $state<string | undefined>(undefined);
	let lbHasMore = $state(false);
	let lbMinWinRate = $state('');
	let lbMinCalls = $state('');
	let lbMinScore = $state('');
	let lbShowFilters = $state(false);
	let lbWsKey: string | null = null;
	let lbGeneration = 0;

	let myEntries = $state<WatchlistRankItem[]>([]);
	let myLoading = $state(false);
	let myTimeframe = $state<WatchlistRankingTimeframe>('7d');
	let myRankBy = $state<WatchlistRankingRankBy>('performanceScore');
	let myOrderBy = $state<WatchlistRankingOrderBy>('desc');
	let mySearch = $state('');
	let myCursor = $state<string | undefined>(undefined);
	let myHasMore = $state(false);
	let myMinWinRate = $state('');
	let myMinCalls = $state('');
	let myMinScore = $state('');
	let myShowFilters = $state(false);
	let myWsKey: string | null = null;
	let myGeneration = 0;
	type MySourceType = 'all' | 'callers' | 'tg' | 'lists' | 'wallets';
	let mySourceType = $state<MySourceType>('all');
	const mySourceOptions: { value: MySourceType; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'tg', label: 'Telegram' },
		{ value: 'lists', label: 'Lists' },
		{ value: 'wallets', label: 'Wallets' },
	];
	const mySourcePath: Record<MySourceType, '/v2/watchlist/ranking/all' | '/v2/watchlist/ranking/callers' | '/v2/watchlist/ranking/tg' | '/v2/watchlist/ranking/lists' | '/v2/watchlist/ranking/wallets'> = {
		all: '/v2/watchlist/ranking/all',
		callers: '/v2/watchlist/ranking/callers',
		tg: '/v2/watchlist/ranking/tg',
		lists: '/v2/watchlist/ranking/lists',
		wallets: '/v2/watchlist/ranking/wallets',
	};

	let showCreateBot = $state(false);
	let abSelectedSource = $state<BotSourceDescriptor | null>(null);
	let abDefaultChain = $state<Chain>('SOL');
	let abEditBot = $state<Bot | null>(null);

	let showSourcePicker = $state(false);

	let addWalletAddress = $state('');
	let addWalletName = $state('');
	let addWalletChain = $state<Chain>('SOL');
	let showAddWallet = $state(false);

	let userLists = $state<(WatchlistSourceItem & { type: 'LIST' })[]>([]);
	let userListsTotal = $state<number | null>(null);
	let userListsLoading = $state(false);
	let userListsFetched = $state(false);
	let showUserListForm = $state(false);
	let listModalEditList = $state<(WatchlistSourceItem & { type: 'LIST' }) | null>(null);
	let ulName = $state('');
	let ulChain = $state<Chain | ''>('');
	let ulMcapMin = $state('');
	let ulMcapMax = $state('');
	let ulLiqMin = $state('');
	let ulLiqMax = $state('');
	let ulAgeMin = $state('');
	let ulAgeMax = $state('');
	let ulDexPaid = $state<boolean | null>(null);
	let ulIsRenounced = $state<boolean | null>(null);
	let ulLpLocked = $state<boolean | null>(null);
	let ulHideBondingCurve = $state<boolean | null>(null);
	let ulHasWebsite = $state<boolean | null>(null);
	let ulHasTwitter = $state<boolean | null>(null);
	let ulHasTelegram = $state<boolean | null>(null);
	let ulHasDiscord = $state<boolean | null>(null);
	let ulWithAnySocial = $state<boolean | null>(null);
	let ulFreezeDisabled = $state<boolean | null>(null);
	let ulMintDisabled = $state<boolean | null>(null);
	let ulNotHoneypot = $state<boolean | null>(null);
	let ulIsVerified = $state<boolean | null>(null);
	let ulHideBondingCurveGraduated = $state<boolean | null>(null);
	let ulMaxBuyTax = $state('');
	let ulMaxSellTax = $state('');
	let ulMaxTransferTax = $state('');
	let ulFdvMin = $state('');
	let ulFdvMax = $state('');
	let ulSaving = $state(false);

	let ulSelectedCallers = $state<string[]>([]);
	let ulSelectedTgConns = $state<string[]>([]);
	let ulSelectedWallets = $state<string[]>([]);



	let txErrors = $state<TransactionErrorResponse[]>([]);
	let txErrorsLoading = $state(false);
	let txErrorsPage = $state(0);
	let txErrorsHasMore = $state(false);
	let txErrorsBotFilter = $state<string | null>(null);

	const chains: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];

	async function handleConnect() {
		try {
			await connectWallet();
			authenticate(getAuthToken());
		} catch {}
	}

	function getSourceName(item: WatchlistSourceItem): string {
		return (item as { name: string }).name;
	}

	function getSourceId(item: WatchlistSourceItem): string {
		return (item as { id: string }).id;
	}

	function getSourceType(item: WatchlistSourceItem): CallerSource {
		return (item as { type: CallerSource }).type;
	}

	function buildRankingQuery(
		timeframe: WatchlistRankingTimeframe,
		cursor: string | undefined,
		rankBy: WatchlistRankingRankBy,
		orderBy: WatchlistRankingOrderBy,
		minWinRate?: string,
		minCalls?: string,
		minScore?: string
	): WatchlistRankingQuery {
		const q: WatchlistRankingQuery = { timeframe, rankBy, orderBy };
		if (cursor !== undefined) q.cursor = cursor;
		if (minWinRate) q.winRatePctMin = Number(minWinRate);
		if (minCalls) q.totalCallsMin = Number(minCalls);
		if (minScore) q.performanceScoreMin = Number(minScore);
		return q;
	}

	function clearLeaderboardRealtime() {
		lbGeneration++;
		if (!lbWsKey) return;
		unsubscribe(lbWsKey);
		lbWsKey = null;
	}

	async function fetchLeaderboard(append = false) {
		const generation = ++lbGeneration;
		if (lbWsKey) {
			unsubscribe(lbWsKey);
			lbWsKey = null;
		}
		lbLoading = true;
		try {
			const query = buildRankingQuery(
				lbTimeframe,
				append ? lbCursor : undefined,
				lbRankBy,
				lbOrderBy,
				lbMinWinRate,
				lbMinCalls,
				lbMinScore
			);
			const { data } = await api.GET('/v2/watchlist/ranking/callers', {
				params: { query: query as never }
			});
			if (generation !== lbGeneration || mainTab !== 'leaderboard') return;
			const items = data?.items ?? [];
			if (append) {
				lbEntries = [...lbEntries, ...items];
			} else {
				lbEntries = items;
			}
			lbCursor = data?.nextCursor;
			lbHasMore = data?.nextCursor !== undefined;
			if (data) {
				const params: Record<string, unknown> = {
					timeframe: query.timeframe,
					rankBy: query.rankBy,
					orderBy: query.orderBy,
					endCursor: data.cursor
				};
				if (query.winRatePctMin !== undefined) params.winRatePctMin = query.winRatePctMin;
				if (query.totalCallsMin !== undefined) params.totalCallsMin = query.totalCallsMin;
				if (query.performanceScoreMin !== undefined) params.performanceScoreMin = query.performanceScoreMin;
				lbWsKey = subscribe('watchlist:ranking:callers', (event, payload, topic) => {
					if (
						generation !== lbGeneration
						|| mainTab !== 'leaderboard'
						|| topic !== 'watchlist:ranking:callers'
						|| event !== 'WATCHLIST_RANKING'
					) return;
					const snapshot = payload as WatchlistRankingResponse;
					lbEntries = snapshot.items;
					lbCursor = snapshot.nextCursor;
					lbHasMore = snapshot.nextCursor !== undefined;
				}, params, {
					recovery: 'refetch',
					onReconnect: () => { void fetchLeaderboard(false); }
				});
			}
		} catch (e) {
			console.error('[LB] fetch error:', e);
			if (generation === lbGeneration && !append) lbEntries = [];
		}
		finally {
			if (generation === lbGeneration) lbLoading = false;
			requestAnimationFrame(() => { if (generation === lbGeneration) lbFetching = false; });
		}
	}

	function clearMyRankingRealtime() {
		myGeneration++;
		if (!myWsKey) return;
		unsubscribe(myWsKey);
		myWsKey = null;
	}

	async function fetchMyCallers(append = false) {
		if (!getIsLoggedIn()) return;
		const generation = ++myGeneration;
		const sourceType = mySourceType;
		if (myWsKey) {
			unsubscribe(myWsKey);
			myWsKey = null;
		}
		myLoading = true;
		try {
			const query = buildRankingQuery(
				myTimeframe,
				append ? myCursor : undefined,
				myRankBy,
				myOrderBy,
				myMinWinRate,
				myMinCalls,
				myMinScore
			);
			const { data } = await api.GET(mySourcePath[sourceType], {
				params: { query: query as never }
			});
			if (
				generation !== myGeneration
				|| mainTab !== 'leaderboard'
				|| !getIsLoggedIn()
				|| sourceType !== mySourceType
			) return;
			const items = data?.items ?? [];
			if (append) {
				myEntries = [...myEntries, ...items];
			} else {
				myEntries = items;
			}
			myCursor = data?.nextCursor;
			myHasMore = data?.nextCursor !== undefined;
			if (data) {
				const topic = `watchlist:ranking:${sourceType}`;
				const params: Record<string, unknown> = {
					timeframe: query.timeframe,
					rankBy: query.rankBy,
					orderBy: query.orderBy,
					endCursor: data.cursor
				};
				if (query.winRatePctMin !== undefined) params.winRatePctMin = query.winRatePctMin;
				if (query.totalCallsMin !== undefined) params.totalCallsMin = query.totalCallsMin;
				if (query.performanceScoreMin !== undefined) params.performanceScoreMin = query.performanceScoreMin;
				myWsKey = subscribe(topic, (event, payload, frameTopic) => {
					if (
						generation !== myGeneration
						|| mainTab !== 'leaderboard'
						|| !getIsLoggedIn()
						|| sourceType !== mySourceType
						|| frameTopic !== topic
						|| event !== 'WATCHLIST_RANKING'
					) return;
					const snapshot = payload as WatchlistRankingResponse;
					myEntries = snapshot.items;
					myCursor = snapshot.nextCursor;
					myHasMore = snapshot.nextCursor !== undefined;
				}, params, {
					recovery: 'refetch',
					onReconnect: () => { void fetchMyCallers(false); }
				});
			}
		} catch (e) {
			console.error('[MY] fetch error:', e);
			if (generation === myGeneration && !append) myEntries = [];
		} finally {
			if (generation === myGeneration) myLoading = false;
			requestAnimationFrame(() => { if (generation === myGeneration) myFetching = false; });
		}
	}

	type BotWsEvent = 'BOTS' | 'BOTS_STATS' | 'BOTS_TRADES' | 'BOTS_LOGS' | 'BOTS_BALANCE_CHANGES';

	let globalBotWsKeys = new Map<string, string>();
	let scopedBotWsKeys = new Map<string, string>();
	let botRealtimeGeneration = 0;
	let botListGeneration = 0;
	let scopedBotGenerationCounter = 0;
	let scopedBotGenerations = new Map<string, number>();
	let seenBalanceChanges = new Set<string>();
	let globalBalanceHydrated = false;

	function isCurrentBotRealtime(generation: number): boolean {
		return generation === botRealtimeGeneration && getIsLoggedIn();
	}

	function balanceChangeKey(change: BotBalanceChange): string {
		return `${change.timestamp.timestamp}:${change.amountUsd}`;
	}

	function rememberBalanceChanges(changes: BotBalanceChange[]) {
		for (const change of changes) seenBalanceChanges.add(balanceChangeKey(change));
		while (seenBalanceChanges.size > 500) {
			const oldest = seenBalanceChanges.values().next().value;
			if (oldest === undefined) break;
			seenBalanceChanges.delete(oldest);
		}
	}

	function replaceGlobalBotSubscription(
		owner: string,
		topic: string,
		event: BotWsEvent,
		generation: number,
		reducer: (data: unknown) => void,
		params?: Record<string, unknown>,
		onReconnect?: () => void
	) {
		const existing = globalBotWsKeys.get(owner);
		if (existing) unsubscribe(existing);
		if (!isCurrentBotRealtime(generation)) {
			globalBotWsKeys.delete(owner);
			return;
		}
		const key = subscribe(topic, (frameEvent, data, frameTopic) => {
			if (!isCurrentBotRealtime(generation) || frameTopic !== topic || frameEvent !== event) return;
			reducer(data);
		}, params, onReconnect ? {
			recovery: 'refetch',
			onReconnect
		} : undefined);
		globalBotWsKeys.set(owner, key);
	}

	function replaceScopedBotSubscription(
		botId: string,
		owner: string,
		topic: string,
		event: BotWsEvent,
		generation: number,
		reducer: (data: unknown) => void,
		params?: Record<string, unknown>
	) {
		const ownerKey = `${botId}:${owner}`;
		const existing = scopedBotWsKeys.get(ownerKey);
		if (existing) unsubscribe(existing);
		if (!isCurrentScopedBot(botId, generation)) {
			scopedBotWsKeys.delete(ownerKey);
			return;
		}
		const key = subscribe(topic, (frameEvent, data, frameTopic) => {
			if (!isCurrentScopedBot(botId, generation) || frameTopic !== topic || frameEvent !== event) return;
			reducer(data);
		}, params);
		scopedBotWsKeys.set(ownerKey, key);
	}

	function clearGlobalBotRealtime() {
		botListGeneration++;
		for (const key of globalBotWsKeys.values()) unsubscribe(key);
		globalBotWsKeys.clear();
	}

	function clearScopedBotRealtime(botId: string, clearState = true) {
		for (const [owner, key] of scopedBotWsKeys) {
			if (!owner.startsWith(`${botId}:`)) continue;
			unsubscribe(key);
			scopedBotWsKeys.delete(owner);
		}
		scopedBotGenerations.delete(botId);
		if (!clearState) return;
		const nextTrades = new Map(botTrades);
		const nextLogs = new Map(botLogs);
		const nextBalances = new Map(botBalanceChanges);
		const nextTabs = new Map(botDetailTab);
		nextTrades.delete(botId);
		nextLogs.delete(botId);
		nextBalances.delete(botId);
		nextTabs.delete(botId);
		botTrades = nextTrades;
		botLogs = nextLogs;
		botBalanceChanges = nextBalances;
		botDetailTab = nextTabs;
	}

	function clearAllScopedBotRealtime() {
		for (const key of scopedBotWsKeys.values()) unsubscribe(key);
		scopedBotWsKeys.clear();
		scopedBotGenerations.clear();
		expandedBotIds = new Set();
		botTrades = new Map();
		botLogs = new Map();
		botBalanceChanges = new Map();
		botDetailTab = new Map();
	}

	function startScopedBotRealtime(botId: string): number {
		clearScopedBotRealtime(botId);
		const generation = ++scopedBotGenerationCounter;
		scopedBotGenerations.set(botId, generation);
		return generation;
	}

	function isCurrentScopedBot(botId: string, generation: number): boolean {
		return isCurrentBotRealtime(botRealtimeGeneration)
			&& scopedBotGenerations.get(botId) === generation
			&& expandedBotIds.has(botId);
	}

	function applyBotsSnapshot(data: BotsResponse) {
		bots = data.bots;
		if (typeof data.totalCount === 'number') botsTotal = data.totalCount;
		const botIds = new Set(data.bots.map((bot) => bot.id));
		const nextExpanded = new Set(expandedBotIds);
		for (const botId of expandedBotIds) {
			if (botIds.has(botId)) continue;
			clearScopedBotRealtime(botId);
			nextExpanded.delete(botId);
		}
		expandedBotIds = nextExpanded;
	}

	async function fetchBots(generation = botRealtimeGeneration) {
		const listGeneration = ++botListGeneration;
		const existing = globalBotWsKeys.get('list');
		if (existing) {
			unsubscribe(existing);
			globalBotWsKeys.delete('list');
		}
		try {
			// The bot list is cursor-paginated (max 100/page). Walk every page via
			// nextCursor so all bots load, then subscribe the live window through the
			// LAST page's tail cursor so the WS snapshot covers the full loaded range.
			const allBots: Bot[] = [];
			let tail: BotsResponse | null = null;
			let cursor: string | undefined;
			const seenCursors = new Set<string>();
			do {
				const { data } = await api.GET('/v2/bots', {
					params: { query: cursor ? { limit: 100, cursor } : { limit: 100 } }
				});
				if (!isCurrentBotRealtime(generation) || listGeneration !== botListGeneration) return;
				if (!data) break;
				tail = data;
				if (typeof data.totalCount === 'number') botsTotal = data.totalCount;
				allBots.push(...(data.bots ?? []));
				const next = data.nextCursor ?? undefined;
				if (!next || seenCursors.has(next)) break;
				seenCursors.add(next);
				cursor = next;
			} while (cursor);

			if (!tail) {
				bots = [];
				botsTotal = 0;
				return;
			}
			bots = allBots;
			replaceGlobalBotSubscription('list', 'bots:list', 'BOTS', generation, (payload) => {
				if (listGeneration !== botListGeneration) return;
				applyBotsSnapshot(payload as BotsResponse);
			}, liveAccumulatedParams(tail));
		} catch {
			if (isCurrentBotRealtime(generation) && listGeneration === botListGeneration) { bots = []; botsTotal = null; }
		}
	}

	function setupGlobalBotRealtime(generation: number) {
		replaceGlobalBotSubscription('stats', 'bots:stats', 'BOTS_STATS', generation, (payload) => {
			aggregateBotStats = payload as BotStats;
		});
		replaceGlobalBotSubscription('trades:active', 'bots:trades:active', 'BOTS_TRADES', generation, (payload) => {
			globalBotTrades = { ...globalBotTrades, active: (payload as ActiveTradesResponse).trades };
		});
		replaceGlobalBotSubscription('trades:completed', 'bots:trades:completed', 'BOTS_TRADES', generation, (payload) => {
			globalBotTrades = { ...globalBotTrades, completed: (payload as CompletedTradesResponse).trades };
		});
		replaceGlobalBotSubscription('logs', 'bots:logs', 'BOTS_LOGS', generation, (payload) => {
			globalBotLogs = (payload as BotLogsResponse).logs;
		});
		replaceGlobalBotSubscription('balance-changes', 'bots:balance-changes', 'BOTS_BALANCE_CHANGES', generation, (payload) => {
			const snapshot = payload as BotBalanceChangesResponse;
			const unseen = snapshot.balanceChanges.filter((change) => !seenBalanceChanges.has(balanceChangeKey(change)));
			globalBotBalanceChanges = snapshot.balanceChanges;
			rememberBalanceChanges(snapshot.balanceChanges);
			if (!globalBalanceHydrated) {
				globalBalanceHydrated = true;
				return;
			}
			if (unseen.length === 0) return;
			const message = unseen.length === 1
				? formatUsd(unseen[0].amountUsd)
				: `${unseen.length} balance changes`;
			addToast('info', 'Bot balance updated', message);
		});
	}

	async function fetchWalletSources() {
		try {
			const { data } = await api.GET('/v2/watchlist/sources/wallets');
			walletSources = (data?.sources ?? []).filter((s): s is WalletSourceIdentity & { type: 'WALLET' } => s.type === 'WALLET') as WalletSourceIdentity[];
		} catch { walletSources = []; }
	}

	let togglingBotIds = $state<Set<string>>(new Set());

	async function toggleBot(bot: Bot) {
		togglingBotIds = new Set([...togglingBotIds, bot.id]);
		try {
			await api.POST('/v2/bots/{id}/status', {
				params: { path: { id: bot.id } },
				body: {
					status: bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
				} satisfies UpdateBotStatusRequest
			});
			await fetchBots();
		} catch {} finally {
			const next = new Set(togglingBotIds);
			next.delete(bot.id);
			togglingBotIds = next;
		}
	}

	async function deleteBot(botId: string) {
		try {
			await api.DELETE('/v2/bots/{id}', { params: { path: { id: botId } } });
			clearScopedBotRealtime(botId);
			await fetchBots();
		} catch {}
	}

	let expandedBotIds = $state<Set<string>>(new Set());
	let botTrades = $state<Map<string, { active: ActiveTrade[]; completed: CompletedTrade[]; loading: boolean }>>(new Map());
	let botLogs = $state<Map<string, { logs: BotLog[]; loading: boolean }>>(new Map());
	let botBalanceChanges = $state<Map<string, BotBalanceChange[]>>(new Map());
	let botDetailTab = $state<Map<string, 'trades' | 'logs'>>(new Map());

	function toggleBotExpand(botId: string) {
		const next = new Set(expandedBotIds);
		if (next.has(botId)) {
			next.delete(botId);
			expandedBotIds = next;
			clearScopedBotRealtime(botId);
		} else {
			next.add(botId);
			expandedBotIds = next;
			const generation = startScopedBotRealtime(botId);
			botDetailTab = new Map([...botDetailTab, [botId, 'trades']]);
			void fetchBotTrades(botId, generation);
			setupBotBalanceRealtime(botId, generation);
		}
	}

	function setBotDetailTab(botId: string, tab: 'trades' | 'logs') {
		botDetailTab = new Map([...botDetailTab, [botId, tab]]);
		const generation = scopedBotGenerations.get(botId);
		if (tab === 'logs' && generation !== undefined && !botLogs.has(botId)) {
			void fetchBotLogs(botId, generation);
		}
	}

	async function fetchBotTrades(botId: string, generation: number) {
		if (!isCurrentScopedBot(botId, generation)) return;
		botTrades = new Map([...botTrades, [botId, { active: [], completed: [], loading: true }]]);
		try {
			const [a, c] = await Promise.all([
				api.GET('/v2/bots/{id}/trades/active', { params: { path: { id: botId }, query: { limit: 20 } } }),
				api.GET('/v2/bots/{id}/trades/completed', { params: { path: { id: botId }, query: { limit: 20 } } })
			]);
			if (!isCurrentScopedBot(botId, generation)) return;
			botTrades = new Map([...botTrades, [botId, {
				active: a.data?.trades ?? [],
				completed: c.data?.trades ?? [],
				loading: false
			}]]);
			if (a.data) {
				const topic = `bots:${botId}:trades:active`;
				replaceScopedBotSubscription(botId, 'trades:active', topic, 'BOTS_TRADES', generation, (payload) => {
					const current = botTrades.get(botId);
					if (!current) return;
					botTrades = new Map([...botTrades, [botId, {
						...current,
						active: (payload as ActiveTradesResponse).trades,
						loading: false
					}]]);
				}, { endCursor: a.data.cursor });
			}
			if (c.data) {
				const topic = `bots:${botId}:trades:completed`;
				replaceScopedBotSubscription(botId, 'trades:completed', topic, 'BOTS_TRADES', generation, (payload) => {
					const current = botTrades.get(botId);
					if (!current) return;
					botTrades = new Map([...botTrades, [botId, {
						...current,
						completed: (payload as CompletedTradesResponse).trades,
						loading: false
					}]]);
				}, { endCursor: c.data.cursor });
			}
		} catch {
			if (isCurrentScopedBot(botId, generation)) {
				botTrades = new Map([...botTrades, [botId, { active: [], completed: [], loading: false }]]);
			}
		}
	}

	async function fetchBotLogs(botId: string, generation: number) {
		if (!isCurrentScopedBot(botId, generation)) return;
		botLogs = new Map([...botLogs, [botId, { logs: [], loading: true }]]);
		try {
			const { data } = await api.GET('/v2/bots/{id}/logs', { params: { path: { id: botId }, query: { limit: 50 } } });
			if (!isCurrentScopedBot(botId, generation)) return;
			botLogs = new Map([...botLogs, [botId, { logs: data?.logs ?? [], loading: false }]]);
			if (data) {
				const topic = `bots:${botId}:logs`;
				replaceScopedBotSubscription(botId, 'logs', topic, 'BOTS_LOGS', generation, (payload) => {
					botLogs = new Map([...botLogs, [botId, {
						logs: (payload as BotLogsResponse).logs,
						loading: false
					}]]);
				}, { limit: 50, endCursor: data.cursor });
			}
		} catch {
			if (isCurrentScopedBot(botId, generation)) {
				botLogs = new Map([...botLogs, [botId, { logs: [], loading: false }]]);
			}
		}
	}

	function setupBotBalanceRealtime(botId: string, generation: number) {
		const topic = `bots:${botId}:balance-changes`;
		replaceScopedBotSubscription(botId, 'balance-changes', topic, 'BOTS_BALANCE_CHANGES', generation, (payload) => {
			botBalanceChanges = new Map([...botBalanceChanges, [botId, (payload as BotBalanceChangesResponse).balanceChanges]]);
		});
	}

	function winRate(bot: Bot): number {
		const total = bot.stats.wins + bot.stats.losses;
		return total > 0 ? (bot.stats.wins / total) * 100 : 0;
	}

	function selectRankItem(entry: WatchlistRankItem) {
		abSelectedSource = { id: entry.source.id, type: entry.source.type, name: entry.source.name, ...(entry.source.type === 'WALLET' ? { chain: entry.source.chain } : {}) };
		abDefaultChain = entry.source.type === 'WALLET' ? entry.source.chain : 'SOL';
		abEditBot = null;
		showCreateBot = true;
	}

	function openEditBot(bot: Bot) {
		abSelectedSource = { id: bot.source.id, type: bot.source.type, name: bot.source.name, ...(bot.source.type === 'WALLET' ? { chain: bot.source.chain } : {}) };
		abDefaultChain = (Object.keys(bot.chainConfigs)[0] as Chain) ?? 'SOL';
		abEditBot = bot;
		showCreateBot = true;
	}

	function selectWalletSource(w: WalletSourceIdentity) {
		abSelectedSource = { id: w.id, type: 'WALLET', name: w.name, chain: w.chain };
		abDefaultChain = w.chain;
		abEditBot = null;
		showCreateBot = true;
	}

	function handleSourceSelected(item: WatchlistSourceItem) {
		abSelectedSource = { id: getSourceId(item), type: getSourceType(item), name: getSourceName(item), ...(item.type === 'WALLET' ? { chain: item.chain } : {}) };
		abDefaultChain = item.type === 'WALLET' ? item.chain : 'SOL';
		abEditBot = null;
		showCreateBot = true;
	}

	async function addCopyWallet() {
		if (!addWalletAddress || !addWalletName) return;
		try {
			await api.POST('/v2/watchlist/manage/wallets/create', {
				body: { chain: addWalletChain, walletAddress: addWalletAddress, name: addWalletName }
			});
			showAddWallet = false;
			addWalletAddress = '';
			addWalletName = '';
			await fetchWalletSources();
		} catch (e: unknown) { error = e instanceof Error ? e.message : 'Failed'; }
	}

	async function removeCopyWallet(id: string) {
		try {
			await api.DELETE('/v2/watchlist/manage/wallets/{walletId}/delete', { params: { path: { walletId: id } } });
			await fetchWalletSources();
		} catch {}
	}

	async function fetchUserLists() {
		userListsLoading = true;
		try {
			const { data } = await api.GET('/v2/watchlist/sources/lists');
			userLists = (data?.sources ?? []).filter((s): s is WatchlistSourceItem & { type: 'LIST' } => s.type === 'LIST');
			userListsTotal = data?.totalCount ?? null;
		} catch {} finally { userListsLoading = false; userListsFetched = true; }
	}

	function openCreateList() {
		listModalEditList = null;
		showUserListForm = true;
	}

	function openEditList(list: WatchlistSourceItem & { type: 'LIST' }) {
		listModalEditList = list;
		showUserListForm = true;
	}

	async function deleteUserList(id: string) {
		try {
			await api.DELETE('/v2/watchlist/manage/lists/{listId}/delete', { params: { path: { listId: id } } });
			await fetchUserLists();
		} catch {}
	}



	async function fetchTxErrors(append = false) {
		txErrorsLoading = true;
		try {
			const query: Record<string, unknown> = { page: append ? txErrorsPage : 0, limit: 20 };
			if (txErrorsBotFilter) query.botId = txErrorsBotFilter;
			const { data } = await api.GET('/v2/user/transaction-errors', {
				params: { query: query as never }
			});
			const items = data?.data ?? [];
			if (append) {
				txErrors = [...txErrors, ...items];
			} else {
				txErrors = items;
				txErrorsPage = 0;
			}
			txErrorsHasMore = data?.hasMore ?? false;
			if (append) txErrorsPage++;
		} catch {
			if (!append) txErrors = [];
			txErrorsHasMore = false;
		} finally {
			txErrorsLoading = false;
		}
	}

	let lbFiltered = $derived(lbEntries.filter(e => !lbSearch || e.source.name.toLowerCase().includes(lbSearch.toLowerCase())));
	let myFiltered = $derived(myEntries.filter(e => !mySearch || e.source.name.toLowerCase().includes(mySearch.toLowerCase())));

	function refetchLb() { lbCursor = undefined; fetchLeaderboard(); }
	function refetchMy() { myCursor = undefined; fetchMyCallers(); }

	let lbDebounce: ReturnType<typeof setTimeout> | null = null;
	let myDebounce: ReturnType<typeof setTimeout> | null = null;
	function debouncedRefetchLb() { clearLeaderboardRealtime(); if (lbDebounce) clearTimeout(lbDebounce); lbDebounce = setTimeout(refetchLb, 400); }
	function debouncedRefetchMy() { clearMyRankingRealtime(); if (myDebounce) clearTimeout(myDebounce); myDebounce = setTimeout(refetchMy, 400); }

	function setLbMinScore(stars: number) {
		const val = stars * 6;
		lbMinScore = lbMinScore === String(val) ? '' : String(val);
		refetchLb();
	}
	function setMyMinScore(stars: number) {
		const val = stars * 6;
		myMinScore = myMinScore === String(val) ? '' : String(val);
		refetchMy();
	}
	function lbMinScoreStars(): number { return lbMinScore ? Math.round(Number(lbMinScore) / 6) : 0; }
	function myMinScoreStars(): number { return myMinScore ? Math.round(Number(myMinScore) / 6) : 0; }

	function updateLbRankBy(value: string) {
		lbRankBy = value as WatchlistRankingRankBy;
		refetchLb();
	}

	function updateMyRankBy(value: string) {
		myRankBy = value as WatchlistRankingRankBy;
		refetchMy();
	}

	function toggleLbOrderBy() {
		lbOrderBy = lbOrderBy === 'desc' ? 'asc' : 'desc';
		refetchLb();
	}

	function toggleMyOrderBy() {
		myOrderBy = myOrderBy === 'desc' ? 'asc' : 'desc';
		refetchMy();
	}

	$effect(() => {
		if (!routeActive) {
			untrack(() => {
				clearGlobalBotRealtime();
				clearAllScopedBotRealtime();
				clearMyRankingRealtime();
				clearLeaderboardRealtime();
			});
			return;
		}
		const loggedIn = getIsLoggedIn();
		const generation = ++botRealtimeGeneration;
		untrack(() => {
			clearGlobalBotRealtime();
			clearAllScopedBotRealtime();
			clearMyRankingRealtime();
			if (!loggedIn) {
				bots = [];
				aggregateBotStats = null;
				globalBotTrades = { active: [], completed: [] };
				globalBotLogs = [];
				globalBotBalanceChanges = [];
				seenBalanceChanges.clear();
				globalBalanceHydrated = false;
				loading = false;
				return;
			}
			loading = true;
			fetchManagedWallets();
			setupGlobalBotRealtime(generation);
			Promise.all([fetchBots(generation), fetchWalletSources()])
				.finally(() => {
					if (isCurrentBotRealtime(generation)) loading = false;
				});
			if (prevMainTab === 'leaderboard') void fetchMyCallers();
		});
		return () => {
			untrack(() => {
				if (generation !== botRealtimeGeneration) return;
				botRealtimeGeneration++;
				clearGlobalBotRealtime();
				clearAllScopedBotRealtime();
				clearMyRankingRealtime();
			});
		};
	});

	let prevMainTab = '';
	$effect(() => {
		if (!routeActive) return;
		const tab = mainTab;
		if (tab === prevMainTab) return;
		prevMainTab = tab;
		if (tab !== 'bots') clearAllScopedBotRealtime();
		if (tab === 'leaderboard') {
			lbCursor = undefined;
			myCursor = undefined;
			lbFetching = false;
			myFetching = false;
			fetchLeaderboard();
			if (getIsLoggedIn()) fetchMyCallers();
		} else {
			clearLeaderboardRealtime();
			clearMyRankingRealtime();
		}
		if (tab === 'errors' && getIsLoggedIn()) {
			fetchTxErrors();
		}
	});

	$effect(() => {
		return () => {
			clearLeaderboardRealtime();
			clearMyRankingRealtime();
		};
	});

	$effect(() => {
		if (!routeActive) return;
		if (getIsLoggedIn() && mainTab === 'userlists' && !userListsFetched) {
			fetchUserLists();
		}
	});

	let lbFetching = false;
	let myFetching = false;

	function handleColumnScroll(e: Event, fetchingKey: 'lb' | 'my', hasMore: boolean, loadMore: () => void) {
		const fetching = fetchingKey === 'lb' ? lbFetching : myFetching;
		if (fetching || !hasMore) return;
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
			if (fetchingKey === 'lb') lbFetching = true; else myFetching = true;
			loadMore();
		}
	}

	function getRankItemName(entry: WatchlistRankItem): string {
		return entry.source.name;
	}

	function getRankItemType(entry: WatchlistRankItem): CallerSource {
		return entry.source.type;
	}

	let txErrorsByBot = $derived.by(() => {
		const groups = new Map<string, { botName: string; sourceType: string; errors: TransactionErrorResponse[] }>();
		const ungrouped: TransactionErrorResponse[] = [];
		for (const err of txErrors) {
			const botKey = err.callerName ?? err.copyWalletName;
			if (botKey) {
				if (!groups.has(botKey)) {
					groups.set(botKey, { botName: botKey, sourceType: err.sourceType ?? '', errors: [] });
				}
				groups.get(botKey)!.errors.push(err);
			} else {
				ungrouped.push(err);
			}
		}
		return { groups: [...groups.values()], ungrouped };
	});
</script>

<div class="h-[calc(100dvh-48px)] md:h-[calc(100dvh-48px-28px)] overflow-hidden bg-s0 pb-24 md:pb-0">
		<div class="flex h-full flex-col">
			{#if getIsLoggedIn()}
				<div class="flex shrink-0 border-b border-bd bg-s0">
					<button
						onclick={() => (mainTab = 'leaderboard')}
						class="relative flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-all {mainTab === 'leaderboard' ? 'text-tx' : 'text-g5 hover:text-g9'}"
					>
						<BarChart3 class="hidden md:block h-3.5 w-3.5" strokeWidth={1.5} />
						Leaderboard
						{#if mainTab === 'leaderboard'}<div class="absolute bottom-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-grn"></div>{/if}
					</button>
					<button
						onclick={() => (mainTab = 'bots')}
						class="relative flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-all {mainTab === 'bots' ? 'text-tx' : 'text-g5 hover:text-g9'}"
					>
						<BotIcon class="hidden md:block h-3.5 w-3.5" strokeWidth={1.5} />
						My Bots
						{#if (botsTotal ?? bots.length) > 0}
							<span class="rounded-full bg-s7 px-1.5 py-0.5 text-[10px] text-g5">{Math.max(botsTotal ?? 0, bots.length)}</span>
						{/if}
						{#if mainTab === 'bots'}<div class="absolute bottom-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-grn"></div>{/if}
					</button>
					<button
						onclick={() => (mainTab = 'userlists')}
						class="relative flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-all {mainTab === 'userlists' ? 'text-tx' : 'text-g5 hover:text-g9'}"
					>
						<List class="hidden md:block h-3.5 w-3.5" strokeWidth={1.5} />
						Lists
						{#if (userListsTotal ?? userLists.length) > 0}
							<span class="rounded-full bg-s7 px-1.5 py-0.5 text-[10px] text-g5">{userListsTotal ?? userLists.length}</span>
						{/if}
						{#if mainTab === 'userlists'}<div class="absolute bottom-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-grn"></div>{/if}
					</button>
					<button
						onclick={() => (mainTab = 'errors')}
						class="relative flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-all {mainTab === 'errors' ? 'text-tx' : 'text-g5 hover:text-g9'}"
					>
						<AlertTriangle class="hidden md:block h-3.5 w-3.5" strokeWidth={1.5} />
						<span class="md:hidden">Errors</span>
						<span class="hidden md:inline">Failed Trades</span>
						{#if mainTab === 'errors'}<div class="absolute bottom-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-grn"></div>{/if}
					</button>
				</div>
			{/if}

			<div class="flex flex-1 flex-col overflow-y-auto p-3 md:p-6">
				{#if error}
					<div class="animate-fade-in mb-4 rounded-xl border border-red/20 bg-red/10 px-4 py-2.5 text-sm text-red">
						{error}
						<button class="ml-2 cursor-pointer underline opacity-70 hover:opacity-100" onclick={() => (error = '')}>dismiss</button>
					</div>
				{/if}

				{#if mainTab === 'leaderboard'}
				<div class="flex flex-1 flex-col min-h-0">
					<div class="mb-4 shrink-0">
						<h2 class="text-lg font-bold text-tx">Caller Leaderboard</h2>
					</div>

					{#if getIsLoggedIn()}
						<div class="flex flex-col md:grid md:grid-cols-2 gap-3 md:gap-4 flex-1 min-h-0">
							<div class="flex flex-col min-h-0 flex-1 rounded-xl border border-bd bg-s1">
								<div class="shrink-0 border-b border-bd p-2.5 space-y-2">
									<div class="flex items-center justify-between gap-2">
										<div class="flex items-center gap-2">
											<h3 class="text-sm font-bold text-tx">Built-in Callers</h3>
											<span class="rounded-full bg-s7 px-2 py-0.5 text-[10px] text-g5">{lbFiltered.length}</span>
										</div>
										<input type="text" bind:value={lbSearch} placeholder="Search..." class="w-28 md:w-36 rounded-lg border border-bd bg-s4 px-2.5 py-1 text-xs text-tx placeholder-g3 outline-none focus:border-grn/40" />
									</div>
									<div class="flex items-center gap-1.5">
										<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none">
											<div class="flex shrink-0 gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
												{#each [{ l: '1d', v: '1d' as WatchlistRankingTimeframe }, { l: '3d', v: '3d' as WatchlistRankingTimeframe }, { l: '7d', v: '7d' as WatchlistRankingTimeframe }, { l: '30d', v: '30d' as WatchlistRankingTimeframe }] as t}
													<button onclick={() => { lbTimeframe = t.v; refetchLb(); }} class="rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer {lbTimeframe === t.v ? 'bg-grn/20 text-grn' : 'text-g5 hover:text-g9'}">{t.l}</button>
												{/each}
											</div>
											<div class="flex shrink-0 gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
												{#each rankingRankOptions as opt}
													<button onclick={() => updateLbRankBy(opt.value)} class="rounded-md px-1.5 py-1 text-[10px] font-medium whitespace-nowrap transition-colors cursor-pointer {lbRankBy === opt.value ? 'bg-grn/20 text-grn' : 'text-g5 hover:text-g9'}">{opt.label}</button>
												{/each}
											</div>
										</div>
										<button onclick={toggleLbOrderBy} class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-bd bg-s4 text-g6 transition-colors hover:text-tx">
											{#if lbOrderBy === 'desc'}<ArrowDown class="h-3 w-3" strokeWidth={2.5} />{:else}<ArrowUp class="h-3 w-3" strokeWidth={2.5} />{/if}
										</button>
										<button onclick={() => { lbShowFilters = !lbShowFilters; }} class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors {lbShowFilters ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd bg-s4 text-g6 hover:text-tx'}"><Filter class="h-3 w-3" strokeWidth={2.5} /></button>
									</div>
									{#if lbShowFilters}
										<div class="flex items-center gap-3 rounded-lg border border-bd/50 bg-s4/40 px-2.5 py-1.5">
											<div class="flex items-center gap-1.5">
												<span class="text-[10px] text-g5 shrink-0">Win%</span>
												<input type="range" min="0" max="100" step="5" value={lbMinWinRate || '0'} oninput={(e) => { lbMinWinRate = e.currentTarget.value === '0' ? '' : e.currentTarget.value; debouncedRefetchLb(); }} class="h-1 w-16 cursor-pointer accent-grn" />
												<span class="text-[10px] font-medium {lbMinWinRate ? 'text-grn' : 'text-g4'} w-6">{lbMinWinRate ? `${lbMinWinRate}%` : '—'}</span>
											</div>
											<div class="flex items-center gap-1.5">
												<span class="text-[10px] text-g5 shrink-0">Calls</span>
												<input type="number" placeholder="min" bind:value={lbMinCalls} oninput={debouncedRefetchLb} class="h-5 w-12 rounded border border-bd bg-s4 px-1.5 text-[10px] text-tx placeholder-g3 outline-none focus:border-grn/40" />
											</div>
											<div class="flex items-center gap-1">
												<span class="text-[10px] text-g5 shrink-0">Score</span>
												<StarRatingInput value={lbMinScoreStars()} onselect={(s) => setLbMinScore(s)} />
											</div>
											{#if lbMinWinRate || lbMinCalls || lbMinScore}
												<button onclick={() => { lbMinWinRate = ''; lbMinCalls = ''; lbMinScore = ''; refetchLb(); }} class="shrink-0 cursor-pointer text-[10px] text-red hover:text-red/80 transition-colors">✕</button>
											{/if}
										</div>
									{/if}
								</div>
							<div class="flex-1 overflow-y-auto min-h-0 p-2" onscroll={(e) => handleColumnScroll(e, 'lb', lbHasMore, () => { fetchLeaderboard(true); })}>
								{@render lbColumn(lbFiltered, lbLoading, lbHasMore)}
							</div>
						</div>
						<div class="flex flex-col min-h-0 flex-1 rounded-xl border border-bd bg-s1">
							<div class="shrink-0 border-b border-bd p-2.5 space-y-2">
									<div class="flex items-center gap-2">
										<h3 class="shrink-0 text-sm font-bold text-tx">Your Callers</h3>
										<span class="shrink-0 rounded-full bg-s7 px-2 py-0.5 text-[10px] text-g5">{myFiltered.length}</span>
										<div class="flex flex-1 justify-center">
											<div class="flex gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
												{#each mySourceOptions as opt}
													<button onclick={() => { mySourceType = opt.value; refetchMy(); }} class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer {mySourceType === opt.value ? 'bg-grn/20 text-grn' : 'text-g5 hover:text-g9'}">{opt.label}</button>
												{/each}
											</div>
										</div>
										<input type="text" bind:value={mySearch} placeholder="Search..." class="w-24 md:w-28 shrink-0 rounded-lg border border-bd bg-s4 px-2.5 py-1 text-xs text-tx placeholder-g3 outline-none focus:border-grn/40" />
									</div>
									<div class="flex items-center gap-1.5">
										<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none">
											<div class="flex shrink-0 gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
												{#each [{ l: '1d', v: '1d' as WatchlistRankingTimeframe }, { l: '3d', v: '3d' as WatchlistRankingTimeframe }, { l: '7d', v: '7d' as WatchlistRankingTimeframe }, { l: '30d', v: '30d' as WatchlistRankingTimeframe }] as t}
													<button onclick={() => { myTimeframe = t.v; refetchMy(); }} class="rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer {myTimeframe === t.v ? 'bg-grn/20 text-grn' : 'text-g5 hover:text-g9'}">{t.l}</button>
												{/each}
											</div>
											<div class="flex shrink-0 gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
												{#each rankingRankOptions as opt}
													<button onclick={() => updateMyRankBy(opt.value)} class="rounded-md px-1.5 py-1 text-[10px] font-medium whitespace-nowrap transition-colors cursor-pointer {myRankBy === opt.value ? 'bg-grn/20 text-grn' : 'text-g5 hover:text-g9'}">{opt.label}</button>
												{/each}
											</div>
										</div>
										<button onclick={toggleMyOrderBy} class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-bd bg-s4 text-g6 transition-colors hover:text-tx">
											{#if myOrderBy === 'desc'}<ArrowDown class="h-3 w-3" strokeWidth={2.5} />{:else}<ArrowUp class="h-3 w-3" strokeWidth={2.5} />{/if}
										</button>
										<button onclick={() => { myShowFilters = !myShowFilters; }} class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors {myShowFilters ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd bg-s4 text-g6 hover:text-tx'}"><Filter class="h-3 w-3" strokeWidth={2.5} /></button>
									</div>
									{#if myShowFilters}
										<div class="flex items-center gap-3 rounded-lg border border-bd/50 bg-s4/40 px-2.5 py-1.5">
											<div class="flex items-center gap-1.5">
												<span class="text-[10px] text-g5 shrink-0">Win%</span>
												<input type="range" min="0" max="100" step="5" value={myMinWinRate || '0'} oninput={(e) => { myMinWinRate = e.currentTarget.value === '0' ? '' : e.currentTarget.value; debouncedRefetchMy(); }} class="h-1 w-16 cursor-pointer accent-grn" />
												<span class="text-[10px] font-medium {myMinWinRate ? 'text-grn' : 'text-g4'} w-6">{myMinWinRate ? `${myMinWinRate}%` : '—'}</span>
											</div>
											<div class="flex items-center gap-1.5">
												<span class="text-[10px] text-g5 shrink-0">Calls</span>
												<input type="number" placeholder="min" bind:value={myMinCalls} oninput={debouncedRefetchMy} class="h-5 w-12 rounded border border-bd bg-s4 px-1.5 text-[10px] text-tx placeholder-g3 outline-none focus:border-grn/40" />
											</div>
											<div class="flex items-center gap-1">
												<span class="text-[10px] text-g5 shrink-0">Score</span>
												<StarRatingInput value={myMinScoreStars()} onselect={(s) => setMyMinScore(s)} />
											</div>
											{#if myMinWinRate || myMinCalls || myMinScore}
												<button onclick={() => { myMinWinRate = ''; myMinCalls = ''; myMinScore = ''; refetchMy(); }} class="shrink-0 cursor-pointer text-[10px] text-red hover:text-red/80 transition-colors">✕</button>
											{/if}
										</div>
									{/if}
								</div>
							<div class="flex-1 overflow-y-auto min-h-0 p-2" onscroll={(e) => handleColumnScroll(e, 'my', myHasMore, () => { fetchMyCallers(true); })}>
								{@render lbColumn(myFiltered, myLoading, myHasMore)}
							</div>
							</div>
						</div>
					{:else}
						<div class="rounded-xl border border-bd bg-s1 flex flex-col flex-1 min-h-0">
							<div class="shrink-0 border-b border-bd p-2.5 space-y-2">
								<div class="flex items-center justify-between gap-2">
									<input type="text" bind:value={lbSearch} placeholder="Search..." class="w-44 rounded-lg border border-bd bg-s4 px-2.5 py-1 text-xs text-tx placeholder-g3 outline-none focus:border-grn/40" />
								</div>
								<div class="flex items-center gap-1.5">
									<div class="flex gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
										{#each [{ l: '1d', v: '1d' as WatchlistRankingTimeframe }, { l: '3d', v: '3d' as WatchlistRankingTimeframe }, { l: '7d', v: '7d' as WatchlistRankingTimeframe }, { l: '30d', v: '30d' as WatchlistRankingTimeframe }] as t}
											<button onclick={() => { lbTimeframe = t.v; refetchLb(); }} class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer {lbTimeframe === t.v ? 'bg-grn/20 text-grn' : 'text-g5 hover:text-g9'}">{t.l}</button>
										{/each}
									</div>
									<div class="flex flex-1 gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
										{#each rankingRankOptions as opt}
											<button onclick={() => updateLbRankBy(opt.value)} class="flex-1 rounded-md px-1 py-1 text-[10px] font-medium transition-colors cursor-pointer {lbRankBy === opt.value ? 'bg-grn/20 text-grn' : 'text-g5 hover:text-g9'}">{opt.label}</button>
										{/each}
										<button onclick={toggleLbOrderBy} class="rounded-md px-1 py-1 text-g6 transition-colors cursor-pointer hover:text-tx">
											{#if lbOrderBy === 'desc'}<ArrowDown class="h-3 w-3" strokeWidth={2.5} />{:else}<ArrowUp class="h-3 w-3" strokeWidth={2.5} />{/if}
										</button>
									</div>
									<button onclick={() => { lbShowFilters = !lbShowFilters; }} class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors {lbShowFilters ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd bg-s4 text-g6 hover:text-tx'}"><Filter class="h-3 w-3" strokeWidth={2.5} /></button>
								</div>
								{#if lbShowFilters}
									<div class="flex items-center gap-3 rounded-lg border border-bd/50 bg-s4/40 px-2.5 py-1.5">
										<div class="flex items-center gap-1.5">
											<span class="text-[10px] text-g5 shrink-0">Win%</span>
											<input type="range" min="0" max="100" step="5" value={lbMinWinRate || '0'} oninput={(e) => { lbMinWinRate = e.currentTarget.value === '0' ? '' : e.currentTarget.value; debouncedRefetchLb(); }} class="h-1 w-16 cursor-pointer accent-grn" />
											<span class="text-[10px] font-medium {lbMinWinRate ? 'text-grn' : 'text-g4'} w-6">{lbMinWinRate ? `${lbMinWinRate}%` : '—'}</span>
										</div>
										<div class="flex items-center gap-1.5">
											<span class="text-[10px] text-g5 shrink-0">Calls</span>
											<input type="number" placeholder="min" bind:value={lbMinCalls} oninput={debouncedRefetchLb} class="h-5 w-12 rounded border border-bd bg-s4 px-1.5 text-[10px] text-tx placeholder-g3 outline-none focus:border-grn/40" />
										</div>
										<div class="flex items-center gap-1">
											<span class="text-[10px] text-g5 shrink-0">Score</span>
											<StarRatingInput value={lbMinScoreStars()} onselect={(s) => setLbMinScore(s)} />
										</div>
										{#if lbMinWinRate || lbMinCalls || lbMinScore}
											<button onclick={() => { lbMinWinRate = ''; lbMinCalls = ''; lbMinScore = ''; refetchLb(); }} class="shrink-0 cursor-pointer text-[10px] text-red hover:text-red/80 transition-colors">✕</button>
										{/if}
									</div>
								{/if}
							</div>
							<div class="flex-1 overflow-y-auto min-h-0 p-2" onscroll={(e) => handleColumnScroll(e, 'lb', lbHasMore, () => { fetchLeaderboard(true); })}>
								{@render lbColumn(lbFiltered, lbLoading, lbHasMore)}
							</div>
						</div>
					{/if}
				</div>

				{:else if mainTab === 'bots'}
					<div class="mb-5 flex items-center justify-between">
						<h2 class="text-lg font-bold text-tx">My Bots</h2>
						<button onclick={() => (showSourcePicker = true)} class="cursor-pointer rounded-lg bg-grn px-3 py-1.5 text-xs font-semibold text-s0 transition-all">+ Create Bot</button>
					</div>

					{#if bots.length > 0}
						<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-g6">Bots</h3>
						<div class="mb-6 space-y-2">
							{#each bots as bot}
								{@const wr = winRate(bot)}
								{@const expanded = expandedBotIds.has(bot.id)}
								<div class="rounded-xl border border-bd bg-s1">
									<div class="flex">
										<button onclick={() => toggleBotExpand(bot.id)} class="cursor-pointer flex-1 min-w-0 p-3 text-left">
											<div class="flex items-center gap-2">
												<span class="text-sm font-semibold text-tx truncate">{bot.source.name}</span>
												<span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium {typeBadge(bot.source.type)}">{bot.source.type}</span>
												<span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] {bot.status === 'ACTIVE' ? 'bg-grn/10 text-grn' : 'bg-red/10 text-red'}">{bot.status === 'ACTIVE' ? 'Active' : 'Paused'}</span>
											</div>
											<div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
												<span class="{bot.stats.profitUsd >= 0 ? 'text-grn' : 'text-red'} font-bold">{formatUsd(bot.stats.profitUsd)}</span>
												<span class="text-g7"><span class="text-grn">{bot.stats.wins}W</span> / <span class="text-red">{bot.stats.losses}L</span></span>
												<span class="font-semibold {wr >= 50 ? 'text-grn' : wr > 0 ? 'text-yel' : 'text-g4'}">{wr.toFixed(0)}%</span>
												<span class="text-g7">{bot.stats.trades} trades</span>
												<span class="text-g6">Bought {formatUsd(bot.stats.boughtUsd)}</span>
												<span class="text-g6">Sold {formatUsd(bot.stats.soldUsd)}</span>
												<span class="text-g6">Fees {formatUsd(bot.stats.feesUsd)}</span>
											</div>
										</button>
										<div class="flex items-center gap-3 shrink-0 px-3 border-l border-bd">
											<button onclick={() => openEditBot(bot)} class="cursor-pointer rounded p-1.5 text-g3 transition-colors hover:text-tx" title="Edit">
												<Settings class="h-5 w-5" strokeWidth={1.5} />
											</button>
											<button
												class="relative h-5 w-9 cursor-pointer rounded-full transition-colors {togglingBotIds.has(bot.id) ? 'bg-bd2 opacity-50' : bot.status === 'ACTIVE' ? 'bg-grn' : 'bg-bd2'}"
												onclick={() => toggleBot(bot)}
												disabled={togglingBotIds.has(bot.id)}
											>
												{#if togglingBotIds.has(bot.id)}
													<div class="absolute top-0.5 left-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-g4 border-t-tx animate-spin"></div>
												{:else}
													<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {bot.status === 'ACTIVE' ? 'left-[18px]' : 'left-0.5'}"></div>
												{/if}
											</button>
											<button onclick={() => deleteBot(bot.id)} class="cursor-pointer rounded p-1.5 text-g3 transition-colors hover:text-red" title="Delete">
												<Trash2 class="h-5 w-5" strokeWidth={1.5} />
											</button>
											<button onclick={() => toggleBotExpand(bot.id)} class="cursor-pointer rounded p-1 text-g3 transition-colors hover:text-tx" title={expanded ? 'Collapse' : 'Expand'}>
												<ChevronDown class="h-5 w-5 transition-transform {expanded ? 'rotate-180' : ''}" strokeWidth={2} />
											</button>
										</div>
									</div>

										{#if expanded}
											{@const dt = botDetailTab.get(bot.id) ?? 'trades'}
											{@const trades = botTrades.get(bot.id)}
											{@const logs = botLogs.get(bot.id)}
											<div class="border-t border-bd">
												<BotConfigSummary {bot} />
												<div class="flex border-b border-s4">
												<button onclick={() => setBotDetailTab(bot.id, 'trades')} class="relative flex-1 cursor-pointer py-2 text-xs font-medium transition-colors {dt === 'trades' ? 'text-tx' : 'text-g5 hover:text-g9'}">
													Trades
													{#if dt === 'trades'}<span class="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-grn"></span>{/if}
												</button>
												<button onclick={() => setBotDetailTab(bot.id, 'logs')} class="relative flex-1 cursor-pointer py-2 text-xs font-medium transition-colors {dt === 'logs' ? 'text-tx' : 'text-g5 hover:text-g9'}">
													Logs
													{#if dt === 'logs'}<span class="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-grn"></span>{/if}
												</button>
											</div>

											{#if dt === 'trades'}
												{#if trades?.loading}
													<div class="p-4 space-y-2">{#each Array(3) as _}<div class="skeleton h-10 rounded-lg"></div>{/each}</div>
												{:else if trades && (trades.active.length > 0 || trades.completed.length > 0)}
													<div class="max-h-64 overflow-y-auto divide-y divide-s4">
														{#each [...trades.active, ...trades.completed] as trade}
															<a href="/?chain={trade.chain}&token={trade.tokenAddress}" class="flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-wh/5">
																<div class="flex items-center gap-2 min-w-0">
																	<img src={tokenImage(trade.chain, trade.tokenAddress)} alt="" class="h-5 w-5 rounded ring-1 ring-bd" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
																	<span class="font-semibold text-tx truncate">{trade.tokenSymbol}</span>
																	<ChainIcon chain={trade.chain} class="h-3 w-3 text-g4" />
																	<span class="rounded px-1 py-0.5 text-[9px] {'status' in trade && trade.status === 'ACTIVE' ? 'bg-grn/10 text-grn' : 'status' in trade && trade.status === 'PENDING' ? 'bg-yel/10 text-yel' : 'bg-g1 text-g7'}">{'status' in trade ? trade.status : ''}</span>
																</div>
																<div class="shrink-0 text-right">
																	<div class="{trade.pnl.usd >= 0 && trade.pnl.pct >= 0 ? 'text-grn' : 'text-red'} font-bold">{formatUsd(String(trade.pnl.usd))}</div>
																	<div class="{trade.pnl.pct >= 0 ? 'text-grn' : 'text-red'} text-[10px]">{Number(trade.pnl.pct).toFixed(1)}%</div>
																</div>
															</a>
														{/each}
													</div>
												{:else}
													<div class="p-6 text-center text-xs text-g5">No trades yet</div>
												{/if}
											{:else if dt === 'logs'}
												{#if logs?.loading}
													<div class="p-4 space-y-2">{#each Array(3) as _}<div class="skeleton h-8 rounded-lg"></div>{/each}</div>
												{:else if logs && logs.logs.length > 0}
													<div class="max-h-64 overflow-y-auto divide-y divide-s4">
														{#each logs.logs as log}
															<div class="px-4 py-2 text-[11px]">
																<div class="flex items-center gap-2">
																	<span class="rounded px-1 py-0.5 text-[9px] font-bold {log.status === 'SUCCESS' ? 'bg-grn/10 text-grn' : 'bg-red/10 text-red'}">{log.status}</span>
																	<span class="rounded bg-s7 px-1 py-0.5 text-[9px] text-g6">{log.category}</span>
																	{#if log.chain}
																		<ChainIcon chain={log.chain} class="h-3 w-3 text-g4" />
																	{/if}
																	<span class="ml-auto text-[10px] text-g4 cursor-help" title={fullDateTime((log.createdAt as any).createdAtTimestamp ?? log.createdAt.timestamp)}>{timeAgo((log.createdAt as any).createdAtTimestamp ?? log.createdAt.timestamp, getNow())}</span>
																</div>
																<div class="mt-0.5 text-g9 break-all">{log.message}</div>
															</div>
														{/each}
													</div>
												{:else}
													<div class="p-6 text-center text-xs text-g5">No logs</div>
												{/if}
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if bots.length === 0 && !loading}
						<div class="rounded-xl border border-bd bg-s1 p-12 text-center">
							<div class="mb-3 text-sm text-g5">No bots yet. Create one from a caller, TG channel, list, or wallet.</div>
							<button onclick={() => (showSourcePicker = true)} class="cursor-pointer rounded-lg bg-grn px-4 py-2 text-sm font-semibold text-s0 transition-all">+ Create Bot</button>
						</div>
					{/if}

				{:else if mainTab === 'errors'}
					<div class="flex flex-1 flex-col min-h-0">
						<div class="mb-4 flex items-center justify-between shrink-0">
							<h2 class="text-lg font-bold text-tx">Failed Trades</h2>
							<div class="flex items-center gap-2">
								{#if bots.length > 0}
									<select
										value={txErrorsBotFilter ?? ''}
										onchange={(e) => { txErrorsBotFilter = e.currentTarget.value || null; fetchTxErrors(); }}
										class="h-7 cursor-pointer rounded-lg border border-bd bg-s4 px-2 text-[11px] font-medium text-g9 outline-none"
									>
										<option value="">All Bots</option>
										{#each bots as bot}
											<option value={bot.id}>{bot.source.name}</option>
										{/each}
									</select>
								{/if}
								<button onclick={() => fetchTxErrors()} class="cursor-pointer rounded-lg border border-bd bg-s1 px-3 py-1 text-xs text-g7 transition-colors hover:text-tx">Refresh</button>
							</div>
						</div>

						{#if txErrorsLoading && txErrors.length === 0}
							<div class="space-y-2">{#each Array(5) as _, i}<div class="skeleton h-16 rounded-xl" style="animation-delay: {i * 60}ms"></div>{/each}</div>
						{:else if txErrors.length === 0}
							<div class="rounded-xl border border-bd bg-s1 p-12 text-center">
								<div class="mb-2 flex justify-center"><AlertTriangle class="h-8 w-8 text-g1" strokeWidth={1.5} /></div>
								<div class="text-sm text-g5">No failed trades found</div>
								<div class="mt-1 text-xs text-g3">Failed bot transactions will appear here</div>
							</div>
						{:else}
							<div class="flex-1 overflow-y-auto min-h-0 space-y-4">
								{#if txErrorsByBot.groups.length > 0}
									{#each txErrorsByBot.groups as group}
										<div class="rounded-xl border border-bd bg-s1">
											<div class="flex items-center gap-2 border-b border-bd px-4 py-3">
												<BotIcon class="h-4 w-4 text-g5" strokeWidth={1.5} />
												<span class="text-sm font-semibold text-tx">{group.botName}</span>
												{#if group.sourceType}
													<span class="rounded bg-s7 px-1.5 py-0.5 text-[10px] text-g6">{group.sourceType}</span>
												{/if}
												<span class="ml-auto rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-medium text-red">{group.errors.length} errors</span>
											</div>
											<div class="divide-y divide-s4">
												{#each group.errors as err}
													{@render errorRow(err)}
												{/each}
											</div>
										</div>
									{/each}
								{/if}
								{#if txErrorsByBot.ungrouped.length > 0}
									<div class="rounded-xl border border-bd bg-s1">
										<div class="flex items-center gap-2 border-b border-bd px-4 py-3">
											<span class="text-sm font-semibold text-tx">Other</span>
											<span class="ml-auto rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-medium text-red">{txErrorsByBot.ungrouped.length}</span>
										</div>
										<div class="divide-y divide-s4">
											{#each txErrorsByBot.ungrouped as err}
												{@render errorRow(err)}
											{/each}
										</div>
									</div>
								{/if}
								{#if txErrorsHasMore}
									<div class="flex justify-center py-3">
										<button
											onclick={() => { txErrorsPage++; fetchTxErrors(true); }}
											disabled={txErrorsLoading}
											class="cursor-pointer rounded-lg border border-bd bg-s1 px-4 py-2 text-xs text-g7 transition-colors hover:text-tx disabled:opacity-50"
										>
											{txErrorsLoading ? 'Loading...' : 'Load More'}
										</button>
									</div>
								{/if}
							</div>
						{/if}
					</div>

				{:else if mainTab === 'userlists'}
					<div class="mb-5 flex items-center justify-between">
						<h2 class="text-lg font-bold text-tx">User Lists</h2>
						<button onclick={openCreateList} class="cursor-pointer rounded-lg bg-grn px-4 py-1.5 text-xs font-semibold text-s0 transition-all">+ New List</button>
					</div>

					{#if userListsLoading}
						<div class="space-y-2">{#each Array(3) as _, i}<div class="skeleton h-20 rounded-xl" style="animation-delay: {i * 80}ms"></div>{/each}</div>
					{:else if userLists.length === 0}
						<div class="rounded-xl border border-bd bg-s1 p-12 text-center text-sm text-g5">No user lists. Create one to define custom token filters.</div>
					{:else}
						<div class="space-y-2">
							{#each userLists as list}
								{@const f = list.sourceDetails.tokenFilter}
								<div class="rounded-xl border border-bd bg-s1 p-4">
									<div class="flex items-center justify-between">
										<div>
											<div class="text-sm font-semibold text-tx">{list.name}</div>
											<div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
												{#if f.scope?.chain?.length}
													<span class="inline-flex items-center gap-1">{#each f.scope.chain as ch}<ChainIcon chain={ch} class="h-3 w-3 text-g6" />{/each}</span>
												{/if}
												{#if f.market?.marketCapUsd}
													<span class="text-g5">MCap: {f.market.marketCapUsd.min ?? '0'}-{f.market.marketCapUsd.max ?? '∞'}</span>
												{/if}
												{#if f.market?.liquidityUsd}
													<span class="text-g5">Liq: {f.market.liquidityUsd.min ?? '0'}-{f.market.liquidityUsd.max ?? '∞'}</span>
												{/if}
												{#if f.socials?.dexScreenerPaid}
													<span class="rounded bg-grn/10 px-1.5 py-0.5 text-grn">DEX Paid</span>
												{/if}
												{#if f.security?.renounced}
													<span class="rounded bg-grn/10 px-1.5 py-0.5 text-grn">Renounced</span>
												{/if}
												{#if f.security?.lpLocked}
													<span class="rounded bg-grn/10 px-1.5 py-0.5 text-grn">LP Locked</span>
												{/if}
												{#if f.sources?.callers?.length}
													<span class="text-g5">{f.sources.callers.length} callers</span>
												{/if}
												{#if f.sources?.tgConnections?.length}
													<span class="text-g5">{f.sources.tgConnections.length} TG</span>
												{/if}
												{#if f.sources?.wallets?.length}
													<span class="text-g5">{f.sources.wallets.length} wallets</span>
												{/if}
											</div>
										</div>
										<div class="flex items-center gap-2">
											<button onclick={() => openEditList(list)} class="cursor-pointer rounded-lg border border-bd px-3 py-1 text-xs text-g7 transition-colors hover:text-tx">Edit</button>
											<button onclick={() => deleteUserList(list.id)} class="cursor-pointer rounded-lg border border-red/20 px-3 py-1 text-xs text-red transition-colors hover:bg-red/10">Delete</button>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<CreateBotModal bind:show={showCreateBot} source={abSelectedSource} editBot={abEditBot} defaultChain={abDefaultChain} oncreated={fetchBots} onupdated={fetchBots} />

		<SourcePicker
			bind:show={showSourcePicker}
			mode="single"
			tabs={['callers', 'tg', 'wallets', 'lists']}
			title="Select Source for Bot"
			onselect={handleSourceSelected}
		/>

		<UserListModal bind:show={showUserListForm} editList={listModalEditList} onsaved={fetchUserLists} />

</div>

{#snippet errorRow(err: TransactionErrorResponse)}
	<div class="px-4 py-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 min-w-0">
				<span class="rounded px-1.5 py-0.5 text-[10px] font-bold {err.side === 'BUY' ? 'bg-grn/10 text-grn' : 'bg-red/10 text-red'}">{err.side}</span>
				<span class="text-sm font-medium text-tx truncate">{err.tokenSymbol ?? shortAddress(err.tokenAddress)}</span>
				{#if err.tokenName}
					<span class="text-xs text-g5 truncate hidden md:inline">{err.tokenName}</span>
				{/if}
				<ChainIcon chain={err.chain} class="h-3 w-3 text-g6" />
			</div>
			<span class="text-[11px] text-g4 shrink-0 cursor-help" title={fullDateTime(err.createdAt)}>{timeAgo(err.createdAt, getNow())}</span>
		</div>
		<div class="mt-1.5 rounded-md bg-s4 px-2.5 py-1.5 text-xs text-red/80 font-mono break-all">{err.error}</div>
		{#if err.transactionHash}
			<div class="mt-1 text-[11px] text-g4">TX: <span class="text-g6">{shortAddress(err.transactionHash)}</span></div>
		{/if}
	</div>
{/snippet}

{#snippet lbColumn(entries: WatchlistRankItem[], isLoading: boolean, hasMore: boolean)}
	{#if isLoading && entries.length === 0}
		<div class="space-y-2">{#each Array(6) as _, i}<div class="skeleton h-16 rounded-xl" style="animation-delay: {i * 60}ms"></div>{/each}</div>
	{:else if entries.length === 0}
		<div class="rounded-xl border border-bd bg-s1 p-12 text-center text-sm text-g5">No callers found</div>
	{:else}
		<div class="space-y-2">
			{#each entries as entry, i}
				{@const entryPhotoId = 'photoId' in entry.source ? entry.source.photoId : undefined}
				{@const walletAddr = getWalletAddress(entry.source as Record<string, unknown>)}
				<div class="group rounded-xl border border-bd bg-s1 p-3 md:p-4 transition-colors hover:border-bd3">
					<div class="flex items-start gap-2.5">
						<div class="relative shrink-0">
							{#if avatarUrl(entryPhotoId)}
								<img src={avatarUrl(entryPhotoId)} alt="" class="h-7 w-7 md:h-8 md:w-8 rounded-full object-cover" />
							{:else if walletAddr}
								<img src={getWalletIconUrl(walletAddr)} alt="" class="h-7 w-7 md:h-8 md:w-8 rounded-full" />
							{:else}
								<div class="flex h-7 w-7 md:h-8 md:w-8 items-center justify-center rounded-full bg-s7 text-xs font-bold text-g5">{getRankItemName(entry)[0]?.toUpperCase() ?? '?'}</div>
							{/if}
							<div class="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-s5 text-[9px] font-bold text-g7 ring-1 ring-bd">{i + 1}</div>
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-1.5 md:gap-2 flex-wrap">
								<button
									class="cursor-pointer text-[13px] font-semibold text-tx truncate hover:underline"
									onclick={(e) => { e.stopPropagation(); selectWatchlistCaller(entry.source.id, entry.source.type); setWatchlistOpen(true); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('watchlist-open-caller')); }}
								>{getRankItemName(entry)}</button>
								<span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium {sourceBadge(getRankItemType(entry))}">{getRankItemType(entry)}</span>
								{#if entry.performanceScore > 0}
									<StarRating score={entry.performanceScore} size={12} />
								{/if}
								<span class="{entry.winRatePct >= 50 ? 'text-grn' : entry.winRatePct > 0 ? 'text-yel' : 'text-red'} text-xs font-bold">{entry.winRatePct.toFixed(0)}%</span>
							</div>
							<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
								<span class="text-g6">{entry.totalCalls} calls</span>
								<span class="text-g4">·</span>
								<span class="text-g6">{entry.wins}W/{entry.losses}L</span>
								<span class="text-g4">·</span>
								<span class="text-g7">Avg <span class="text-tx font-medium">{entry.averageMultiplier.toFixed(1)}x</span></span>
								<span class="text-g4">·</span>
								<span class="text-g7">Best <span class="text-grn font-medium">{entry.highestMultiplier.toFixed(1)}x</span></span>
							</div>
							{#if entry.topCalls.length > 0}
								<div class="mt-1.5 flex flex-wrap gap-1">
									{#each entry.topCalls.slice(0, 5) as call}
										<a href="/?chain={call.token.chain}&token={call.token.address}" class="rounded bg-s7 px-1.5 py-0.5 text-[10px] text-g7 transition-colors hover:text-tx">
											{call.token.symbol} <span class="{call.multiplier >= 1 ? 'text-grn' : 'text-red'}">{call.multiplier.toFixed(1)}x</span>
										</a>
									{/each}
								{#if entry.topCalls.length > 5}
									<span class="rounded bg-s4 px-1.5 py-0.5 text-[10px] text-g4">+{entry.topCalls.length - 5}</span>
									{/if}
								</div>
							{/if}
							{#if entry.multiplierBuckets.length > 0}
								{@const sorted = [...entry.multiplierBuckets].map(b => parseTier(b.tier) < 0 && b.count === 0 ? { ...b, count: entry.losses } : b).sort((a, b) => parseTier(b.tier) - parseTier(a.tier))}
								{@const maxCount = Math.max(...sorted.map(b => b.count))}
								<div class="mt-2 hidden md:flex gap-1">
									{#each sorted as bucket}
										{@const isLoss = parseTier(bucket.tier) < 0}
										{@const pct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0}
										{@const opacity = 0.4 + (maxCount > 0 ? bucket.count / maxCount : 0) * 0.6}
										<div class="flex flex-1 flex-col items-center gap-0.5">
											<span class="text-[9px] font-bold {isLoss ? 'text-red' : 'text-grn'}" style="opacity: {opacity}">{bucket.count}</span>
											<div class="w-full rounded-sm bg-s7" style="height: 18px; position: relative;">
												<div class="absolute bottom-0 w-full rounded-sm {isLoss ? 'bg-red' : 'bg-grn'} transition-all" style="height: {Math.max(pct, 8)}%; opacity: {opacity};"></div>
											</div>
											<span class="text-[9px] font-medium text-g6">{bucket.tier}</span>
										</div>
									{/each}
								</div>
								<div class="mt-1.5 flex md:hidden flex-wrap gap-1">
									{#each sorted.filter(b => b.count > 0) as bucket}
										{@const isLoss = parseTier(bucket.tier) < 0}
										<span class="rounded {isLoss ? 'bg-red/10 text-red' : 'bg-grn/10 text-grn'} px-1.5 py-0.5 text-[10px] font-medium">{bucket.tier}: {bucket.count}</span>
									{/each}
								</div>
							{/if}
						</div>
						{#if getIsLoggedIn()}
							<button
								onclick={() => selectRankItem(entry)}
								class="shrink-0 cursor-pointer rounded-lg bg-grn/10 px-2.5 py-1.5 text-[11px] font-medium text-grn ring-1 ring-grn/20 transition-all md:opacity-0 md:group-hover:opacity-100 hover:bg-grn/20 active:scale-95"
							>
								+ Bot
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		{#if isLoading || hasMore}
			<div class="h-14 flex items-center justify-center gap-2">
				{#if isLoading}
					<div class="h-4 w-4 rounded-full border-2 border-g1 border-t-grn animate-spin"></div>
					<span class="text-xs text-g6">Loading more...</span>
				{:else}
					<span class="text-xs text-g3">Scroll for more</span>
				{/if}
			</div>
		{/if}
	{/if}
{/snippet}
