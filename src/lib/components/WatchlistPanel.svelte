<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy, untrack } from 'svelte';
	import ChainIcon from './ChainIcon.svelte';
	import CurrencyValue from './CurrencyValue.svelte';
	import { api } from '$lib/api/client';
	import { portal } from '$lib/actions/portal';
	import type { WatchlistCallItem, WatchlistFeedResponse, TgManagedChat, TgSenderEntry, TgTopicEntry, ErrorResponse, WatchlistSourceItem, TokenFilter, TokenMarketFilter, TokenSecurityFilter, TokenSocialFilter, TokenSourceFilter, TokenTaxFilter, Chain, WalletSourceIdentity, TokenActivityFilter, TokenActivityWindowFilter, TokenHolderFilter, ScannerGraduation, WatchlistRankItem } from '$lib/api/types';
	import type { PlatformType } from '$lib/api/types';
	import { getIsLoggedIn, getAuthToken, connectWallet } from '$lib/stores/auth.svelte';
	import { isCursorRecoveryReason, subscribe, unsubscribe, authenticate, type WsErrorInfo } from '$lib/ws/client';
	import { formatMultiplier, formatUsd, formatPriceText, formatCompactNumber, formatMarketCap, timeAgo, fullDateTime, shortAddress, explorerAddressUrl, fmtVal, parseTier, avatarUrl } from '$lib/utils/format';
	import { getWalletIconUrl, getWalletAddress } from '$lib/utils/walleticon';
	import { getRouterInfo } from '$lib/utils/routers';
	import { getNow } from '$lib/stores/tick.svelte';
	import { getBubbleWatchlist } from '$lib/stores/feSettings.svelte';
	import { clearPendingWatchlistCaller, getPendingWatchlistCaller } from '$lib/stores/watchlist.svelte';
	import { liveAccumulatedParams, type CursorTriplet } from '$lib/utils/livecursor';
	import Lock from 'lucide-svelte/icons/lock';
	import Bell from 'lucide-svelte/icons/bell';
	import Plus from 'lucide-svelte/icons/plus';
	import Settings from 'lucide-svelte/icons/settings';
	import X from 'lucide-svelte/icons/x';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Check from 'lucide-svelte/icons/check';
	import Filter from 'lucide-svelte/icons/funnel';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import List from 'lucide-svelte/icons/list';
	import Wallet from 'lucide-svelte/icons/wallet';
	import Copy from 'lucide-svelte/icons/copy';
	import BotIcon from 'lucide-svelte/icons/bot';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Clock from 'lucide-svelte/icons/clock';
	import Hash from 'lucide-svelte/icons/hash';
	import LayoutGrid from 'lucide-svelte/icons/layout-grid';
	import StarRating from './StarRating.svelte';
	import TgLoginForm from './TgLoginForm.svelte';
	import type { CallerSource } from '$lib/api/types';
	import type { operations } from '$lib/api/v2.d.ts';
	import type { BotSourceDescriptor } from '$lib/utils/bot-settings';

	let UserListModal = $state<any>(null);
	let CreateBotModal = $state<any>(null);

	async function ensureUserListModal() {
		if (!UserListModal) UserListModal = (await import('./UserListModal.svelte')).default;
	}
	async function ensureCreateBotModal() {
		if (!CreateBotModal) CreateBotModal = (await import('./CreateBotModal.svelte')).default;
	}

	type WatchlistTab = 'Callers' | 'Telegram' | 'Lists' | 'Wallets';
	type WatchlistFeedQuery = NonNullable<operations['get_callers_feed']['parameters']['query']>;

	const tabs: WatchlistTab[] = ['Callers', 'Telegram', 'Lists', 'Wallets'];

	const watchlistPathMap: Record<WatchlistTab, '/v2/watchlist/feed/callers' | '/v2/watchlist/feed/tg' | '/v2/watchlist/feed/lists' | '/v2/watchlist/feed/wallets'> = {
		Callers: '/v2/watchlist/feed/callers',
		Telegram: '/v2/watchlist/feed/tg',
		'Lists': '/v2/watchlist/feed/lists',
		'Wallets': '/v2/watchlist/feed/wallets'
	};

	const callTopicMap: Record<WatchlistTab, string> = {
		Callers: 'watchlist:callers',
		Telegram: 'watchlist:tg',
		'Lists': 'watchlist:lists',
		'Wallets': 'watchlist:wallets'
	};

	let { selectedAddress = '', onnavigate = () => {}, active = true }: { selectedAddress?: string; onnavigate?: () => void; active?: boolean } = $props();

	let activeTab: WatchlistTab = $state('Callers');
	let calls: WatchlistCallItem[] = $state([]);
	let loading: boolean = $state(false);
	let hasMore: boolean = $state(false);
	let callsPagination = $state<CursorTriplet>({});
	let loadingMore: boolean = $state(false);

	let callsScrollEl: HTMLElement | undefined = $state(undefined);
	let callWsKey: string | null = null;
	let flashMap = $state<Map<string, 'up' | 'down'>>(new Map());

	let tgLoggedIn = $state<boolean | null>(null);
	let tgLoading = $state(false);

	let tgChats = $state<TgManagedChat[]>([]);
	let tgChatsLoading = $state(false);
	let tgSyncing = $state(false);
	let tgChecked = $state(false);

	let showTgLoginModal = $state(false);
	let showChannelModal = $state(false);
	let showEditModal = $state(false);
	let tgChatSearch = $state('');

	let editChat = $state<TgManagedChat | null>(null);
	let editSenders = $state<TgSenderEntry[]>([]);
	let editTopics = $state<TgTopicEntry[]>([]);
	let editLoadingSenders = $state(false);
	let editLoadingTopics = $state(false);
	let editFilterAdmin = $state(true);
	let editFilterBot = $state(true);
	let editFilterForwarded = $state(true);
	let editFilterPinned = $state(true);
	let editFilterReply = $state(true);
	let editFilterUsers = $state(true);
	let editSelectedSenders = $state<TgSenderEntry[]>([]);
	let editSelectedTopics = $state<TgTopicEntry[]>([]);
	let editSaving = $state(false);

	let selectedChannelIds = $state<Set<string>>(new Set());

	let tgSources = $state<WatchlistSourceItem[]>([]);
	let tgSourcesFetched = $state(false);

	type ListSource = WatchlistSourceItem & { type: 'LIST' };
	let userLists = $state<ListSource[]>([]);
	let userListsLoading = $state(false);
	let userListsFetched = $state(false);
	let showListModal = $state(false);
	let listModalEditList = $state<ListSource | null>(null);
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
	let ulFreezeDisabled = $state<boolean | null>(null);
	let ulMintDisabled = $state<boolean | null>(null);
	let ulNotHoneypot = $state<boolean | null>(null);
	let ulIsVerified = $state<boolean | null>(null);
	let ulHasWebsite = $state<boolean | null>(null);
	let ulHasTwitter = $state<boolean | null>(null);
	let ulHasTelegram = $state<boolean | null>(null);
	let ulHasDiscord = $state<boolean | null>(null);
	let ulWithAnySocial = $state<boolean | null>(null);
	let ulMaxBuyTax = $state('');
	let ulMaxSellTax = $state('');
	let ulMaxTransferTax = $state('');
	let ulSelectedCallers = $state<string[]>([]);
	let ulSelectedTgConns = $state<string[]>([]);
	let ulSelectedWallets = $state<string[]>([]);
	let ulSaving = $state(false);

	let ulPlatforms = $state<PlatformType[]>([]);
	let ulGraduation = $state<ScannerGraduation | ''>('');
	let ulLpBurned = $state<boolean | null>(null);
	let ulProxy = $state<boolean | null>(null);
	let ulCallCountMin = $state('');
	let ulCallCountMax = $state('');
	let ulHolderCountMin = $state('');
	let ulHolderCountMax = $state('');
	let ulTop10PctMax = $state('');
	let ulDevPctMax = $state('');
	let ulInsiderPctMax = $state('');
	let ulSniperPctMax = $state('');
	let ulBundlerPctMax = $state('');
	let ulActivityTimeframe = $state<'fiveMin' | 'oneHour' | 'sixHours' | 'twentyFourHours'>('fiveMin');
	let ulVolMin = $state('');
	let ulVolMax = $state('');
	let ulTxnsMin = $state('');
	let ulTxnsMax = $state('');
	let ulBuysMin = $state('');
	let ulSellsMin = $state('');
	let ulPriceChangeMin = $state('');
	let ulPriceChangeMax = $state('');

	const platformOptions: PlatformType[] = ['RAYDIUM', 'RAYDIUM_CP', 'RAYDIUM_CLMM', 'RAYDIUM_LAUNCH', 'PUMPFUN', 'PUMPSWAP', 'METEORA_DYN', 'METEORA_DLMM', 'METEORA_BONDING_CURVE', 'METEORA_DYN_V2', 'UNISWAP_V2', 'UNISWAP_V3', 'AERODROME_V2', 'HEAVEN', 'FOURMEME_V2', 'LETS_BONK', 'BELIEVE', 'BAGS', 'PRINTR', 'MOONSHOT'];
	const activityTimeframes = [
		{ key: 'fiveMin' as const, label: '5m' },
		{ key: 'oneHour' as const, label: '1h' },
		{ key: 'sixHours' as const, label: '6h' },
		{ key: 'twentyFourHours' as const, label: '24h' },
	];

	let srcPickerOpen = $state<'callers' | 'telegram' | 'wallets' | null>(null);
	let srcCallerItems = $state<WatchlistSourceItem[]>([]);
	let srcTgItems = $state<WatchlistSourceItem[]>([]);
	let srcWalletItems = $state<WatchlistSourceItem[]>([]);
	let srcLoading = $state(false);
	let srcFetched = $state(false);
	let srcSearch = $state('');
	let srcCallerCursor = $state<string | undefined>(undefined);
	let srcCallerHasMore = $state(false);
	let srcCallerLoadingMore = $state(false);

	let selectedListIds = $state<Set<string>>(new Set());
	const chains: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];

	let callerSources = $state<WatchlistSourceItem[]>([]);
	let callerSourcesLoading = $state(false);
	let callerSourcesFetched = $state(false);
	let callerSourcesCursor = $state<string | undefined>(undefined);
	let callerSourcesHasMore = $state(false);
	let callerSourcesLoadingMore = $state(false);
	let selectedCallerId = $state<string | null>(null);

	let showFeedFilter = $state(false);
	let feedMinMcap = $state('');
	let feedMaxMcap = $state('');
	let feedMinMultiplier = $state('');
	let feedMaxMultiplier = $state('');
	let feedMinPrice = $state('');
	let feedMaxPrice = $state('');
	let feedChains = $state<Chain[]>([]);
	let feedSwapType = $state<'BUY' | 'SELL' | null>(null);
	let feedSourceId = $state<string | null>(null);
	let feedSourceSearch = $state('');
	let feedSourceItems = $state<WatchlistSourceItem[]>([]);
	let feedSourceCursor = $state<string | undefined>(undefined);
	let feedSourceHasMore = $state(false);
	let feedSourceLoading = $state(false);
	let feedSourceLoadingMore = $state(false);
	let feedSourceRequestId = 0;
	let feedSourceSearchTimer: ReturnType<typeof setTimeout> | undefined;

	let feedFilterCount = $derived.by(() => {
		let c = 0;
		if (feedMinMcap) c++;
		if (feedMaxMcap) c++;
		if (feedMinMultiplier) c++;
		if (feedMaxMultiplier) c++;
		if (feedMinPrice) c++;
		if (feedMaxPrice) c++;
		if (feedChains.length > 0) c++;
		if (activeTab === 'Wallets' && feedSwapType) c++;
		if (feedSourceId) c++;
		if (selectedCallerId) c++;
		if (selectedChannelIds.size > 0) c++;
		if (selectedListIds.size > 0) c++;
		if (selectedWalletIds.size > 0) c++;
		return c;
	});

	function getFeedSourceItems(): { id: string; name: string }[] {
		return feedSourceItems.map(s => ({ id: getSourceId(s), name: getSourceName(s) }));
	}

	const feedSourcePathMap: Record<WatchlistTab, '/v2/watchlist/sources/callers' | '/v2/watchlist/sources/tg' | '/v2/watchlist/sources/lists' | '/v2/watchlist/sources/wallets'> = {
		Callers: '/v2/watchlist/sources/callers',
		Telegram: '/v2/watchlist/sources/tg',
		Lists: '/v2/watchlist/sources/lists',
		Wallets: '/v2/watchlist/sources/wallets'
	};

	async function fetchFeedSources(search = feedSourceSearch, reset = true) {
		const normalizedSearch = search.trim();
		if (!reset && (feedSourceLoadingMore || !feedSourceCursor)) return;
		const requestId = ++feedSourceRequestId;
		if (reset) {
			feedSourceItems = [];
			feedSourceCursor = undefined;
			feedSourceHasMore = false;
			feedSourceLoading = true;
		} else {
			feedSourceLoadingMore = true;
		}

		try {
			const query: Record<string, string> = {};
			if (normalizedSearch) query.search = normalizedSearch;
			if (!reset && feedSourceCursor) query.cursor = feedSourceCursor;
			const { data } = await api.GET(feedSourcePathMap[activeTab], {
				params: { query: query as never }
			});
			if (requestId !== feedSourceRequestId) return;
			feedSourceItems = reset ? (data?.sources ?? []) : [...feedSourceItems, ...(data?.sources ?? [])];
			feedSourceCursor = data?.nextCursor;
			feedSourceHasMore = !!data?.nextCursor;
		} catch {
			if (requestId === feedSourceRequestId && reset) {
				feedSourceItems = [];
				feedSourceCursor = undefined;
				feedSourceHasMore = false;
			}
		} finally {
			if (requestId === feedSourceRequestId) {
				feedSourceLoading = false;
				feedSourceLoadingMore = false;
			}
		}
	}

	function handleFeedSourceSearch(event: Event) {
		feedSourceSearch = (event.currentTarget as HTMLInputElement).value;
		if (feedSourceSearchTimer) clearTimeout(feedSourceSearchTimer);
		feedSourceSearchTimer = setTimeout(() => {
			fetchFeedSources(feedSourceSearch, true);
			feedSourceSearchTimer = undefined;
		}, 250);
	}

	function selectTab(tab: WatchlistTab) {
		if (activeTab === tab) return;
		clearFeedFilters();
		activeTab = tab;
		feedSourceRequestId++;
		feedSourceItems = [];
		feedSourceCursor = undefined;
		feedSourceHasMore = false;
		fetchCalls();
	}

	function getFeedSourceFamily(): string {
		switch (activeTab) {
			case 'Callers': return 'callers';
			case 'Telegram': return 'tg';
			case 'Lists': return 'lists';
			case 'Wallets': return 'wallets';
			default: return 'callers';
		}
	}

	type WalletSource = WalletSourceIdentity;
	let ctWallets = $state<WalletSource[]>([]);
	let ctWalletsLoading = $state(false);
	let ctWalletsFetched = $state(false);
	let showCtWalletModal = $state(false);
	let showCtAddModal = $state(false);
	let ctName = $state('');
	let ctChain = $state<Chain | ''>('');
	let ctAddress = $state('');
	let ctSaving = $state(false);
	let ctError = $state('');
	let selectedWalletIds = $state<Set<string>>(new Set());

	import type { Bot } from '$lib/api/types';

	let sourceRanking = $state<WatchlistRankItem | null>(null);
	let sourceRankingLoading = $state(false);
	let rankingCollapsed = $state(false);
	const RANK_TIMEFRAMES = ['1d', '3d', '7d', '30d'] as const;
	let rankTimeframe = $state<typeof RANK_TIMEFRAMES[number]>('30d');

	function cycleRankTimeframe() {
		const idx = RANK_TIMEFRAMES.indexOf(rankTimeframe);
		rankTimeframe = RANK_TIMEFRAMES[(idx + 1) % RANK_TIMEFRAMES.length];
		fetchSourceRanking();
	}

	async function fetchSourceRanking() {
		const sel = getSelectedSourceId();
		if (!sel) {
			sourceRanking = null;
			return;
		}
		sourceRankingLoading = true;
		try {
			const { data } = await api.GET('/v2/watchlist/ranking/{source}/{id}', {
				params: { path: { source: sel.source, id: sel.id }, query: { timeframe: rankTimeframe } }
			} as never);
			const items = (data as any)?.items ?? [];
			sourceRanking = items[0] ?? null;
		} catch {
			sourceRanking = null;
		} finally {
			sourceRankingLoading = false;
		}
	}

	let showCreateBot = $state(false);
	let botSource = $state<BotSourceDescriptor | null>(null);
	let editingBot = $state<Bot | null>(null);
	let botsBySourceId = $state<Map<string, Bot>>(new Map());
	let botsFetched = $state(false);

	async function fetchBots() {
		if (botsFetched) return;
		botsFetched = true;
		try {
			// Walk all pages (default limit is 20) so every source's bot indicator shows.
			const map = new Map<string, Bot>();
			let cursor: string | undefined;
			const seen = new Set<string>();
			do {
				const { data } = await api.GET('/v2/bots', { params: { query: cursor ? { limit: 100, cursor } : { limit: 100 } } });
				for (const bot of data?.bots ?? []) map.set(bot.source.id, bot);
				const next = data?.nextCursor ?? undefined;
				if (!next || seen.has(next)) break;
				seen.add(next);
				cursor = next;
			} while (cursor);
			botsBySourceId = map;
		} catch {}
	}

	function hasBot(call: WatchlistCallItem): boolean {
		const m = call.caller;
		const id = 'id' in m ? String(m.id) : '';
		return id ? botsBySourceId.has(id) : false;
	}

	function getBotForCall(call: WatchlistCallItem): Bot | undefined {
		const m = call.caller;
		const id = 'id' in m ? String(m.id) : '';
		return id ? botsBySourceId.get(id) : undefined;
	}

	function openBotForCall(call: WatchlistCallItem) {
		const m = call.caller;
		const name = 'name' in m && m.name ? String(m.name) : 'id' in m ? String(m.id) : 'Unknown';
		const type: CallerSource = m.type;
		const id = 'id' in m ? String(m.id) : '';
		editingBot = getBotForCall(call) ?? null;
		botSource = { id, type, name, ...(m.type === 'WALLET' ? { chain: m.chain } : {}) };
		void ensureCreateBotModal().then(() => { showCreateBot = true; });
	}

	let enabledChats = $derived(tgChats.filter(c => c.isEnabled));
	let filteredCalls = $derived.by(() => {
		if (activeTab !== 'Telegram' || selectedChannelIds.size === 0) return calls;
		return calls;
	});

	let bubbleDrillToken = $state<string | null>(null);
	let bubbleSort = $state<'count' | 'recent'>('count');
	let bubbleViewActive = $state(true);
	const showBubbles = $derived(getBubbleWatchlist() && bubbleViewActive && !bubbleDrillToken);

	type CallBubble = {
		key: string;
		chain: string;
		address: string;
		symbol: string;
		image: string;
		count: number;
		avgMultiplier: number;
		maxMultiplier: number;
		lastCalledAt: number;
		mcapStr: string;
		isNew: boolean;
		arrivedAt: number;
	};

	let callBubbles = $derived.by<CallBubble[]>(() => {
		const groups = new Map<string, { calls: WatchlistCallItem[]; d: WatchlistCallItem['callDetails'] }>();
		for (const call of filteredCalls) {
			const d = call.callDetails;
			const key = `${d.baseTokenChain}:${d.baseTokenAddress}`;
			const g = groups.get(key);
			if (g) g.calls.push(call);
			else groups.set(key, { calls: [call], d });
		}
		const out: CallBubble[] = [];
		for (const [key, g] of groups) {
			const mults = g.calls.map(c => c.callDetails.athMultiplier).filter((v): v is number => typeof v === 'number' && isFinite(v));
			const avg = mults.length ? mults.reduce((a, b) => a + b, 0) / mults.length : 0;
			const max = mults.length ? Math.max(...mults) : 0;
			const last = Math.max(...g.calls.map(c => c.callDetails.calledAtTimestamp ?? 0));
			const latestCall = g.calls.reduce((a, b) => ((b.callDetails.calledAtTimestamp ?? 0) >= (a.callDetails.calledAtTimestamp ?? 0) ? b : a), g.calls[0]);
			const arrivedAt = arrivedTokens.get(key) ?? 0;
			out.push({
				key,
				chain: g.d.baseTokenChain,
				address: g.d.baseTokenAddress,
				symbol: g.d.baseTokenSymbol ?? '?',
				image: tokenImage(g.d.baseTokenChain, g.d.baseTokenAddress),
				count: g.calls.length,
				avgMultiplier: avg,
				maxMultiplier: max,
				lastCalledAt: last,
				mcapStr: latestCall?.callDetails.marketCapUsdStr ?? '',
				isNew: arrivedAt > 0,
				arrivedAt
			});
		}
		out.sort((a, b) => {
			if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
			if (a.isNew && b.isNew) return b.arrivedAt - a.arrivedAt;
			return bubbleSort === 'recent'
				? b.lastCalledAt - a.lastCalledAt || b.count - a.count
				: b.count - a.count || b.lastCalledAt - a.lastCalledAt;
		});
		return out;
	});

	let maxBubbleCount = $derived(Math.max(1, ...callBubbles.map(b => b.count)));

	function bubbleSize(count: number): number {
		const t = Math.sqrt(count / maxBubbleCount);
		return Math.round(44 + t * 64);
	}

	const drilledCalls = $derived.by(() => {
		if (!bubbleDrillToken) return [];
		return filteredCalls.filter(c => `${c.callDetails.baseTokenChain}:${c.callDetails.baseTokenAddress}` === bubbleDrillToken);
	});

	$effect(() => {
		void activeTab;
		void feedSourceId;
		bubbleDrillToken = null;
	});

	function triggerFlash(key: string, direction: 'up' | 'down') {
		flashMap = new Map(flashMap).set(key, direction);
		setTimeout(() => {
			flashMap = new Map(flashMap);
			flashMap.delete(key);
		}, 800);
	}

	function cleanupCallWs() {
		if (callWsKey) {
			unsubscribe(callWsKey);
			callWsKey = null;
		}
	}

	function cleanupAll() {
		cleanupCallWs();
	}

	function callFlashKey(call: WatchlistCallItem): string {
		return call.callDetails.pairAddress || String(call.id);
	}

	function applyWatchlistSnapshot(feed: WatchlistFeedResponse, _meta?: any) {
		const previous = new Map(calls.map((call) => [call.id, call]));
		const hadCalls = calls.length > 0;
		const affected = new Map<string, 'up' | 'down'>();
		const next = feed.items ?? [];
		for (const call of next) {
			const old = previous.get(call.id);
			if (!old) {
				if (hadCalls) markCallArrived(call);
				continue;
			}
			const oldMcap = old.callDetails.marketCapUsd;
			const newMcap = call.callDetails.marketCapUsd;
			if (oldMcap > 0 && newMcap > 0 && formatUsd(oldMcap) !== formatUsd(newMcap)) {
				affected.set(callFlashKey(call), newMcap > oldMcap ? 'up' : 'down');
			}
		}
		calls = next;
		if (typeof feed.cursor === 'string') {
			rememberCallsPage(feed);
		}
		for (const [key, direction] of affected) {
			triggerFlash(key, direction);
		}
	}

	let arrivedTokens = $state<Map<string, number>>(new Map());
	const arrivedTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const ARRIVE_MS = 4000;

	function markCallArrived(call: WatchlistCallItem) {
		const key = `${call.callDetails.baseTokenChain}:${call.callDetails.baseTokenAddress}`;
		const m = new Map(arrivedTokens);
		m.set(key, Date.now());
		arrivedTokens = m;
		const existing = arrivedTimers.get(key);
		if (existing) clearTimeout(existing);
		arrivedTimers.set(key, setTimeout(() => {
			const next = new Map(arrivedTokens);
			next.delete(key);
			arrivedTokens = next;
			arrivedTimers.delete(key);
		}, ARRIVE_MS));
	}

	function getWatchlistTopic(tab: WatchlistTab): string {
		const selected = getSelectedSourceId();
		if (selected) return `watchlist:${selected.source}:${selected.id}`;
		return callTopicMap[tab];
	}

	function buildFeedWsParams(): Record<string, unknown> | undefined {
		const liveParams = liveAccumulatedParams(callsTriplet());
		if (!liveParams) return undefined;
		const params: Record<string, unknown> = feedFilterCount > 0 ? { ...buildFeedQuery() } : {};
		Object.assign(params, liveParams);
		return Object.keys(params).length > 0 ? params : undefined;
	}

	function handleCallWsError(error: WsErrorInfo) {
		if (isCursorRecoveryReason(error.reason)) {
			fetchCalls({ soft: true });
		} else if (error.reason === 'PARAMS_INVALID' || error.reason === 'TOPIC_INVALID') {
			console.error('[WS] watchlist subscription rejected:', error);
		}
	}

	function setupCallWs(tab: WatchlistTab) {
		cleanupCallWs();
		if (!active) return;
		if (requiresAuth(tab) && !getIsLoggedIn()) return;
		const topic = getWatchlistTopic(tab);
		const params = buildFeedWsParams();
		if (!params) return;
		callWsKey = subscribe(topic, (event, data) => {
			if (event !== 'WATCHLIST_FEED' || !data) return;
			applyWatchlistSnapshot(data as WatchlistFeedResponse);
		}, params as Record<string, any> | undefined, {
			onError: handleCallWsError,
			recovery: 'refetch',
			onReconnect: () => { void fetchCalls({ soft: true }); }
		});
	}

	const sourceTypeToTab: Record<string, WatchlistTab> = {
		CALLER: 'Callers',
		TG: 'Telegram',
		LIST: 'Lists',
		WALLET: 'Wallets'
	};

	function applyCallerSelection(id: string, sourceType: string) {
		const tab = sourceTypeToTab[sourceType] ?? 'Callers';
		activeTab = tab;
		selectedCallerId = tab === 'Callers' ? id : null;
		selectedChannelIds = tab === 'Telegram' ? new Set([id]) : new Set();
		selectedListIds = tab === 'Lists' ? new Set([id]) : new Set();
		selectedWalletIds = tab === 'Wallets' ? new Set([id]) : new Set();
		feedSourceId = null;
		fetchCalls();
		fetchSourceRanking();
	}

	function openCallerView(call: WatchlistCallItem) {
		const m = call.caller;
		const id = 'id' in m ? String(m.id) : '';
		if (!id) return;
		applyCallerSelection(id, m.type);
	}



	function requiresAuth(tab: WatchlistTab): boolean {
		return tab !== 'Callers';
	}

	function getSelectedSourceId(): { source: string; id: string } | null {
		if (activeTab === 'Callers' && selectedCallerId) return { source: 'callers', id: selectedCallerId };
		if (activeTab === 'Telegram' && selectedChannelIds.size === 1) {
			return { source: 'tg', id: [...selectedChannelIds][0] };
		}
		if (activeTab === 'Lists' && selectedListIds.size === 1) {
			return { source: 'lists', id: [...selectedListIds][0] };
		}
		if (activeTab === 'Wallets' && selectedWalletIds.size === 1) {
			return { source: 'wallets', id: [...selectedWalletIds][0] };
		}
		if (feedSourceId) return { source: getFeedSourceFamily(), id: feedSourceId };
		return null;
	}

	function buildFeedQuery(): WatchlistFeedQuery {
		const q: WatchlistFeedQuery = {};
		if (feedMinMcap) q.minMarketcap = feedMinMcap;
		if (feedMaxMcap) q.maxMarketcap = feedMaxMcap;
		if (feedMinMultiplier) q.minMultiplier = feedMinMultiplier;
		if (feedMaxMultiplier) q.maxMultiplier = feedMaxMultiplier;
		if (feedMinPrice) q.minPrice = feedMinPrice;
		if (feedMaxPrice) q.maxPrice = feedMaxPrice;
		if (feedChains.length > 0) q.chains = feedChains;
		if (activeTab === 'Wallets' && feedSwapType) q.swapType = feedSwapType;
		return q;
	}

	function callsTriplet(): CursorTriplet {
		return callsPagination;
	}

	function rememberCallsPage(page: CursorTriplet | undefined | null) {
		const pagination = {
			cursor: page?.cursor ?? undefined,
			prevCursor: page?.prevCursor ?? undefined,
			nextCursor: page?.nextCursor ?? undefined
		};
		callsPagination = pagination;
		hasMore = !!pagination.nextCursor;
	}

	async function fetchCalls(opts?: { soft?: boolean }) {
		const keepVisible = !!(opts?.soft && calls.length > 0);
		if (!keepVisible) {
			loading = true;
			calls = [];
		}
		rememberCallsPage(undefined);
		try {
			if (activeTab !== 'Callers' && !getIsLoggedIn()) {
				loading = false;
				cleanupCallWs();
				return;
			}
			const selected = getSelectedSourceId();
			const query = buildFeedQuery();
			if (selected) {
				const { data } = await api.GET('/v2/watchlist/sources/{source}/{id}/feed', {
					params: { path: { source: selected.source, id: selected.id }, query }
				});
				calls = data?.items ?? [];
				rememberCallsPage(data);
			} else {
				const path = watchlistPathMap[activeTab];
				const { data } = await api.GET(path, {
					params: { query }
				});
				calls = data?.items ?? [];
				rememberCallsPage(data);
			}
		} catch {
			if (!keepVisible) calls = [];
			rememberCallsPage(undefined);
		} finally {
			loading = false;
			setupCallWs(activeTab);
			autoFillIfNeeded();
		}
	}

	async function fetchMoreCalls() {
		if (loadingMore || !hasMore || !callsPagination.nextCursor) return;
		loadingMore = true;
		try {
			const previousCursor = callsPagination.cursor;
			const selected = getSelectedSourceId();
			const query = { ...buildFeedQuery(), cursor: callsPagination.nextCursor };
			if (selected) {
				const { data } = await api.GET('/v2/watchlist/sources/{source}/{id}/feed', {
					params: { path: { source: selected.source, id: selected.id }, query }
				});
				calls = [...calls, ...(data?.items ?? [])];
				rememberCallsPage(data);
				if (callsPagination.cursor && callsPagination.cursor !== previousCursor) setupCallWs(activeTab);
			} else {
				const path = watchlistPathMap[activeTab];
				const { data } = await api.GET(path, {
					params: { query }
				});
				calls = [...calls, ...(data?.items ?? [])];
				rememberCallsPage(data);
				if (callsPagination.cursor && callsPagination.cursor !== previousCursor) setupCallWs(activeTab);
			}
		} catch {
			hasMore = false;
		} finally {
			loadingMore = false;
			autoFillIfNeeded();
		}
	}

	function handleCallsScroll(e: Event) {
		if (!hasMore || loadingMore) return;
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
			fetchMoreCalls();
		}
	}

	function autoFillIfNeeded() {
		if (!hasMore || loadingMore || !callsPagination.nextCursor) return;
		requestAnimationFrame(() => requestAnimationFrame(() => {
			const el = callsScrollEl;
			if (el && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight + 4) {
				fetchMoreCalls();
			}
		}));
	}

	$effect(() => {
		const el = callsScrollEl;
		if (!el) return;
		const ro = new ResizeObserver(() => autoFillIfNeeded());
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		void callBubbles.length;
		void getBubbleWatchlist();
		void bubbleDrillToken;
		untrack(() => autoFillIfNeeded());
	});

	async function fetchCallerSources() {
		if (callerSourcesFetched) return;
		callerSourcesLoading = true;
		try {
			const { data } = await api.GET('/v2/watchlist/sources/callers');
			callerSources = data?.sources ?? [];
			callerSourcesCursor = data?.nextCursor;
			callerSourcesHasMore = !!data?.nextCursor;
		} catch {} finally {
			callerSourcesLoading = false;
			callerSourcesFetched = true;
		}
	}

	async function fetchMoreCallerSources() {
		if (!callerSourcesHasMore || callerSourcesLoadingMore || !callerSourcesCursor) return;
		callerSourcesLoadingMore = true;
		try {
			const { data } = await api.GET('/v2/watchlist/sources/callers', {
				params: { query: { cursor: callerSourcesCursor } }
			});
			callerSources = [...callerSources, ...(data?.sources ?? [])];
			callerSourcesCursor = data?.nextCursor;
			callerSourcesHasMore = !!data?.nextCursor;
		} catch {} finally {
			callerSourcesLoadingMore = false;
		}
	}

	async function searchCallerSources(query: string) {
		if (!query || !callerSourcesHasMore || callerSourcesLoadingMore) return;
		const lq = query.toLowerCase();
		const hasLocal = callerSources.some(s => getSourceName(s).toLowerCase().includes(lq));
		if (hasLocal) return;
		while (callerSourcesHasMore && !callerSourcesLoadingMore) {
			await fetchMoreCallerSources();
			if (callerSources.some(s => getSourceName(s).toLowerCase().includes(lq))) break;
		}
	}

	function clearFeedFilters() {
		feedMinMcap = '';
		feedMaxMcap = '';
		feedMinMultiplier = '';
		feedMaxMultiplier = '';
		feedMinPrice = '';
		feedMaxPrice = '';
		feedChains = [];
		feedSwapType = null;
		feedSourceId = null;
		feedSourceSearch = '';
		selectedCallerId = null;
		selectedChannelIds = new Set();
		selectedListIds = new Set();
		selectedWalletIds = new Set();
		sourceRanking = null;
	}

	function applyFeedFilters() {
		showFeedFilter = false;
		if (feedSourceId) {
			if (activeTab === 'Callers') selectedCallerId = feedSourceId;
			else if (activeTab === 'Telegram') { selectedChannelIds = new Set([feedSourceId]); }
			else if (activeTab === 'Lists') { selectedListIds = new Set([feedSourceId]); }
			else if (activeTab === 'Wallets') { selectedWalletIds = new Set([feedSourceId]); }
			feedSourceId = null;
		}
		fetchCalls();
		fetchSourceRanking();
	}

	async function fetchTgStatus() {
		tgLoading = true;
		try {
			const { data } = await api.GET('/v2/watchlist/manage/tg/login/status');
			tgLoggedIn = data?.loggedIn ?? false;
			if (tgLoggedIn) {
				await fetchTgChats();
			}
		} catch {} finally {
			tgLoading = false;
			tgChecked = true;
		}
	}

	async function fetchTgChats() {
		tgChatsLoading = true;
		try {
			const { data } = await api.GET('/v2/watchlist/manage/tg/chats');
			tgChats = data ?? [];
		} catch {} finally {
			tgChatsLoading = false;
		}
	}

	async function fetchTgSources() {
		if (tgSourcesFetched) return;
		try {
			const { data } = await api.GET('/v2/watchlist/sources/tg');
			tgSources = data?.sources ?? [];
		} catch {} finally {
			tgSourcesFetched = true;
		}
	}

	async function syncTgChats() {
		tgSyncing = true;
		try {
			await api.POST('/v2/watchlist/manage/tg/chats/sync');
			await fetchTgChats();
		} catch {} finally {
			tgSyncing = false;
		}
	}

	async function handleConnect() {
		try {
			await connectWallet();
			authenticate(getAuthToken());
		} catch {}
	}

	async function toggleChat(chatId: number, enabled: boolean) {
		try {
			if (enabled) {
				await api.POST('/v2/watchlist/manage/tg/chats/{chatId}/enable', {
					params: { path: { chatId } }
				});
			} else {
				await api.POST('/v2/watchlist/manage/tg/chats/{chatId}/disable', {
					params: { path: { chatId } }
				});
			}
			tgChats = tgChats.map(c => c.chatId === chatId ? { ...c, isEnabled: enabled } : c);
		} catch {}
	}

	function toggleChannelFilter(sourceId: string) {
		const next = new Set(selectedChannelIds);
		if (next.has(sourceId)) next.delete(sourceId);
		else { next.clear(); next.add(sourceId); }
		selectedChannelIds = next;
		feedSourceId = null;
		fetchCalls();
		fetchSourceRanking();
	}

	async function openEditModal(chat: TgManagedChat) {
		editChat = chat;
		editSenders = [];
		editTopics = [];
		editSelectedSenders = chat.filter?.senders ?? [];
		editSelectedTopics = chat.filter?.topics ?? [];
		editFilterAdmin = chat.filter?.admin ?? true;
		editFilterBot = chat.filter?.bot ?? true;
		editFilterForwarded = chat.filter?.forwarded ?? true;
		editFilterPinned = chat.filter?.pinned ?? true;
		editFilterReply = chat.filter?.reply ?? true;
		editFilterUsers = chat.filter?.users ?? true;
		showEditModal = true;

		editLoadingSenders = true;
		editLoadingTopics = true;
		try {
			const { data } = await api.GET('/v2/watchlist/manage/tg/chats/{chatId}/senders', {
				params: { path: { chatId: chat.chatId } }
			});
			editSenders = data?.senders ?? [];
		} catch {} finally {
			editLoadingSenders = false;
		}
		try {
			const { data } = await api.GET('/v2/watchlist/manage/tg/chats/{chatId}/topics', {
				params: { path: { chatId: chat.chatId } }
			});
			editTopics = data?.topics ?? [];
		} catch {} finally {
			editLoadingTopics = false;
		}
	}

	function toggleEditSender(sender: TgSenderEntry) {
		const exists = editSelectedSenders.some(s => s.senderId === sender.senderId);
		if (exists) editSelectedSenders = editSelectedSenders.filter(s => s.senderId !== sender.senderId);
		else editSelectedSenders = [...editSelectedSenders, sender];
	}

	function toggleEditTopic(topic: TgTopicEntry) {
		const exists = editSelectedTopics.some(t => t.topicId === topic.topicId);
		if (exists) editSelectedTopics = editSelectedTopics.filter(t => t.topicId !== topic.topicId);
		else editSelectedTopics = [...editSelectedTopics, topic];
	}

	async function saveFilter() {
		if (!editChat) return;
		editSaving = true;
		try {
			await api.PUT('/v2/watchlist/manage/tg/chats/{chatId}/filter/update', {
				params: { path: { chatId: editChat.chatId } },
				body: {
					admin: editFilterAdmin,
					bot: editFilterBot,
					forwarded: editFilterForwarded,
					pinned: editFilterPinned,
					reply: editFilterReply,
					users: editFilterUsers,
					senders: editSelectedSenders.length > 0 ? editSelectedSenders : null,
					topics: editSelectedTopics.length > 0 ? editSelectedTopics : null
				}
			});
			await fetchTgChats();
			showEditModal = false;
			editChat = null;
		} catch {} finally {
			editSaving = false;
		}
	}

	async function fetchUserLists() {
		userListsLoading = true;
		try {
			const { data } = await api.GET('/v2/watchlist/sources/lists');
			userLists = (data?.sources ?? []).filter((s): s is ListSource => s.type === 'LIST');
		} catch {} finally {
			userListsLoading = false;
			userListsFetched = true;
		}
	}

	function getSourceName(item: WatchlistSourceItem): string {
		return (item as { name: string }).name;
	}

	function getSourceId(item: WatchlistSourceItem): string {
		return (item as { id: string }).id;
	}

	function resetListForm() {
		ulName = '';
		ulChain = '';
		ulMcapMin = '';
		ulMcapMax = '';
		ulLiqMin = '';
		ulLiqMax = '';
		ulAgeMin = '';
		ulAgeMax = '';
		ulDexPaid = null;
		ulIsRenounced = null;
		ulLpLocked = null;
		ulFreezeDisabled = null;
		ulMintDisabled = null;
		ulNotHoneypot = null;
		ulIsVerified = null;
		ulHasWebsite = null;
		ulHasTwitter = null;
		ulHasTelegram = null;
		ulHasDiscord = null;
		ulWithAnySocial = null;
		ulMaxBuyTax = '';
		ulMaxSellTax = '';
		ulMaxTransferTax = '';
		ulSelectedCallers = [];
		ulSelectedTgConns = [];
		ulSelectedWallets = [];
		ulPlatforms = [];
		ulGraduation = '';
		ulLpBurned = null;
		ulProxy = null;
		ulCallCountMin = '';
		ulCallCountMax = '';
		ulHolderCountMin = '';
		ulHolderCountMax = '';
		ulTop10PctMax = '';
		ulDevPctMax = '';
		ulInsiderPctMax = '';
		ulSniperPctMax = '';
		ulBundlerPctMax = '';
		ulActivityTimeframe = 'fiveMin';
		ulVolMin = '';
		ulVolMax = '';
		ulTxnsMin = '';
		ulTxnsMax = '';
		ulBuysMin = '';
		ulSellsMin = '';
		ulPriceChangeMin = '';
		ulPriceChangeMax = '';
	}

	function populateListForm(list: ListSource) {
		ulName = list.name;
		const f = list.sourceDetails.tokenFilter;
		ulChain = (f.scope?.chain?.[0] as Chain) ?? '';
		ulMcapMin = f.market?.marketCapUsd?.min?.toString() ?? '';
		ulMcapMax = f.market?.marketCapUsd?.max?.toString() ?? '';
		ulLiqMin = f.market?.liquidityUsd?.min?.toString() ?? '';
		ulLiqMax = f.market?.liquidityUsd?.max?.toString() ?? '';
		ulAgeMin = f.market?.ageHours?.min?.toString() ?? '';
		ulAgeMax = f.market?.ageHours?.max?.toString() ?? '';
		ulDexPaid = f.socials?.dexScreenerPaid ?? null;
		ulIsRenounced = f.security?.renounced ?? null;
		ulLpLocked = f.security?.lpLocked ?? null;
		ulFreezeDisabled = f.security?.freezable === false ? true : null;
		ulMintDisabled = f.security?.mintable === false ? true : null;
		ulNotHoneypot = f.security?.honeypot === false ? true : null;
		ulIsVerified = f.security?.contractVerified ?? null;
		ulHasWebsite = f.socials?.hasWebsite ?? null;
		ulHasTwitter = f.socials?.hasTwitter ?? null;
		ulHasTelegram = f.socials?.hasTelegram ?? null;
		ulHasDiscord = f.socials?.hasDiscord ?? null;
		ulWithAnySocial = f.socials?.hasAnySocial ?? null;
		ulMaxBuyTax = f.tax?.buyTaxPct?.max?.toString() ?? '';
		ulMaxSellTax = f.tax?.sellTaxPct?.max?.toString() ?? '';
		ulMaxTransferTax = f.tax?.transferTaxPct?.max?.toString() ?? '';
		ulSelectedCallers = f.sources?.callers ?? [];
		ulSelectedTgConns = f.sources?.tgConnections ?? [];
		ulSelectedWallets = f.sources?.wallets ?? [];
		ulPlatforms = (f.scope?.platforms as PlatformType[]) ?? [];
		ulGraduation = (f.scope?.graduation as ScannerGraduation) ?? '';
		ulLpBurned = f.security?.lpBurned ?? null;
		ulProxy = f.security?.proxy === false ? true : null;
		ulCallCountMin = (f as Record<string, unknown>).callCount ? String(((f as Record<string, unknown>).callCount as { min?: number })?.min ?? '') : '';
		ulCallCountMax = (f as Record<string, unknown>).callCount ? String(((f as Record<string, unknown>).callCount as { max?: number })?.max ?? '') : '';
		ulHolderCountMin = f.holders?.holderCount?.min?.toString() ?? '';
		ulHolderCountMax = f.holders?.holderCount?.max?.toString() ?? '';
		ulTop10PctMax = f.holders?.top10Pct?.max?.toString() ?? '';
		ulDevPctMax = f.holders?.devPct?.max?.toString() ?? '';
		ulInsiderPctMax = f.holders?.insiderPct?.max?.toString() ?? '';
		ulSniperPctMax = f.holders?.sniperPct?.max?.toString() ?? '';
		ulBundlerPctMax = f.holders?.bundlerPct?.max?.toString() ?? '';
		const actKeys = ['fiveMin', 'oneHour', 'sixHours', 'twentyFourHours'] as const;
		const activeKey = actKeys.find(k => f.activity?.[k]);
		ulActivityTimeframe = activeKey ?? 'fiveMin';
		const aw = activeKey ? f.activity?.[activeKey] : null;
		ulVolMin = aw?.volumeUsd?.min?.toString() ?? '';
		ulVolMax = aw?.volumeUsd?.max?.toString() ?? '';
		ulTxnsMin = aw?.transactions?.min?.toString() ?? '';
		ulTxnsMax = aw?.transactions?.max?.toString() ?? '';
		ulBuysMin = aw?.buys?.min?.toString() ?? '';
		ulSellsMin = aw?.sells?.min?.toString() ?? '';
		ulPriceChangeMin = aw?.priceChangePct?.min?.toString() ?? '';
		ulPriceChangeMax = aw?.priceChangePct?.max?.toString() ?? '';
	}

	function buildTokenFilter(): TokenFilter {
		const filter: TokenFilter = {};
		const scope: Record<string, unknown> = {};
		if (ulChain) scope.chain = [ulChain as Chain];
		if (ulPlatforms.length > 0) scope.platforms = ulPlatforms;
		if (ulGraduation) scope.graduation = ulGraduation;
		if (Object.keys(scope).length > 0) filter.scope = scope as TokenFilter['scope'];
		const market: TokenMarketFilter = {};
		if (ulMcapMin || ulMcapMax) {
			market.marketCapUsd = {};
			if (ulMcapMin) market.marketCapUsd.min = parseFloat(ulMcapMin);
			if (ulMcapMax) market.marketCapUsd.max = parseFloat(ulMcapMax);
		}
		if (ulLiqMin || ulLiqMax) {
			market.liquidityUsd = {};
			if (ulLiqMin) market.liquidityUsd.min = parseFloat(ulLiqMin);
			if (ulLiqMax) market.liquidityUsd.max = parseFloat(ulLiqMax);
		}
		if (ulAgeMin || ulAgeMax) {
			market.ageHours = {};
			if (ulAgeMin) market.ageHours.min = parseFloat(ulAgeMin);
			if (ulAgeMax) market.ageHours.max = parseFloat(ulAgeMax);
		}
		if (Object.keys(market).length > 0) filter.market = market;
		const sec: TokenSecurityFilter = {};
		if (ulIsRenounced !== null) sec.renounced = ulIsRenounced;
		if (ulLpLocked !== null) sec.lpLocked = ulLpLocked;
		if (ulLpBurned !== null) sec.lpBurned = ulLpBurned;
		if (ulFreezeDisabled !== null) sec.freezable = ulFreezeDisabled === true ? false : null;
		if (ulMintDisabled !== null) sec.mintable = ulMintDisabled === true ? false : null;
		if (ulNotHoneypot !== null) sec.honeypot = ulNotHoneypot === true ? false : null;
		if (ulIsVerified !== null) sec.contractVerified = ulIsVerified;
		if (ulProxy !== null) sec.proxy = ulProxy === true ? false : null;
		if (Object.keys(sec).length > 0) filter.security = sec;
		const tax: TokenTaxFilter = {};
		if (ulMaxBuyTax) tax.buyTaxPct = { max: parseFloat(ulMaxBuyTax) };
		if (ulMaxSellTax) tax.sellTaxPct = { max: parseFloat(ulMaxSellTax) };
		if (ulMaxTransferTax) tax.transferTaxPct = { max: parseFloat(ulMaxTransferTax) };
		if (Object.keys(tax).length > 0) filter.tax = tax;
		const soc: TokenSocialFilter = {};
		if (ulHasWebsite !== null) soc.hasWebsite = ulHasWebsite;
		if (ulHasTwitter !== null) soc.hasTwitter = ulHasTwitter;
		if (ulHasTelegram !== null) soc.hasTelegram = ulHasTelegram;
		if (ulHasDiscord !== null) soc.hasDiscord = ulHasDiscord;
		if (ulWithAnySocial !== null) soc.hasAnySocial = ulWithAnySocial;
		if (ulDexPaid !== null) soc.dexScreenerPaid = ulDexPaid;
		if (Object.keys(soc).length > 0) filter.socials = soc;
		const sources: TokenSourceFilter = {};
		if (ulSelectedCallers.length > 0) sources.callers = ulSelectedCallers;
		if (ulSelectedTgConns.length > 0) sources.tgConnections = ulSelectedTgConns;
		if (ulSelectedWallets.length > 0) sources.wallets = ulSelectedWallets;
		if (Object.keys(sources).length > 0) filter.sources = sources;
		if (ulCallCountMin || ulCallCountMax) {
			const cc: { min?: number; max?: number } = {};
			if (ulCallCountMin) cc.min = parseInt(ulCallCountMin);
			if (ulCallCountMax) cc.max = parseInt(ulCallCountMax);
			(filter as Record<string, unknown>).callCount = cc;
		}
		const holders: TokenHolderFilter = {};
		if (ulHolderCountMin || ulHolderCountMax) {
			holders.holderCount = {};
			if (ulHolderCountMin) holders.holderCount.min = parseInt(ulHolderCountMin);
			if (ulHolderCountMax) holders.holderCount.max = parseInt(ulHolderCountMax);
		}
		if (ulTop10PctMax) holders.top10Pct = { max: parseFloat(ulTop10PctMax) };
		if (ulDevPctMax) holders.devPct = { max: parseFloat(ulDevPctMax) };
		if (ulInsiderPctMax) holders.insiderPct = { max: parseFloat(ulInsiderPctMax) };
		if (ulSniperPctMax) holders.sniperPct = { max: parseFloat(ulSniperPctMax) };
		if (ulBundlerPctMax) holders.bundlerPct = { max: parseFloat(ulBundlerPctMax) };
		if (Object.keys(holders).length > 0) filter.holders = holders;
		const aw: TokenActivityWindowFilter = {};
		if (ulVolMin || ulVolMax) {
			aw.volumeUsd = {};
			if (ulVolMin) aw.volumeUsd.min = parseFloat(ulVolMin);
			if (ulVolMax) aw.volumeUsd.max = parseFloat(ulVolMax);
		}
		if (ulTxnsMin || ulTxnsMax) {
			aw.transactions = {};
			if (ulTxnsMin) aw.transactions.min = parseInt(ulTxnsMin);
			if (ulTxnsMax) aw.transactions.max = parseInt(ulTxnsMax);
		}
		if (ulBuysMin) aw.buys = { min: parseInt(ulBuysMin) };
		if (ulSellsMin) aw.sells = { min: parseInt(ulSellsMin) };
		if (ulPriceChangeMin || ulPriceChangeMax) {
			aw.priceChangePct = {};
			if (ulPriceChangeMin) aw.priceChangePct.min = parseFloat(ulPriceChangeMin);
			if (ulPriceChangeMax) aw.priceChangePct.max = parseFloat(ulPriceChangeMax);
		}
		if (Object.keys(aw).length > 0) {
			filter.activity = { [ulActivityTimeframe]: aw } as TokenActivityFilter;
		}
		return filter;
	}

	function openCreateList() {
		listModalEditList = null;
		void ensureUserListModal().then(() => { showListModal = true; });
	}

	function openEditList(list: ListSource) {
		listModalEditList = list;
		void ensureUserListModal().then(() => { showListModal = true; });
	}



	async function fetchSourceOptions() {
		if (srcFetched) return;
		srcLoading = true;
		try {
			const [b, t, w] = await Promise.all([
				api.GET('/v2/watchlist/sources/callers'),
				api.GET('/v2/watchlist/sources/tg'),
				api.GET('/v2/watchlist/sources/wallets'),
			]);
			srcCallerItems = b.data?.sources ?? [];
			srcCallerCursor = b.data?.nextCursor;
			srcCallerHasMore = !!b.data?.nextCursor;
			srcTgItems = t.data?.sources ?? [];
			srcWalletItems = w.data?.sources ?? [];
		} catch {}
		srcLoading = false;
		srcFetched = true;
	}

	async function fetchMoreCallers() {
		if (!srcCallerHasMore || srcCallerLoadingMore || !srcCallerCursor) return;
		srcCallerLoadingMore = true;
		try {
			const { data } = await api.GET('/v2/watchlist/sources/callers', {
				params: { query: { cursor: srcCallerCursor } }
			});
			srcCallerItems = [...srcCallerItems, ...(data?.sources ?? [])];
			srcCallerCursor = data?.nextCursor;
			srcCallerHasMore = !!data?.nextCursor;
		} catch {}
		srcCallerLoadingMore = false;
	}

	async function searchCallerSourcesPicker(query: string) {
		if (!query || !srcCallerHasMore || srcCallerLoadingMore) return;
		const lq = query.toLowerCase();
		const hasLocal = srcCallerItems.some(s => getSourceName(s).toLowerCase().includes(lq));
		if (hasLocal) return;
		while (srcCallerHasMore && !srcCallerLoadingMore) {
			await fetchMoreCallers();
			if (srcCallerItems.some(s => getSourceName(s).toLowerCase().includes(lq))) break;
		}
	}

	function getCallerName(id: string): string {
		const item = srcCallerItems.find(c => getSourceId(c) === id);
		return item ? getSourceName(item) : id;
	}

	function getTgConnName(id: string): string {
		const item = srcTgItems.find(c => getSourceId(c) === id);
		return item ? getSourceName(item) : id;
	}

	function getWalletName(id: string): string {
		const item = srcWalletItems.find(w => getSourceId(w) === id);
		return item ? getSourceName(item) : id;
	}

	function toggleListFilter(listId: string) {
		const next = new Set(selectedListIds);
		if (next.has(listId)) next.delete(listId);
		else { next.clear(); next.add(listId); }
		selectedListIds = next;
		feedSourceId = null;
		fetchCalls();
		fetchSourceRanking();
	}

	async function fetchCtWallets() {
		ctWalletsLoading = true;
		try {
			const all: WalletSource[] = [];
			let cursor: string | undefined;
			const seen = new Set<string>();
			do {
				const { data } = await api.GET('/v2/watchlist/sources/wallets', {
					params: { query: cursor ? { cursor } : {} }
				});
				const page = ((data?.sources ?? []) as WalletSource[]).filter((s): s is WalletSource => 'walletAddress' in s);
				all.push(...page);
				const next = data?.nextCursor ?? undefined;
				if (!next || seen.has(next)) break;
				seen.add(next);
				cursor = next;
			} while (cursor);
			ctWallets = all;
		} catch {} finally {
			ctWalletsLoading = false;
			ctWalletsFetched = true;
		}
	}

	function resetCtForm() {
		ctName = '';
		ctChain = '';
		ctAddress = '';
		ctError = '';
	}

	function openAddWallet() {
		resetCtForm();
		showCtAddModal = true;
	}

	async function saveCtWallet() {
		if (!ctName.trim() || !ctChain || !ctAddress.trim()) return;
		ctSaving = true;
		ctError = '';
		try {
			const { error } = await api.POST('/v2/watchlist/manage/wallets/create', {
				body: { name: ctName.trim(), chain: ctChain as Chain, walletAddress: ctAddress.trim() }
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed to add wallet');
			showCtAddModal = false;
			resetCtForm();
			await fetchCtWallets();
		} catch (e: unknown) {
			ctError = e instanceof Error ? e.message : 'Failed to add wallet';
		} finally {
			ctSaving = false;
		}
	}

	async function deleteCtWallet(id: string) {
		try {
			await api.DELETE('/v2/watchlist/manage/wallets/{walletId}/delete', { params: { path: { walletId: id } } });
			await fetchCtWallets();
		} catch {}
	}

	function toggleWalletFilter(walletId: string) {
		const next = new Set(selectedWalletIds);
		if (next.has(walletId)) next.delete(walletId);
		else { next.clear(); next.add(walletId); }
		selectedWalletIds = next;
		feedSourceId = null;
		fetchCalls();
		fetchSourceRanking();
	}

	let prevTab = '';
	let prevLoggedIn = false;

	$effect(() => {
		if (!active) {
			cleanupCallWs();
			return;
		}
		const tab = activeTab;
		const loggedIn = getIsLoggedIn();
		untrack(() => {
			const tabChanged = tab !== prevTab;
			const loginChanged = loggedIn !== prevLoggedIn;
			prevTab = tab;
			prevLoggedIn = loggedIn;

			if (tab === 'Telegram' && loggedIn && !tgChecked) {
				fetchTgStatus();
			}
			if (tab === 'Telegram' && loggedIn && !tgSourcesFetched) {
				fetchTgSources();
			}
			if (tab === 'Lists' && loggedIn && !userListsFetched) {
				fetchUserLists();
			}
			if (tab === 'Wallets' && loggedIn && !ctWalletsFetched) {
				fetchCtWallets();
			}
			if (tab === 'Callers' && !callerSourcesFetched) {
				fetchCallerSources();
			}
			if (loggedIn && !botsFetched) {
				fetchBots();
			}

			if (tabChanged || loginChanged) {
				sourceRanking = null;
				fetchCalls();
			} else if (!callWsKey) {
				setupCallWs(tab);
			}
		});

		return () => cleanupAll();
	});

	$effect(() => {
		const selection = getPendingWatchlistCaller();
		if (!selection) return;
		untrack(() => {
			applyCallerSelection(selection.id, selection.sourceType);
			clearPendingWatchlistCaller();
		});
	});

	onDestroy(() => {
		if (feedSourceSearchTimer) clearTimeout(feedSourceSearchTimer);
		for (const t of arrivedTimers.values()) clearTimeout(t);
		cleanupAll();
	});

	function multiplierColor(val: number | null | undefined): string {
		if (val == null) return 'text-g7';
		return val >= 1 ? 'text-grn' : 'text-red';
	}
</script>

<div class="flex flex-1 flex-col min-h-0 overflow-hidden">
	<div class="flex border-b border-bd">
		{#each tabs as tab}
			<button
				class="relative flex-1 cursor-pointer px-1 py-1.5 text-xs font-medium transition-colors {activeTab === tab
					? 'text-tx'
					: 'text-g6 hover:text-g9'}"
								onclick={() => selectTab(tab)}
			>
				{tab}
				{#if activeTab === tab}
					<span class="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-grn"></span>
				{/if}
			</button>
		{/each}
	</div>

	{#if requiresAuth(activeTab) && !getIsLoggedIn()}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-4">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-s4 ring-1 ring-bd">
				<Lock class="h-5 w-5 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-sm text-g6">Connect wallet to view</span>
			<span class="text-xs text-g5">{activeTab} requires login</span>
		</div>
	{:else if activeTab === 'Telegram' && getIsLoggedIn() && (tgLoading || !tgChecked)}
		<div class="space-y-1 p-2">
			{#each Array(8) as _}
				<div class="skeleton h-14 rounded-lg"></div>
			{/each}
		</div>
	{:else if activeTab === 'Telegram' && getIsLoggedIn() && !tgLoggedIn}
		<div class="relative flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-s4 ring-1 ring-bd">
				<MessageCircle class="h-6 w-6 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-sm font-medium text-tx">Connect Telegram</span>
			<span class="text-center text-xs text-g6">Link your Telegram account to see calls from your groups and channels</span>
			<button
				onclick={() => { showTgLoginModal = true; }}
				class="btn-primary mt-1 px-5 py-2 text-sm"
			>
				Connect Telegram
			</button>
		</div>
	{:else if activeTab === 'Lists' && getIsLoggedIn() && !userListsLoading && userListsFetched && userLists.length === 0}
		<div class="relative flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-s4 ring-1 ring-bd">
				<List class="h-6 w-6 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-sm font-medium text-tx">No user lists</span>
			<span class="text-center text-xs text-g6">Create a list with token filters to see matching calls</span>
			<button
				onclick={openCreateList}
				class="btn-primary mt-1 px-5 py-2 text-sm"
			>
				Create List
			</button>
		</div>
	{:else if activeTab === 'Wallets' && getIsLoggedIn() && (ctWalletsLoading || !ctWalletsFetched)}
		<div class="space-y-1 p-2">
			{#each Array(8) as _}
				<div class="skeleton h-14 rounded-lg"></div>
			{/each}
		</div>
	{:else if activeTab === 'Wallets' && getIsLoggedIn() && ctWalletsFetched && ctWallets.length === 0}
		<div class="relative flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-s4 ring-1 ring-bd">
				<Copy class="h-6 w-6 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-sm font-medium text-tx">No wallets tracked</span>
			<span class="text-center text-xs text-g6">Add wallet addresses to copy trade and see their calls</span>
			<button
				onclick={openAddWallet}
				class="btn-primary mt-1 px-5 py-2 text-sm"
			>
				Add Wallet
			</button>
		</div>
	{:else if activeTab === 'Telegram' && getIsLoggedIn() && tgLoggedIn && enabledChats.length === 0}
		<div class="relative flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-s4 ring-1 ring-bd">
				<Bell class="h-6 w-6 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-sm font-medium text-tx">No channels enabled</span>
			<span class="text-center text-xs text-g6">Enable Telegram channels to start seeing calls in your feed</span>
			<button
				onclick={() => { showChannelModal = true; }}
				class="btn-primary mt-1 px-5 py-2 text-sm"
			>
				Set Up Channels
			</button>
		</div>
	{:else}
		<div class="relative flex items-center gap-1 border-b border-bd px-2 py-1.5">
			{#if activeTab === 'Lists' && getIsLoggedIn() && userLists.length > 0}
				<button onclick={openCreateList} class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:bg-s6 hover:text-tx" title="Create list"><Plus class="h-3.5 w-3.5" strokeWidth={2} /></button>
			{:else if activeTab === 'Wallets' && getIsLoggedIn() && ctWallets.length > 0}
				<button onclick={openAddWallet} class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:bg-s6 hover:text-tx" title="Add wallet"><Plus class="h-3.5 w-3.5" strokeWidth={2} /></button>
			{:else if activeTab === 'Telegram' && getIsLoggedIn() && tgLoggedIn && enabledChats.length > 0}
				<button onclick={() => { showChannelModal = true; }} class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:bg-s6 hover:text-tx" title="Add channels"><Plus class="h-3.5 w-3.5" strokeWidth={2} /></button>
			{/if}

			<div class="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-none" onwheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); e.currentTarget.scrollLeft += e.deltaY; } }}>
				{#if activeTab === 'Callers'}
					<button onclick={() => { selectedCallerId = null; feedSourceId = null; sourceRanking = null; fetchCalls(); }} class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedCallerId === null ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}">All</button>
					{#each callerSources as caller (getSourceId(caller))}
						<button
							onclick={() => { const id = getSourceId(caller); selectedCallerId = selectedCallerId === id ? null : id; feedSourceId = null; if (!selectedCallerId) sourceRanking = null; fetchCalls(); if (selectedCallerId) fetchSourceRanking(); }}
							class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedCallerId === getSourceId(caller) ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}"
						>
							<span class="max-w-[80px] truncate">{getSourceName(caller)}</span>
						</button>
					{/each}
					{#if callerSourcesHasMore}
						<button onclick={fetchMoreCallerSources} disabled={callerSourcesLoadingMore} class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium text-g4 hover:text-g9 disabled:opacity-50">
							{callerSourcesLoadingMore ? '...' : 'more'}
						</button>
					{/if}
				{:else if activeTab === 'Lists' && getIsLoggedIn() && userLists.length > 0}
					<button onclick={() => { selectedListIds = new Set(); feedSourceId = null; sourceRanking = null; fetchCalls(); }} class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedListIds.size === 0 ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}">All</button>
					{#each userLists as list (list.id)}
						<div class="group flex shrink-0 items-center gap-0.5">
							<button onclick={() => toggleListFilter(list.id)} class="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedListIds.has(list.id) ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}"><span class="max-w-[80px] truncate">{list.name}</span></button>
							<button onclick={() => openEditList(list)} class="hidden cursor-pointer text-g4 transition-colors hover:text-tx group-hover:inline-flex" title="Edit list"><Settings class="h-3 w-3" strokeWidth={1.5} /></button>
						</div>
					{/each}
				{:else if activeTab === 'Wallets' && getIsLoggedIn() && ctWallets.length > 0}
					<button onclick={() => { selectedWalletIds = new Set(); feedSourceId = null; sourceRanking = null; fetchCalls(); }} class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedWalletIds.size === 0 ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}">All</button>
					{#each ctWallets as wallet (wallet.id)}
						<div class="group flex shrink-0 items-center gap-0.5">
							<button onclick={() => toggleWalletFilter(wallet.id)} class="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedWalletIds.has(wallet.id) ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}"><span class="max-w-[80px] truncate">{wallet.name}</span></button>
							<button onclick={() => { showCtWalletModal = true; }} class="hidden cursor-pointer text-g4 transition-colors hover:text-tx group-hover:inline-flex" title="Manage wallets"><Settings class="h-3 w-3" strokeWidth={1.5} /></button>
						</div>
					{/each}
				{:else if activeTab === 'Telegram' && getIsLoggedIn() && tgLoggedIn && tgSources.length > 0}
					<button onclick={() => { selectedChannelIds = new Set(); feedSourceId = null; sourceRanking = null; fetchCalls(); }} class="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedChannelIds.size === 0 ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}">All</button>
					{#each tgSources as src (getSourceId(src))}
						<div class="group flex shrink-0 items-center gap-0.5">
							<button onclick={() => toggleChannelFilter(getSourceId(src))} class="cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors {selectedChannelIds.has(getSourceId(src)) ? 'bg-grn/20 text-grn' : 'text-g6 hover:text-g9'}"><span class="max-w-[80px] truncate">{getSourceName(src)}</span></button>
						</div>
					{/each}
				{/if}
			</div>

			<button
				onclick={() => { if (!showFeedFilter) fetchFeedSources(); showFeedFilter = !showFeedFilter; }}
				class="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors {showFeedFilter ? 'bg-tx/20 text-tx' : feedFilterCount > 0 ? 'bg-grn/10 text-grn' : 'bg-s7 text-g7 hover:bg-s6 hover:text-tx'}"
				title="Filter calls"
			>
				<Filter class="h-3.5 w-3.5" strokeWidth={2} />
				{#if feedFilterCount > 0}
					<span class="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-grn px-0.5 text-[8px] font-bold text-s0">{feedFilterCount}</span>
				{/if}
			</button>

		{#if showFeedFilter}
			<button class="fixed inset-0 z-30 cursor-default" onclick={() => { showFeedFilter = false; }} aria-label="Close filter"></button>
			{@const pillSelected = getSelectedSourceId()}
				<div class="absolute right-1 top-full z-40 mt-1 w-72 rounded-xl border border-bd bg-s5 shadow-2xl shadow-s0/60">
					<div class="border-b border-s7 px-4 py-2.5 flex items-center justify-between">
						<span class="text-[11px] font-bold uppercase tracking-widest text-g7">Feed Filters</span>
						{#if feedFilterCount > 0}
							<button onclick={() => { clearFeedFilters(); fetchCalls(); }} class="cursor-pointer text-[10px] font-medium text-red hover:text-red-light transition-colors">Clear All</button>
						{/if}
					</div>
					<div class="px-4 py-3 space-y-3 max-h-[50vh] overflow-y-auto">
						{#if pillSelected && !feedSourceId}
							<div>
								<div class="flex items-center justify-between mb-1.5">
									<span class="text-xs font-medium text-g8">Filtered by</span>
									<button onclick={() => { selectedCallerId = null; selectedChannelIds = new Set(); selectedListIds = new Set(); selectedWalletIds = new Set(); sourceRanking = null; }} class="cursor-pointer text-[10px] text-red hover:text-red-light transition-colors">clear</button>
								</div>
								<div class="rounded-lg bg-grn/10 px-2.5 py-1.5 text-[11px] font-medium text-grn ring-1 ring-grn/20">
									{getFeedSourceItems().find(s => s.id === pillSelected.id)?.name
										?? (() => { const c = calls.find(c => { const m = c.caller; return 'id' in m && String(m.id) === pillSelected.id; }); return c && 'name' in c.caller ? c.caller.name : null; })()
										?? pillSelected.id}
								</div>
							</div>
							<div class="h-px bg-bd"></div>
						{:else}
							<div>
								<div class="flex items-center justify-between mb-1.5">
									<span class="text-xs font-medium text-g8">Source</span>
									{#if feedSourceId}
										<button onclick={() => { feedSourceId = null; }} class="cursor-pointer text-[10px] text-red hover:text-red-light transition-colors">clear</button>
									{/if}
								</div>
								<input type="text" placeholder="Search..." bind:value={feedSourceSearch} oninput={handleFeedSourceSearch} class="mb-2 w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
								<div
									class="max-h-32 space-y-0.5 overflow-y-auto"
									onscroll={(e) => {
										if (!feedSourceHasMore || feedSourceLoadingMore) return;
										const el = e.currentTarget;
										if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) fetchFeedSources(feedSourceSearch, false);
									}}
								>
									{#each getFeedSourceItems() as src (src.id)}
										{@const active = feedSourceId === src.id}
										<button
											onclick={() => { feedSourceId = active ? null : src.id; }}
											class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium transition-all {active
												? 'bg-grn/10 text-grn ring-1 ring-grn/20'
												: 'text-g6 hover:bg-wh/5 hover:text-g9'}"
										>
											<span class="truncate">{src.name}</span>
											{#if active}<Check class="h-3 w-3 shrink-0" strokeWidth={2.5} />{/if}
										</button>
									{/each}
									{#if feedSourceLoading || feedSourceLoadingMore}
										<div class="py-1.5 text-center text-[10px] text-g4">Loading...</div>
									{/if}
								</div>
							</div>
							<div class="h-px bg-bd"></div>
						{/if}
						{#if activeTab === 'Wallets'}
							<div>
								<span class="text-xs font-medium text-g8 mb-1.5 block">Swap Type</span>
								<div class="flex gap-1">
									<button
										onclick={() => { feedSwapType = null; }}
										class="flex-1 cursor-pointer rounded-lg border py-1.5 text-[11px] font-semibold transition-all {feedSwapType === null ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}"
									>
										All
									</button>
									<button
										onclick={() => { feedSwapType = 'BUY'; }}
										class="flex-1 cursor-pointer rounded-lg border py-1.5 text-[11px] font-semibold transition-all {feedSwapType === 'BUY' ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd text-g6 hover:text-g9'}"
									>
										Buys
									</button>
									<button
										onclick={() => { feedSwapType = 'SELL'; }}
										class="flex-1 cursor-pointer rounded-lg border py-1.5 text-[11px] font-semibold transition-all {feedSwapType === 'SELL' ? 'border-red/40 bg-red/10 text-red' : 'border-bd text-g6 hover:text-g9'}"
									>
										Sells
									</button>
								</div>
							</div>
						{/if}
						<div>
							<span class="text-xs font-medium text-g8 mb-1.5 block">Market Cap</span>
							<div class="flex items-center gap-2">
								<input type="number" placeholder="Min" value={feedMinMcap} oninput={(e) => { feedMinMcap = e.currentTarget.value; }} class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
								<span class="text-[10px] text-g1 shrink-0">to</span>
								<input type="number" placeholder="Max" value={feedMaxMcap} oninput={(e) => { feedMaxMcap = e.currentTarget.value; }} class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
							</div>
						</div>
						<div>
							<span class="text-xs font-medium text-g8 mb-1.5 block">Multiplier (ATH)</span>
							<div class="flex items-center gap-2">
								<input type="number" placeholder="Min" value={feedMinMultiplier} oninput={(e) => { feedMinMultiplier = e.currentTarget.value; }} class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
								<span class="text-[10px] text-g1 shrink-0">to</span>
								<input type="number" placeholder="Max" value={feedMaxMultiplier} oninput={(e) => { feedMaxMultiplier = e.currentTarget.value; }} class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
							</div>
						</div>
						<div>
							<span class="text-xs font-medium text-g8 mb-1.5 block">Token Price</span>
							<div class="flex items-center gap-2">
								<input type="number" placeholder="Min" value={feedMinPrice} oninput={(e) => { feedMinPrice = e.currentTarget.value; }} class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
								<span class="text-[10px] text-g1 shrink-0">to</span>
								<input type="number" placeholder="Max" value={feedMaxPrice} oninput={(e) => { feedMaxPrice = e.currentTarget.value; }} class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5" />
							</div>
						</div>
						<div>
							<span class="text-xs font-medium text-g8 mb-1.5 block">Chains</span>
							<div class="flex gap-1.5">
								{#each chains as c}
									{@const active = feedChains.includes(c)}
									<button
										onclick={() => { feedChains = active ? feedChains.filter(ch => ch !== c) : [...feedChains, c]; }}
										class="cursor-pointer flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all {active
											? 'bg-grn/10 text-grn ring-1 ring-grn/20'
											: 'bg-s7 text-g4 ring-1 ring-bd hover:text-g7'}"
									>{c}</button>
								{/each}
							</div>
						</div>
					</div>
					<div class="border-t border-s7 px-4 py-2.5">
						<button
							onclick={applyFeedFilters}
							class="w-full cursor-pointer rounded-lg bg-grn py-2 text-xs font-bold text-s0 transition-all"
						>Apply Filters</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="flex flex-1 flex-col overflow-hidden transition-all {showFeedFilter ? 'blur-[2px] opacity-60 pointer-events-none' : ''}">
		{#if sourceRanking}
			{@const r = sourceRanking}
			{@const topCall = r.topCall ?? r.topCalls[0]}
			{@const sortedBuckets = [...r.multiplierBuckets].map(b => parseTier(b.tier) < 0 && b.count === 0 ? { ...b, count: r.losses } : b).sort((a, b) => parseTier(b.tier) - parseTier(a.tier))}
			{@const maxBucketCount = Math.max(1, ...sortedBuckets.map((bucket) => bucket.count))}

			{@const maxTopCallMultiplier = Math.max(1, ...r.topCalls.map((call) => call.multiplier))}
			{@const srcPhotoId = 'photoId' in r.source ? r.source.photoId : undefined}
			{@const rankWalletAddr = getWalletAddress(r.source as Record<string, unknown>)}
			<!-- Desktop -->
			<div class="hidden md:block border-b border-bd bg-s2 px-3 py-3">
				<div class="flex items-start justify-between gap-2">
					<div class="flex items-center gap-2 min-w-0">
						{#if avatarUrl(srcPhotoId)}
							<img src={avatarUrl(srcPhotoId)} alt="" class="h-6 w-6 shrink-0 rounded-full object-cover transition-transform duration-200 hover:scale-[2.5] hover:z-10 hover:ring-1 hover:ring-bd" />
						{:else if rankWalletAddr}
							<img src={getWalletIconUrl(rankWalletAddr)} alt="" class="h-6 w-6 shrink-0 rounded-full transition-transform duration-200 hover:scale-[2.5] hover:z-10 hover:ring-1 hover:ring-bd" />
						{/if}
						<div class="min-w-0">
							<div class="text-[10px] font-medium uppercase tracking-wider text-g5">Performance Ranking</div>
							<div class="mt-0.5 truncate text-sm font-semibold text-tx">{r.source.name}</div>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-1.5">
						<button onclick={cycleRankTimeframe} class="cursor-pointer rounded bg-s7 px-1.5 py-0.5 text-[10px] font-medium uppercase text-g6 transition-colors hover:text-tx">{r.timeframe}</button>
						<button
							onclick={() => (rankingCollapsed = !rankingCollapsed)}
							class="cursor-pointer text-g4 transition-colors hover:text-tx"
							aria-label={rankingCollapsed ? 'Expand ranking' : 'Collapse ranking'}
						>
							<ChevronDown class="h-3.5 w-3.5 transition-transform duration-200 {rankingCollapsed ? 'rotate-180' : ''}" />
						</button>
						<button onclick={() => { selectedCallerId = null; selectedChannelIds = new Set(); selectedListIds = new Set(); selectedWalletIds = new Set(); sourceRanking = null; fetchCalls(); }} class="cursor-pointer text-g4 transition-colors hover:text-tx">
							<X class="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
				<div class="mt-2 flex items-center gap-2">
					<StarRating score={r.performanceScore} size={10} />
					<span class="text-[10px] text-g5">{r.performanceScore}/30</span>
				</div>
				{#if !rankingCollapsed}
				<div class="mt-3 grid grid-cols-4 gap-x-2 gap-y-2">
					<div>
						<div class="text-[10px] text-g5">Calls</div>
						<div class="text-sm font-semibold text-tx">{r.totalCalls}</div>
					</div>
					<div>
						<div class="text-[10px] text-g5">Win Ratio</div>
						<div class="text-sm font-semibold {r.winRatePct >= 50 ? 'text-grn' : r.winRatePct > 0 ? 'text-yel' : 'text-red'}">{r.winRatePct.toFixed(0)}%</div>
					</div>
					<div>
						<div class="text-[10px] text-g5">Wins</div>
						<div class="text-sm font-semibold text-tx">{r.wins}</div>
					</div>
					<div>
						<div class="text-[10px] text-g5">Losses</div>
						<div class="text-sm font-semibold text-tx">{r.losses}</div>
					</div>
					<div>
						<div class="text-[10px] text-g5">Highest Return</div>
						<div class="text-sm font-semibold text-grn">{r.highestMultiplier.toFixed(2)}x</div>
					</div>
					<div>
						<div class="text-[10px] text-g5">Average Return</div>
						<div class="text-sm font-semibold text-grn">{r.averageMultiplier.toFixed(2)}x</div>
					</div>
					<div class="col-span-2 min-w-0">
						<div class="text-[10px] text-g5">Top Call</div>
						{#if topCall}
							<a href="/?chain={topCall.token.chain}&token={topCall.token.address}" class="block truncate text-sm font-semibold text-grn hover:underline">{topCall.token.symbol} <span class="text-g6">{topCall.multiplier.toFixed(2)}x</span></a>
						{:else}
							<div class="text-sm text-g4">—</div>
						{/if}
					</div>
				</div>
				{#if sortedBuckets.length > 0}
					<div class="mt-3 border-t border-bd/60 pt-2">
						<div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-g5">Return Distribution</div>
						<div class="flex items-end gap-1">
							{#each sortedBuckets as bucket}
								{@const isLoss = parseTier(bucket.tier) < 0}
								{@const height = Math.max(12, (bucket.count / maxBucketCount) * 100)}
								<div class="flex min-w-0 flex-1 flex-col items-center gap-0.5">
									<span class="text-[9px] font-medium text-g6">{bucket.count}</span>
									<div class="flex h-8 w-full items-end rounded-sm bg-s7">
										<div class="w-full rounded-sm {isLoss ? 'bg-red' : 'bg-grn'}" style="height: {height}%; opacity: {0.45 + (bucket.count / maxBucketCount) * 0.55};"></div>
									</div>
									<span class="max-w-full truncate text-[9px] font-medium text-g6">{bucket.tier}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if r.topCalls.length > 0}
					<div class="mt-3 border-t border-bd/60 pt-2">
						<div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-g5">Top Calls</div>
						<div class="flex h-20 items-end gap-1">
							{#each r.topCalls.slice(0, 6) as call}
								{@const height = Math.max(12, (call.multiplier / maxTopCallMultiplier) * 100)}
								<a href="/?chain={call.token.chain}&token={call.token.address}" class="group/topcall flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5">
									<span class="text-[9px] font-semibold text-tx opacity-0 transition-opacity group-hover/topcall:opacity-100">{call.multiplier.toFixed(1)}x</span>
									<div class="flex h-12 w-full items-end rounded-sm bg-s7">
										<div class="w-full rounded-sm bg-grn transition-all group-hover/topcall:bg-grn" style="height: {height}%;"></div>
									</div>
									<span class="w-full truncate text-center text-[9px] text-g6">{call.token.symbol}</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
				{/if}
			</div>
			<!-- Mobile -->
			<div class="md:hidden border-b border-bd bg-s2 px-3 py-2">
				<div class="flex items-center justify-between gap-2">
					<div class="flex min-w-0 items-center gap-2">
						{#if avatarUrl(srcPhotoId)}
							<img src={avatarUrl(srcPhotoId)} alt="" class="h-6 w-6 shrink-0 rounded-full object-cover transition-transform duration-200 hover:scale-[2.5] hover:z-10 hover:ring-1 hover:ring-bd" />
						{:else if rankWalletAddr}
							<img src={getWalletIconUrl(rankWalletAddr)} alt="" class="h-6 w-6 shrink-0 rounded-full transition-transform duration-200 hover:scale-[2.5] hover:z-10 hover:ring-1 hover:ring-bd" />
						{/if}
						<div class="truncate text-xs font-semibold text-tx">{r.source.name}</div>
						<button onclick={cycleRankTimeframe} class="shrink-0 cursor-pointer rounded bg-s7 px-1 py-px text-[9px] font-medium uppercase text-g6 transition-colors hover:text-tx">{r.timeframe}</button>
					</div>
					<div class="flex shrink-0 items-center gap-1.5">
						<StarRating score={r.performanceScore} size={8} />
						<span class="text-[9px] text-g5">{r.performanceScore}/30</span>
						<button onclick={() => { selectedCallerId = null; selectedChannelIds = new Set(); selectedListIds = new Set(); selectedWalletIds = new Set(); sourceRanking = null; fetchCalls(); }} class="cursor-pointer text-g4 transition-colors hover:text-tx">
							<X class="h-3 w-3" />
						</button>
					</div>
				</div>
				<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
					<span class="text-g5">{r.totalCalls} calls</span>
					<span class="{r.winRatePct >= 50 ? 'text-grn' : r.winRatePct > 0 ? 'text-yel' : 'text-red'} font-semibold">{r.winRatePct.toFixed(0)}%</span>
					<span class="text-g5"><span class="text-grn">{r.wins}W</span> / <span class="text-red">{r.losses}L</span></span>
					<span class="text-g5">Avg <span class="font-semibold text-tx">{r.averageMultiplier.toFixed(1)}x</span></span>
					<span class="text-g5">Best <span class="font-semibold text-grn">{r.highestMultiplier.toFixed(1)}x</span></span>
					{#if topCall}
						<a href="/?chain={topCall.token.chain}&token={topCall.token.address}" class="text-g5 hover:text-tx">Top <span class="font-semibold text-grn">{topCall.token.symbol}</span> <span class="text-g6">{topCall.multiplier.toFixed(1)}x</span></a>
					{/if}
				</div>
				{#if sortedBuckets.length > 0}
					<div class="mt-1.5 flex items-end gap-0.5">
						{#each sortedBuckets as bucket}
							{@const isLoss = parseTier(bucket.tier) < 0}
							{@const height = Math.max(12, (bucket.count / maxBucketCount) * 100)}
							<div class="flex min-w-0 flex-1 flex-col items-center gap-px">
								<span class="text-[8px] text-g6">{bucket.count}</span>
								<div class="flex h-5 w-full items-end rounded-sm bg-s7">
									<div class="w-full rounded-sm {isLoss ? 'bg-red' : 'bg-grn'}" style="height: {height}%; opacity: {0.45 + (bucket.count / maxBucketCount) * 0.55};"></div>
								</div>
								<span class="max-w-full truncate text-[7px] text-g6">{bucket.tier}</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if r.topCalls.length > 0}
					<div class="mt-1.5 flex flex-wrap gap-1">
						{#each r.topCalls.slice(0, 5) as call}
							<a href="/?chain={call.token.chain}&token={call.token.address}" class="rounded bg-s7 px-1.5 py-0.5 text-[9px] text-g7 transition-colors hover:text-tx">
								{call.token.symbol} <span class="{call.multiplier >= 1 ? 'text-grn' : 'text-red'}">{call.multiplier.toFixed(1)}x</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		{#if loading}
			<div class="space-y-1 p-2">
				{#each Array(8) as _}
					<div class="skeleton h-14 rounded-lg"></div>
				{/each}
			</div>
		{:else if filteredCalls.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-1.5 p-4">
				<div class="flex h-8 w-8 items-center justify-center rounded-xl bg-s4 ring-1 ring-bd">
					<Bell class="h-4 w-4 text-g5" strokeWidth={1.5} />
				</div>
				<span class="text-sm text-g6">No calls found</span>
				<span class="text-xs text-g6">
					{#if activeTab === 'Callers'}
						Caller watchlist is empty
					{:else if activeTab === 'Telegram'}
						No calls from your channels yet
					{:else if activeTab === 'Lists'}
						Add tokens to your watchlist
					{:else}
						Set up copy trade wallets
					{/if}
				</span>
			</div>
		{:else if showBubbles}
			<div class="flex shrink-0 items-center gap-1.5 border-b border-bd px-3 py-1.5">
				<span class="text-[10px] font-medium uppercase tracking-wider text-g5">{callBubbles.length} tokens</span>
				<div class="ml-auto flex items-center gap-1">
					<div class="flex gap-0.5 rounded-md bg-s4 p-0.5">
						<button
							onclick={() => (bubbleSort = 'count')}
							class="flex cursor-pointer items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold transition-colors {bubbleSort === 'count' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
							title="Sort by call count"
						>
							<Hash class="h-3 w-3" /> Calls
						</button>
						<button
							onclick={() => (bubbleSort = 'recent')}
							class="flex cursor-pointer items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold transition-colors {bubbleSort === 'recent' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
							title="Sort by most recent"
						>
							<Clock class="h-3 w-3" /> Recent
						</button>
					</div>
					<button
						onclick={() => (bubbleViewActive = false)}
						class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-s7 text-g7 transition-colors hover:bg-s6 hover:text-tx"
						title="Switch to list view"
					>
						<List class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
			<div class="flex-1 overflow-y-auto" bind:this={callsScrollEl} onscroll={handleCallsScroll}>
				<div class="flex flex-wrap content-start items-center justify-center gap-3 p-4">
					{#each callBubbles as b (b.key)}
						{@const sz = bubbleSize(b.count)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							onclick={() => (bubbleDrillToken = b.key)}
							class="group/bubble bubble-inner relative flex cursor-pointer flex-col items-center justify-center rounded-full ring-1 {b.isNew ? 'bubble-arrive ring-2 ring-blu' : b.avgMultiplier >= 1 ? 'ring-grn/40' : 'ring-red/40'}"
							style="width: {sz}px; height: {sz}px; background: {b.avgMultiplier >= 1 ? 'color-mix(in srgb, var(--t-grn) 12%, var(--t-s2))' : 'color-mix(in srgb, var(--t-red) 12%, var(--t-s2))'};"
							title="{b.symbol} · {b.count} call{b.count === 1 ? '' : 's'} · avg {formatMultiplier(b.avgMultiplier)}"
						>
							{#if b.isNew}
								<span class="absolute -top-1 left-1/2 z-20 -translate-x-1/2 rounded-full bg-blu px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-s0 shadow">New</span>
							{/if}
							<img src={b.image} alt="" class="absolute inset-0 h-full w-full rounded-full object-cover opacity-30" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
							<span class="relative z-10 font-bold leading-none text-tx" style="font-size: {Math.max(9, sz * 0.18)}px;">{formatMultiplier(b.avgMultiplier)}</span>
							{#if b.mcapStr && sz >= 56}
								<span class="relative z-10 mt-0.5 leading-none text-g8" style="font-size: {Math.max(7, sz * 0.11)}px;">{formatMarketCap(b.mcapStr)}</span>
							{/if}
							<span class="relative z-10 mt-0.5 max-w-[85%] truncate font-medium leading-none text-g8" style="font-size: {Math.max(8, sz * 0.13)}px;">{b.symbol}</span>
							<span class="absolute -bottom-1 -right-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-s5 px-1 text-[10px] font-bold text-tx ring-1 ring-bd">{b.count}</span>
						</div>
					{/each}
				</div>
				{#if loadingMore}
					<div class="flex items-center justify-center gap-2 py-3">
						<div class="h-3.5 w-3.5 rounded-full border-2 border-g1 border-t-grn animate-spin"></div>
						<span class="text-[11px] text-g5">Loading more...</span>
					</div>
				{:else if hasMore}
					<div class="py-2 text-center text-[11px] text-g3">Scroll for more</div>
				{/if}
			</div>
		{:else}
			<div class="flex-1 overflow-y-auto" bind:this={callsScrollEl} onscroll={handleCallsScroll}>
			{#if bubbleDrillToken}
				<button onclick={() => (bubbleDrillToken = null)} class="flex w-full cursor-pointer items-center gap-1.5 border-b border-bd bg-s1 px-3 py-2 text-xs font-medium text-g7 transition-colors hover:text-tx">
					<ChevronDown class="h-3.5 w-3.5 rotate-90" /> Back to bubbles
				</button>
			{:else if getBubbleWatchlist() && !bubbleViewActive}
				<button onclick={() => (bubbleViewActive = true)} class="flex w-full cursor-pointer items-center gap-1.5 border-b border-bd bg-s1 px-3 py-2 text-xs font-medium text-g7 transition-colors hover:text-tx">
					<LayoutGrid class="h-3.5 w-3.5" /> Back to bubbles
				</button>
			{/if}
			{#each (bubbleDrillToken ? drilledCalls : filteredCalls) as call (call.id)}
				{@const d = call.callDetails}
				{@const m = call.caller}
				{@const flash = flashMap.get(d.pairAddress)}
				{@const isActive = d.baseTokenAddress === selectedAddress}
				{@const pid = 'photoId' in m ? m.photoId : undefined}
				{@const callWalletAddr = getWalletAddress(m as Record<string, unknown>)}
				<div class="flex border-b border-b-bd/20 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_84px] {isActive ? 'border-l-2 border-l-grn bg-grn/10' : ''}">
					<a
						href="/?chain={d.chain}&token={d.baseTokenAddress}"
						onclick={onnavigate}
						class="flex flex-1 min-w-0 flex-col gap-1 px-3 py-2 transition-colors hover:bg-wh/5"
					>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-1.5 min-w-0">
								<span class="text-sm font-medium text-tx">{d.baseTokenSymbol ?? '?'}</span>
								<span class="truncate text-xs text-g6">{d.baseTokenName ?? ''}</span>
							</div>
							<div class="flex items-center gap-1.5 shrink-0">
								{#if d.athMultiplier}
									<span class="text-sm font-semibold {multiplierColor(d.athMultiplier)} {flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}">
										{formatMultiplier(d.athMultiplier)}
									</span>
								{/if}
								{#if d.rugged}
									<span class="rounded bg-red/20 px-1 py-0.5 text-[11px] text-red">RUG</span>
								{/if}
							</div>
						</div>
						<div class="group/caller flex items-center justify-between text-xs">
						<div class="flex items-center gap-1 min-w-0">
							{#if avatarUrl(pid)}
								<img src={avatarUrl(pid)} alt="" class="h-5 w-5 shrink-0 rounded-full object-cover" />
							{:else if callWalletAddr}
								<img src={getWalletIconUrl(callWalletAddr)} alt="" class="h-5 w-5 shrink-0 rounded-full" />
							{:else}
								<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-s7 text-[9px] font-bold text-g11">{'name' in m ? (m.name?.[0]?.toUpperCase() ?? '?') : '?'}</div>
							{/if}
							{#if m.type === 'WALLET' && 'walletAddress' in m && 'chain' in m}
								<span
									class="group/wallet flex items-center gap-1 text-g7 hover:text-grn hover:underline transition-colors cursor-pointer"
									role="link"
									tabindex="0"
									onclick={(e) => { e.stopPropagation(); e.preventDefault(); openCallerView(call); }}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCallerView(call); } }}
								>
									{'name' in m && m.name ? m.name : shortAddress(m.walletAddress)}
									<span
										class="text-g5 opacity-0 transition-opacity group-hover/wallet:opacity-100"
										onclick={(e) => { e.stopPropagation(); e.preventDefault(); window.open(explorerAddressUrl(m.chain, m.walletAddress), '_blank', 'noopener'); }}
										onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); window.open(explorerAddressUrl(m.chain, m.walletAddress), '_blank', 'noopener'); } }}
										role="link"
										tabindex="0"
										title="Open wallet"
									>
										<ExternalLink class="h-2.5 w-2.5" strokeWidth={2} />
									</span>
								</span>
								{:else if 'name' in m && m.name}
									<span
										class="cursor-pointer text-g7 hover:text-g9 hover:underline"
										onclick={(e) => { e.stopPropagation(); e.preventDefault(); openCallerView(call); }}
										onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCallerView(call); } }}
										role="link"
										tabindex="0"
									>{m.name}</span>
								{:else if 'id' in m}
									<span
										class="cursor-pointer text-g7 hover:text-g9 hover:underline"
										onclick={(e) => { e.stopPropagation(); e.preventDefault(); openCallerView(call); }}
										onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCallerView(call); } }}
										role="link"
										tabindex="0"
									>{shortAddress(String(m.id))}</span>
								{/if}
							</div>
							<span class="text-g6 shrink-0 cursor-help" title={fullDateTime(d.calledAtTimestamp)}>{timeAgo(d.calledAtTimestamp, getNow())}</span>
						</div>
						{#if m.type === 'WALLET' && 'side' in m}
							<div class="flex items-center gap-2 text-[11px]">
								<span class="rounded px-1.5 py-0.5 text-[10px] font-bold {m.side === 'BUY' ? 'bg-grn/10 text-grn' : 'bg-red/10 text-red'}">{m.side}</span>
								{#if 'amountUsd' in m}
									<span class="text-tx font-medium">{formatUsd(m.amountUsd)}</span>
								{/if}
								{#if 'amountToken' in m && 'token' in m}
									<span class="text-g5 truncate">{formatCompactNumber(m.amountToken)} {(m.token as {symbol?: string}).symbol ?? ''}</span>
								{/if}
								{#if 'priceUsd' in m}
									<span class="text-g4 ml-auto shrink-0">@ {formatPriceText(m.priceUsd)}</span>
								{/if}
							</div>
						{/if}
						<div class="flex items-center justify-between text-xs">
						<span class="text-g7">Called at <CurrencyValue usd={d.marketCapAtCallUsd} native={d.marketCapAtCallNative} chain={d.chain} mode="value" iconClass="h-3 w-3 text-g7" /></span>
						<span class="text-g7 {flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}">MCap <CurrencyValue usd={d.marketCapUsd} native={d.marketCapNative} chain={d.chain} mode="value" iconClass="h-3 w-3 text-g7" /></span>
						</div>
						{#if d.currentMultiplier}
							<div class="flex items-center justify-between text-xs">
								<span class="{multiplierColor(d.currentMultiplier)} {flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}">Now {formatMultiplier(d.currentMultiplier)}</span>
								<div class="flex items-center gap-1.5">
									<span class="text-g6">ATH <CurrencyValue usd={d.athMarketCapUsd} native={d.athMarketCapNative} chain={d.chain} mode="value" iconClass="h-3 w-3 text-g6" /></span>
									{#if getIsLoggedIn()}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span
											onclick={(e) => { e.preventDefault(); e.stopPropagation(); openBotForCall(call); }}
											class="hidden md:flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md transition-all {hasBot(call) ? getBotForCall(call)?.status === 'ACTIVE' ? 'bg-grn/10 text-grn ring-1 ring-grn/20 hover:bg-grn/20' : 'bg-red/10 text-red ring-1 ring-red/20 hover:bg-red/20' : 'text-g1 hover:text-grn'}"
											title={hasBot(call) ? getBotForCall(call)?.status === 'ACTIVE' ? 'Bot active' : 'Bot paused' : 'Create Bot'}
										>
											<BotIcon class="h-3 w-3" strokeWidth={2} />
										</span>
									{/if}
								</div>
							</div>
						{/if}
					</a>
					{#if getIsLoggedIn()}
						<div class="flex md:hidden shrink-0 flex-col items-center justify-center gap-1 border-l border-bd/30 px-2">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								onclick={(e) => { e.preventDefault(); e.stopPropagation(); openBotForCall(call); }}
								class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-all {hasBot(call) ? getBotForCall(call)?.status === 'ACTIVE' ? 'bg-grn/10 text-grn hover:bg-grn/20' : 'bg-red/10 text-red hover:bg-red/20' : 'text-g3 hover:text-grn hover:bg-wh/5'}"
								title={hasBot(call) ? getBotForCall(call)?.status === 'ACTIVE' ? 'Bot active' : 'Bot paused' : 'Create Bot'}
							>
								<BotIcon class="h-4 w-4" strokeWidth={2} />
							</span>
						</div>
					{/if}
				</div>
				{/each}
				{#if loadingMore}
					<div class="flex items-center justify-center gap-2 py-3">
						<div class="h-3.5 w-3.5 rounded-full border-2 border-g1 border-t-grn animate-spin"></div>
						<span class="text-[11px] text-g5">Loading more...</span>
					</div>
				{:else if hasMore}
					<div class="py-2 text-center text-[11px] text-g3">Scroll for more</div>
				{/if}
			</div>
		{/if}
		</div>
	{/if}
</div>

{#if showTgLoginModal}
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { showTgLoginModal = false; } }} onkeydown={(e) => { if (e.key === 'Escape') showTgLoginModal = false; }}>
		<div class="relative mx-4 w-full max-w-sm rounded-2xl border border-bd bg-s5 p-6 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<button onclick={() => { showTgLoginModal = false; }} class="absolute right-4 top-4 cursor-pointer text-g4 transition-colors hover:text-tx">
				<X class="h-4 w-4" />
			</button>

			<div class="mb-4 flex items-center gap-2">
				<MessageCircle class="h-5 w-5 text-grn" strokeWidth={1.5} />
				<h2 class="text-base font-semibold text-tx">Connect Telegram</h2>
			</div>
			<p class="mb-4 text-xs text-g7">Link your Telegram account to receive call alerts from your groups and channels.</p>

			<TgLoginForm onsuccess={() => { tgLoggedIn = true; showTgLoginModal = false; fetchTgChats().then(() => { if (enabledChats.length === 0) showChannelModal = true; }); }} />
		</div>
	</div>
{/if}

{#if showChannelModal}
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { showChannelModal = false; tgChatSearch = ''; } }} onkeydown={(e) => { if (e.key === 'Escape') { showChannelModal = false; tgChatSearch = ''; } }}>
		<div class="relative mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-bd px-6 py-4">
				<div class="flex items-center gap-2">
					<MessageCircle class="h-5 w-5 text-grn" strokeWidth={1.5} />
					<h2 class="text-base font-semibold text-tx">Telegram Channels</h2>
				</div>
				<div class="flex items-center gap-2">
					<button
						onclick={syncTgChats}
						disabled={tgSyncing}
						class="flex cursor-pointer items-center gap-1 rounded-lg bg-s7 px-2.5 py-1.5 text-xs font-medium text-g7 transition-colors hover:text-tx disabled:opacity-50"
					>
						<RefreshCw class="h-3 w-3 {tgSyncing ? 'animate-spin' : ''}" strokeWidth={1.5} />
						{tgSyncing ? 'Syncing' : 'Sync'}
					</button>
					<button onclick={() => { showChannelModal = false; }} class="cursor-pointer text-g4 transition-colors hover:text-tx">
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto p-4">
				{#if tgChatsLoading}
					<div class="space-y-2">
						{#each Array(5) as _, i}
							<div class="skeleton h-12 rounded-lg" style="animation-delay: {i * 60}ms"></div>
						{/each}
					</div>
				{:else if tgChats.length === 0}
					<div class="flex flex-col items-center gap-2 py-8 text-center">
						<span class="text-sm text-g6">No chats found</span>
						<span class="text-xs text-g4">Click "Sync" to fetch your Telegram groups and channels</span>
					</div>
				{:else}
					{@const filteredTgChats = tgChats.filter(c => !tgChatSearch || c.chatName?.toLowerCase().includes(tgChatSearch.toLowerCase()))}
					<input type="text" bind:value={tgChatSearch} placeholder="Search channels..." class="mb-3 w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-sm text-tx placeholder-g4 outline-none focus:border-grn" />
					<div class="space-y-1">
						{#each filteredTgChats as chat (chat.chatId)}
							<div class="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-wh/5">
								<div class="flex items-center gap-2.5 min-w-0">
									{#if avatarUrl(chat.photoId)}
										<img src={avatarUrl(chat.photoId)} alt="" loading="lazy" class="h-8 w-8 shrink-0 rounded-full object-cover" />
									{:else}
										<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-s7 text-xs font-bold text-g11">
											{chat.chatName?.[0]?.toUpperCase() ?? '#'}
										</div>
									{/if}
									<div class="min-w-0">
										<div class="truncate text-sm font-medium text-tx">{chat.chatName}</div>
										<div class="flex items-center gap-1.5 text-[11px] text-g5">
											<span>{chat.chatType}</span>
											{#if chat.isSuperGroup}
												<span class="rounded bg-s7 px-1 py-0.5 text-g6">supergroup</span>
											{/if}
											{#if chat.pendingTask}
												<span class="rounded bg-yel/10 px-1 py-0.5 text-yel">syncing</span>
											{/if}
										</div>
									</div>
								</div>
								<div class="flex items-center gap-2 shrink-0">
									<button
										onclick={() => openEditModal(chat)}
										class="cursor-pointer rounded-md p-1 text-g4 transition-colors hover:bg-s7 hover:text-tx"
										title="Edit filters"
									>
										<Filter class="h-3.5 w-3.5" strokeWidth={1.5} />
									</button>
								<button
									aria-label="Toggle channel"
									class="relative h-5 w-9 cursor-pointer rounded-full transition-colors {chat.isEnabled ? 'bg-grn' : 'bg-bd2'}"
									onclick={() => toggleChat(chat.chatId, !chat.isEnabled)}
								>
										<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {chat.isEnabled ? 'left-[18px]' : 'left-0.5'}"></div>
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if showEditModal && editChat}
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { showEditModal = false; editChat = null; } }} onkeydown={(e) => { if (e.key === 'Escape') { showEditModal = false; editChat = null; } }}>
		<div class="relative mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-bd px-6 py-4">
				<div class="min-w-0">
					<h2 class="truncate text-base font-semibold text-tx">{editChat.chatName}</h2>
					<span class="text-xs text-g5">Filter Settings</span>
				</div>
				<button onclick={() => { showEditModal = false; editChat = null; }} class="cursor-pointer text-g4 transition-colors hover:text-tx">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="flex-1 space-y-4 overflow-y-auto p-6">
				<div>
					<span class="mb-2 block text-xs font-medium text-g7">Message Types</span>
					<div class="grid grid-cols-2 gap-2">
						{#each [
							{ label: 'Users', get: () => editFilterUsers, set: (v: boolean) => editFilterUsers = v },
							{ label: 'Admins', get: () => editFilterAdmin, set: (v: boolean) => editFilterAdmin = v },
							{ label: 'Bots', get: () => editFilterBot, set: (v: boolean) => editFilterBot = v },
							{ label: 'Forwarded', get: () => editFilterForwarded, set: (v: boolean) => editFilterForwarded = v },
							{ label: 'Pinned', get: () => editFilterPinned, set: (v: boolean) => editFilterPinned = v },
							{ label: 'Replies', get: () => editFilterReply, set: (v: boolean) => editFilterReply = v }
						] as item}
							<button
								onclick={() => item.set(!item.get())}
								class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {item.get() ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd text-g5 hover:text-g7'}"
							>
								<div class="flex h-3.5 w-3.5 items-center justify-center rounded-sm {item.get() ? 'bg-grn' : 'border border-g1'}">
									{#if item.get()}
										<Check class="h-2.5 w-2.5 text-s0" strokeWidth={3} />
									{/if}
								</div>
								{item.label}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<span class="mb-2 block text-xs font-medium text-g7">Topics {editSelectedTopics.length > 0 ? `(${editSelectedTopics.length})` : '(all)'}</span>
					{#if editLoadingTopics}
						<div class="space-y-1">
							{#each Array(3) as _}
								<div class="skeleton h-8 rounded-md"></div>
							{/each}
						</div>
					{:else if editTopics.length === 0}
						<span class="text-xs text-g4">No topics available</span>
					{:else}
						<div class="flex flex-wrap gap-1.5">
							{#each editTopics as topic (topic.topicId)}
								{@const selected = editSelectedTopics.some(t => t.topicId === topic.topicId)}
								<button
									onclick={() => toggleEditTopic(topic)}
									class="cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors {selected ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd text-g6 hover:text-g9'}"
								>
									{topic.topicName}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<div>
					<span class="mb-2 block text-xs font-medium text-g7">Senders {editSelectedSenders.length > 0 ? `(${editSelectedSenders.length})` : '(all)'}</span>
					{#if editLoadingSenders}
						<div class="space-y-1">
							{#each Array(3) as _}
								<div class="skeleton h-8 rounded-md"></div>
							{/each}
						</div>
					{:else if editSenders.length === 0}
						<span class="text-xs text-g4">No senders available</span>
					{:else}
						<div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
							{#each editSenders as sender (sender.senderId)}
								{@const selected = editSelectedSenders.some(s => s.senderId === sender.senderId)}
								<button
									onclick={() => toggleEditSender(sender)}
									class="cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors {selected ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd text-g6 hover:text-g9'}"
								>
									{sender.senderName}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-bd px-6 py-4">
				<button
					onclick={() => { showEditModal = false; editChat = null; }}
					class="cursor-pointer rounded-lg border border-bd px-4 py-2 text-sm text-g6 transition-colors hover:text-tx"
				>
					Cancel
				</button>
				<button
					onclick={saveFilter}
					disabled={editSaving}
					class="btn-primary px-5 py-2 text-sm"
				>
					{editSaving ? 'Saving...' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if UserListModal}
	<UserListModal bind:show={showListModal} editList={listModalEditList} onsaved={fetchUserLists} />
{/if}


{#if showCtWalletModal}
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { showCtWalletModal = false; } }} onkeydown={(e) => { if (e.key === 'Escape') showCtWalletModal = false; }}>
		<div class="relative mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-bd px-6 py-4">
				<div class="flex items-center gap-2">
					<Wallet class="h-5 w-5 text-grn" strokeWidth={1.5} />
					<h2 class="text-base font-semibold text-tx">Wallets</h2>
				</div>
				<div class="flex items-center gap-2">
					<button
						onclick={() => { showCtWalletModal = false; openAddWallet(); }}
						class="flex cursor-pointer items-center gap-1 rounded-lg bg-s7 px-2.5 py-1.5 text-xs font-medium text-grn transition-colors hover:bg-s6"
					>
						<Plus class="h-3 w-3" strokeWidth={2} />
						Add
					</button>
					<button onclick={() => { showCtWalletModal = false; }} class="cursor-pointer text-g4 transition-colors hover:text-tx">
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto p-4">
				{#if ctWalletsLoading}
					<div class="space-y-2">
						{#each Array(5) as _, i}
							<div class="skeleton h-12 rounded-lg" style="animation-delay: {i * 60}ms"></div>
						{/each}
					</div>
				{:else if ctWallets.length === 0}
					<div class="flex flex-col items-center gap-2 py-8 text-center">
						<span class="text-sm text-g6">No wallets tracked</span>
						<span class="text-xs text-g4">Add wallet addresses to start copy trading</span>
					</div>
				{:else}
					<div class="space-y-1">
						{#each ctWallets as wallet (wallet.id)}
							<div class="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-wh/5">
								<div class="flex items-center gap-2.5 min-w-0">
									<img src={getWalletIconUrl(wallet.walletAddress)} alt="" class="h-8 w-8 shrink-0 rounded-full" />
									<div class="min-w-0">
										<div class="truncate text-sm font-medium text-tx">{wallet.name}</div>
										<div class="flex items-center gap-1.5 text-[11px] text-g5">
											<ChainIcon chain={wallet.chain} class="h-3 w-3" />
											<span class="truncate max-w-[120px]">{shortAddress(wallet.walletAddress)}</span>
										</div>
									</div>
								</div>
								<button
									onclick={() => deleteCtWallet(wallet.id)}
									class="shrink-0 cursor-pointer rounded-md p-1.5 text-g4 transition-colors hover:bg-s7 hover:text-red"
									title="Remove wallet"
								>
									<Trash2 class="h-3.5 w-3.5" strokeWidth={1.5} />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if CreateBotModal}
	<CreateBotModal bind:show={showCreateBot} source={botSource} editBot={editingBot} oncreated={() => { botsFetched = false; fetchBots(); }} onupdated={() => { botsFetched = false; fetchBots(); }} />
{/if}

{#if showCtAddModal}
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { showCtAddModal = false; resetCtForm(); } }} onkeydown={(e) => { if (e.key === 'Escape') { showCtAddModal = false; resetCtForm(); } }}>
		<div class="relative mx-4 w-full max-w-sm rounded-2xl border border-bd bg-s5 p-6 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<button onclick={() => { showCtAddModal = false; resetCtForm(); }} class="absolute right-4 top-4 cursor-pointer text-g4 transition-colors hover:text-tx">
				<X class="h-4 w-4" />
			</button>

			<div class="mb-4 flex items-center gap-2">
				<Wallet class="h-5 w-5 text-grn" strokeWidth={1.5} />
				<h2 class="text-base font-semibold text-tx">Add Wallet</h2>
			</div>
			<p class="mb-4 text-xs text-g7">Track a wallet address to copy trade and see their calls in your feed.</p>

			<div class="space-y-3">
				<div>
					<label class="mb-1 block text-xs text-g7" for="ct-name-wl">Name</label>
					<input
						id="ct-name-wl"
						type="text"
						placeholder="Whale wallet..."
						bind:value={ctName}
						class="w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-sm text-tx placeholder-g4 outline-none focus:border-grn"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-g7" for="ct-chain-wl">Chain</label>
					<select id="ct-chain-wl" bind:value={ctChain} class="w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-sm text-tx outline-none">
						<option value="">Select chain</option>
						{#each chains as c}<option value={c}>{c}</option>{/each}
					</select>
				</div>
				<div>
					<label class="mb-1 block text-xs text-g7" for="ct-addr-wl">Wallet Address</label>
					<input
						id="ct-addr-wl"
						type="text"
						placeholder="0x... or base58..."
						bind:value={ctAddress}
						onkeydown={(e) => e.key === 'Enter' && saveCtWallet()}
						class="w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-sm text-tx placeholder-g4 outline-none focus:border-grn"
					/>
				</div>
				<button
					onclick={saveCtWallet}
					disabled={ctSaving || !ctName.trim() || !ctChain || !ctAddress.trim()}
					class="btn-primary w-full px-6 py-2 text-sm"
				>
					{ctSaving ? 'Adding...' : 'Add Wallet'}
				</button>
			</div>

			{#if ctError}
				<div class="mt-3 text-xs text-red">{ctError}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.bubble-inner {
		transition: transform 0.15s ease;
	}
	.bubble-inner:hover {
		transform: scale(1.05);
	}
	@keyframes bubble-arrive {
		0% { transform: scale(0.4); opacity: 0; }
		55% { transform: scale(1.12); opacity: 1; }
		100% { transform: scale(1); }
	}
	:global(.bubble-arrive) {
		animation: bubble-arrive 0.45s cubic-bezier(0.22, 1, 0.36, 1);
	}
</style>
