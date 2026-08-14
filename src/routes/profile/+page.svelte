<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import type {
		TradePreset,
		TradePresetsResponse,
		TradePresetSlot,
		TradeTargetConfig,
		TradeTargetTrigger,
		TradeSettings,
		GasPreset,
		BuyStrategy,
		ErrorResponse,
		ProfileResponse,
		ConnectedWallet,
		ManagedWallet,
		UserWalletsResponse,
		WalletAsset,
		CommissionSummaryResponse,
		FeeRateResponse,
		ReferralCodeResponse,
		UserFavouriteToken,
		Chain,
		TgManagedChat,
		PaginatedProfileResponse,
	} from '$lib/api/types';
	import { getIsLoggedIn, getWalletAddress, connectWallet, getIsConnecting, isPhantomInstalled, getAuthToken } from '$lib/stores/auth.svelte';
	import ChainIcon from '$lib/components/ChainIcon.svelte';
	import TargetCard from '$lib/components/TargetCard.svelte';
	import type { SellTargetRow, SellTargetKind } from '$lib/stores/trade.svelte';
	import TgLoginForm from '$lib/components/TgLoginForm.svelte';
	import ImageCropper from '$lib/components/ImageCropper.svelte';
	import { authenticate, subscribe, unsubscribe } from '$lib/ws/client';
	import { formatUsd, formatPrice, shortAddress, avatarUrl } from '$lib/utils/format';
	import { positivePercentTargetTrigger } from '$lib/utils/trade-targets';
	import User from 'lucide-svelte/icons/user';
	import Wallet from 'lucide-svelte/icons/wallet';
	import X from 'lucide-svelte/icons/x';
	import Heart from 'lucide-svelte/icons/heart';
	import Search from 'lucide-svelte/icons/search';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import UserMinus from 'lucide-svelte/icons/user-minus';
	import Users from 'lucide-svelte/icons/users';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import Camera from 'lucide-svelte/icons/camera';
	import CalendarDays from 'lucide-svelte/icons/calendar-days';
	import PnlCalendarModal from '$lib/components/PnlCalendarModal.svelte';
	import MobileScanModal from '$lib/components/MobileScanModal.svelte';
	import WalletWithdrawModal from '$lib/components/WalletWithdrawModal.svelte';
	import { getSettings, fetchSettings as fetchGlobalSettings, updateSetting } from '$lib/stores/settings.svelte';
	import { getProfile, fetchProfile as fetchProfileStore, setProfile } from '$lib/stores/profile.svelte';
	type ProfileTab = 'wallets' | 'settings' | 'referrals' | 'favourites' | 'social' | 'telegram';

	let activeTab = $state<ProfileTab>('wallets');
	const profile = $derived(getProfile());
	let walletsResponse = $state<UserWalletsResponse | null>(null);
	
	let commissionSummary = $state<CommissionSummaryResponse | null>(null);
	let feeRate = $state<FeeRateResponse | null>(null);
	let referralCode = $state<ReferralCodeResponse | null>(null);
	let favourites = $state<UserFavouriteToken[]>([]);
	let favouritesFetched = $state(false);
	let tcConfigsFetched = $state(false);
	let profileLoading = $state(false);
	let profilePicUploading = $state(false);
	let showCropper = $state(false);
	let showPnlCalendar = $state(false);
	let showMobileScan = $state(false);
	let walletsLoading = $state(false);
	
	let referralLoading = $state(false);
	let favouritesLoading = $state(false);
	
	let usernameInput = $state('');
	let usernameError = $state('');
	let usernameSaving = $state(false);
	let referrerInput = $state('');
	let referrerError = $state('');
	let referrerSaving = $state(false);
	let codeCopied = $state(false);
	let withdrawing = $state(false);
	let withdrawResult = $state<{ type: string; amount: string; chain: string; signature: number[] } | null>(null);
	let withdrawError = $state('');
	let depositAddress = $state('');
	let depositChain = $state<Chain>('SOL');
	let depositDetected = $state(false);

	let socialSearch = $state('');
	let socialResults = $state<ProfileResponse[]>([]);
	let socialLoading = $state(false);
	let socialDebounce: ReturnType<typeof setTimeout> | null = null;
	let socialSubTab = $state<'search' | 'followers' | 'following'>('search');
	let followers = $state<ProfileResponse[]>([]);
	let followersLoading = $state(false);
	let followersPage = $state(0);
	let followersHasMore = $state(false);
	let following = $state<ProfileResponse[]>([]);
	let followingLoading = $state(false);
	let followingPage = $state(0);
	let followingHasMore = $state(false);
	let followToggling = $state<Set<string>>(new Set());
	let viewingProfile = $state<ProfileResponse | null>(null);
	let viewingProfileLoading = $state(false);

	let tgLoggedIn = $state<boolean | null>(null);
	let tgLoading = $state(false);
	let tgChats = $state<TgManagedChat[]>([]);
	let tgChatsLoading = $state(false);
	let tgSyncing = $state(false);
	let tgChatSearch = $state('');
	let filteredTgChats = $derived(
		tgChatSearch.trim()
			? tgChats.filter(c => c.chatName?.toLowerCase().includes(tgChatSearch.trim().toLowerCase()))
			: tgChats
	);

	let tcPresets = $state<TradePresetsResponse>({ S1: null, S2: null, S3: null });
	let tcLoading = $state(false);
	let tcSaving = $state(false);
	let tcError = $state('');
	let showTcForm = $state(false);
	let tcEditSlot = $state<TradePresetSlot | null>(null);
	let tcBuyGas = $state<GasPreset>('AUTO');
	let tcSellGas = $state<GasPreset>('AUTO');
	let tcAntiMev = $state(false);
	let tcSlippageBuy = $state('');
	let tcSlippageSell = $state('');
	let tcAutoSlippage = $state(true);
	let tcBuyValue = $state('');
	let tcBuyAmountType = $state<'USD' | 'NATIVE'>('USD');
	let tcStrategyType = $state<'MARKET' | 'DIP' | 'LIMIT'>('MARKET');
	let tcStrategyValue = $state('');

	type TriggerType = 'MULTIPLIER' | 'PERCENT' | 'PRICE' | 'MARKET_CAP_USD';
	type TcTargetRow = { triggerType: TriggerType; value: string; sellPct: string; targetKind: 'TAKE_PROFIT' | 'STOP_LOSS'; mode: 'NORMAL' | 'TRAILING' };

	let tcTargets = $state<TcTargetRow[]>([]);

	const TRIGGER_TO_KIND: Record<TriggerType, SellTargetKind> = { MULTIPLIER: 'MULTIPLE', PERCENT: 'PERCENTAGE', MARKET_CAP_USD: 'MARKETCAP', PRICE: 'USD' };
	const KIND_TO_TRIGGER: Record<SellTargetKind, TriggerType> = { MULTIPLE: 'MULTIPLIER', PERCENTAGE: 'PERCENT', MARKETCAP: 'MARKET_CAP_USD', USD: 'PRICE' };

	function tcToRow(t: TcTargetRow): SellTargetRow {
		return { kind: TRIGGER_TO_KIND[t.triggerType], triggerValue: t.value, sellPercent: t.sellPct, targetKind: t.targetKind, mode: t.mode };
	}
	function rowToTc(r: SellTargetRow): TcTargetRow {
		return { triggerType: KIND_TO_TRIGGER[r.kind], value: r.triggerValue, sellPct: r.sellPercent, targetKind: r.targetKind, mode: r.mode };
	}

	const chains: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];
	const gasOptions: { label: string; value: GasPreset }[] = [
		{ label: 'Auto', value: 'AUTO' },
		{ label: 'Low', value: 'LOW' },
		{ label: 'Med', value: 'MEDIUM' },
		{ label: 'High', value: 'HIGH' }
	];

	async function handleConnect() {
		try {
			await connectWallet();
			authenticate(getAuthToken());
		} catch {}
	}

	async function loadProfile() {
		// Navbar may already have profile — paint immediately, refresh in background.
		const cached = getProfile();
		if (cached) {
			profileLoading = false;
			void fetchProfileStore(false);
			return;
		}
		profileLoading = true;
		try {
			await fetchProfileStore(true);
		} finally {
			profileLoading = false;
		}
	}



	async function fetchWallets() {
		walletsLoading = true;
		try {
			const { data } = await api.GET('/v2/user/wallets');
			walletsResponse = data ?? null;
		} catch {} finally {
			walletsLoading = false;
		}
	}

	

	async function fetchReferralData() {
		referralLoading = true;
		try {
			const [codeRes, summaryRes, feeRes] = await Promise.all([
				api.GET('/v2/referral/code'),
				api.GET('/v2/referral/commissions/summary'),
				api.GET('/v2/referral/fee-rate', { params: { query: { chain: 'SOL' } } })
			]);
			referralCode = codeRes.data ?? null;
			commissionSummary = summaryRes.data ?? null;
			feeRate = feeRes.data ?? null;
		} catch {} finally {
			referralLoading = false;
		}
	}

	async function fetchFavourites() {
		favouritesLoading = true;
		try {
			const { data } = await api.GET('/v2/user/favourites');
			favourites = data?.favourites ?? [];
		} catch {} finally {
			favouritesLoading = false;
			favouritesFetched = true;
		}
	}

	async function removeFavourite(chain: Chain, tokenAddress: string) {
		try {
			await api.DELETE('/v2/user/favourites/{chain}/{tokenAddress}', {
				params: { path: { chain, tokenAddress } }
			});
			favourites = favourites.filter(f => !(f.token.chain === chain && f.token.address === tokenAddress));
		} catch {}
	}

	async function searchUsers(query: string) {
		socialLoading = true;
		try {
			const { data } = await api.GET('/v2/user/search', {
				params: { query: { query } }
			});
			socialResults = data ?? [];
		} catch { socialResults = []; }
		socialLoading = false;
	}

	function onSocialSearchInput() {
		if (socialDebounce) clearTimeout(socialDebounce);
		socialDebounce = setTimeout(() => searchUsers(socialSearch), 300);
	}

	async function fetchFollowers(reset = false) {
		if (reset) { followersPage = 0; followers = []; }
		followersLoading = true;
		try {
			const { data } = await api.GET('/v2/user/followers', {
				params: { query: { page: followersPage, limit: 50 } }
			});
			const resp = data as PaginatedProfileResponse;
			if (followersPage === 0) followers = resp.data ?? [];
			else followers = [...followers, ...(resp.data ?? [])];
			followersHasMore = resp.hasMore ?? false;
		} catch {}
		followersLoading = false;
	}

	async function fetchFollowing(reset = false) {
		if (reset) { followingPage = 0; following = []; }
		followingLoading = true;
		try {
			const { data } = await api.GET('/v2/user/following', {
				params: { query: { page: followingPage, limit: 50 } }
			});
			const resp = data as PaginatedProfileResponse;
			if (followingPage === 0) following = resp.data ?? [];
			else following = [...following, ...(resp.data ?? [])];
			followingHasMore = resp.hasMore ?? false;
		} catch {}
		followingLoading = false;
	}

	async function toggleFollow(user: ProfileResponse) {
		if (followToggling.has(user.id)) return;
		followToggling = new Set([...followToggling, user.id]);
		try {
			if (user.isFollowing) {
				await api.DELETE('/v2/user/{userId}/follow', { params: { path: { userId: user.id } } });
			} else {
				await api.PUT('/v2/user/{userId}/follow', { params: { path: { userId: user.id } } });
			}
			const updated = { ...user, isFollowing: !user.isFollowing, followerCount: user.followerCount + (user.isFollowing ? -1 : 1) };
			socialResults = socialResults.map(u => u.id === user.id ? updated : u);
			followers = followers.map(u => u.id === user.id ? updated : u);
			following = following.map(u => u.id === user.id ? updated : u);
			if (viewingProfile?.id === user.id) viewingProfile = updated;
		} catch {}
		const next = new Set(followToggling);
		next.delete(user.id);
		followToggling = next;
	}

	async function viewUserProfile(user: ProfileResponse) {
		viewingProfile = user;
		viewingProfileLoading = true;
		try {
			const { data } = await api.GET('/v2/user/{idOrUsername}', {
				params: { path: { idOrUsername: user.id } }
			});
			if (data) viewingProfile = data;
		} catch {}
		viewingProfileLoading = false;
	}

	async function setUsername() {
		if (!usernameInput.trim()) return;
		usernameSaving = true;
		usernameError = '';
		try {
			const { error } = await api.POST('/v2/user/username', {
				body: { username: usernameInput.trim() }
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed');
			await fetchProfileStore(true);
			usernameInput = '';
		} catch (e: unknown) {
			usernameError = e instanceof Error ? e.message : 'Failed to set username';
		} finally {
			usernameSaving = false;
		}
	}

	async function setReferrer() {
		if (!referrerInput.trim()) return;
		referrerSaving = true;
		referrerError = '';
		try {
			const { error } = await api.PUT('/v2/referral/referrer', {
				body: { code: referrerInput.trim() }
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed');
			referrerInput = '';
			await fetchReferralData();
		} catch (e: unknown) {
			referrerError = e instanceof Error ? e.message : 'Invalid referral code';
		} finally {
			referrerSaving = false;
		}
	}

	function copyReferralCode() {
		if (!referralCode) return;
		navigator.clipboard.writeText(referralCode.code);
		codeCopied = true;
		setTimeout(() => (codeCopied = false), 1500);
	}

	function startDepositWatch(address: string, chain: Chain) {
		stopDepositWatch();
		depositAddress = address;
		depositChain = chain;
		depositDetected = false;
	}

	function stopDepositWatch() {
		depositAddress = '';
	}

	function normalizeTgChats(data: unknown): TgManagedChat[] | null {
		if (!Array.isArray(data)) return null;
		const rows = data.length === 1 && Array.isArray(data[0]) ? data[0] : data;
		if (!rows.every((row) => row && typeof row === 'object' && typeof row.chatId === 'number')) return null;
		return rows as TgManagedChat[];
	}

	function applyTgAction(data: any) {
		const action = data?.action;
		if (!action || typeof action !== 'object') return;
		tgLoggedIn = true;
		const renamed = action.chatTitleWasEdited;
		if (renamed && typeof renamed.chatId === 'number' && typeof renamed.newTitle === 'string') {
			tgChats = tgChats.map((chat) => chat.chatId === renamed.chatId ? { ...chat, chatName: renamed.newTitle } : chat);
		}
		const left = action.userLeftChat;
		if (left && typeof left.chatId === 'number') {
			tgChats = tgChats.filter((chat) => chat.chatId !== left.chatId);
		}
		const joined = action.userJoinedChat?.chat;
		if (joined && typeof joined.id === 'number') {
			tgChats = tgChats.map((chat) => chat.chatId === joined.id
				? { ...chat, chatName: joined.name, isSuperGroup: joined.isSuperGroup }
				: chat);
		}
	}

	function applyWalletSnapshot(data: any) {
		if (data?.wallets) {
			walletsResponse = data.wallets;
			const update = data.balanceUpdate;
			if (depositAddress && update && !depositDetected) {
				const matches = update.chain === depositChain
					&& update.walletAddress?.toLowerCase() === depositAddress.toLowerCase();
				if (matches) {
					depositDetected = true;
					setTimeout(() => {
						depositDetected = false;
					}, 5000);
				}
			}
		}
	}

	function applyUserEvent(event: string, data: any) {
		if (event === 'REWARDS_CLAIMED_CONFIRMED' && data?.chain && Array.isArray(data?.signature)) {
			withdrawResult = {
				type: data.rewardType === 'AFFILIATE' ? 'Commission' : 'Cashback',
				amount: String(data.amount),
				chain: data.chain,
				signature: data.signature
			};
			withdrawError = '';
			withdrawing = false;
		} else if (event === 'USER_TG_ACTION') {
			applyTgAction(data);
		} else if (event === 'USER_TG_QR_LOGIN' && data?.eventType === 'success') {
			tgLoggedIn = true;
		}
	}

	function copyDepositAddress() {
		navigator.clipboard.writeText(depositAddress);
	}

	async function fetchTradeConfigs() {
		tcLoading = true;
		try {
			const { data } = await api.GET('/v2/trade/presets');
			tcPresets = data ?? { S1: null, S2: null, S3: null };
		} catch {} finally { tcLoading = false; tcConfigsFetched = true; }
	}

	function resetTcForm() {
		tcEditSlot = null;
		tcBuyGas = 'AUTO';
		tcSellGas = 'AUTO';
		tcAntiMev = false;
		tcSlippageBuy = '';
		tcSlippageSell = '';
		tcBuyValue = '';
		tcBuyAmountType = 'USD';
		tcStrategyType = 'MARKET';
		tcStrategyValue = '';
		tcTargets = [];
		tcError = '';
	}

	function nextAvailableSlot(): TradePresetSlot | null {
		const slots: TradePresetSlot[] = ['S1', 'S2', 'S3'];
		return slots.find(s => !tcPresets[s]) ?? null;
	}

	function openCreateTc() {
		const slot = nextAvailableSlot();
		if (!slot) return;
		resetTcForm();
		tcEditSlot = slot;
		showTcForm = true;
	}

	function triggerValue(trigger: TradeTargetTrigger): string {
		switch (trigger.type) {
			case 'MULTIPLIER': return String(trigger.multiplier);
			case 'PERCENT': return String(trigger.changePct);
			case 'PRICE': return String(trigger.priceUsd);
			case 'MARKET_CAP_USD': return String(trigger.marketCapUsd);
		}
	}

	function openEditTc(slot: TradePresetSlot, preset: TradePreset) {
		const s = preset.settings;
		tcEditSlot = slot;
		tcBuyGas = typeof s.buyGas === 'string' ? s.buyGas : 'AUTO';
		tcSellGas = typeof s.sellGas === 'string' ? s.sellGas : 'AUTO';
		tcAntiMev = s.antiMev;
		tcSlippageBuy = s.buySlippagePct === 'AUTO' ? '' : String(s.buySlippagePct);
		tcSlippageSell = s.sellSlippagePct === 'AUTO' ? '' : String(s.sellSlippagePct);
		tcBuyValue = String(preset.amount.value);
		tcBuyAmountType = preset.amount.type;
		if (preset.strategy.type === 'MARKET') {
			tcStrategyType = 'MARKET';
			tcStrategyValue = '';
		} else if (preset.strategy.type === 'DIP') {
			tcStrategyType = 'DIP';
			tcStrategyValue = String(preset.strategy.dipPct);
		} else {
			tcStrategyType = 'LIMIT';
			tcStrategyValue = String(preset.strategy.priceUsd);
		}
		tcTargets = s.targets.map((t): TcTargetRow => ({
			triggerType: t.trigger.type,
			value: triggerValue(t.trigger),
			sellPct: String(t.sellPct),
			targetKind: t.kind,
			mode: (t.kind === 'STOP_LOSS' && 'mode' in t ? (t as { mode?: string }).mode : 'NORMAL') as 'NORMAL' | 'TRAILING'
		}));
		tcError = '';
		showTcForm = true;
	}

	function buildTrigger(triggerType: TriggerType, value: string): TradeTargetTrigger {
		switch (triggerType) {
			case 'MULTIPLIER': return { type: 'MULTIPLIER', multiplier: parseFloat(value) };
			case 'PERCENT': return positivePercentTargetTrigger(parseFloat(value));
			case 'PRICE': return { type: 'PRICE', priceUsd: parseFloat(value) };
			case 'MARKET_CAP_USD': return { type: 'MARKET_CAP_USD', marketCapUsd: parseFloat(value) };
		}
	}

	function buildTcTargets(): TradeTargetConfig[] {
		return tcTargets
			.filter(r => r.value && r.sellPct)
			.map((r): TradeTargetConfig => {
				if (r.targetKind === 'STOP_LOSS') {
					return { kind: 'STOP_LOSS', sellPct: parseFloat(r.sellPct), trigger: buildTrigger(r.triggerType, r.value), mode: r.mode };
				}
				return { kind: 'TAKE_PROFIT', sellPct: parseFloat(r.sellPct), trigger: buildTrigger(r.triggerType, r.value) };
			});
	}

	function buildPreset(): TradePreset {
		const strategy: BuyStrategy = tcStrategyType === 'MARKET'
			? { type: 'MARKET' }
			: tcStrategyType === 'DIP'
				? { type: 'DIP', dipPct: parseFloat(tcStrategyValue) }
				: { type: 'LIMIT', priceUsd: parseFloat(tcStrategyValue) };
		return {
			amount: { type: tcBuyAmountType, value: tcBuyValue ? parseFloat(tcBuyValue) : 0 },
			strategy,
			settings: {
				antiMev: tcAntiMev,
				buyGas: tcBuyGas,
				sellGas: tcSellGas,
				buySlippagePct: tcSlippageBuy ? parseFloat(tcSlippageBuy) : 'AUTO',
				sellSlippagePct: tcSlippageSell ? parseFloat(tcSlippageSell) : 'AUTO',
				targets: buildTcTargets()
			}
		};
	}

	async function saveTc() {
		if (!tcEditSlot) return;
		tcSaving = true;
		tcError = '';
		try {
			const { error } = await api.POST('/v2/trade/presets/{slot}/update', {
				params: { path: { slot: tcEditSlot } },
				body: buildPreset()
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed');
			showTcForm = false;
			resetTcForm();
			await fetchTradeConfigs();
		} catch (e: unknown) {
			tcError = e instanceof Error ? e.message : 'Failed to save preset';
		} finally { tcSaving = false; }
	}

	async function withdrawCommissions(chain: Chain) {
		const managed = walletsResponse?.appWallets[chain];
		if (!managed) { withdrawError = `No managed wallet on ${chain}`; return; }
		withdrawing = true;
		withdrawError = '';
		withdrawResult = null;
		try {
			const { data, error } = await api.POST('/v2/referral/withdraw', {
				body: { address: managed.address, chain }
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Withdrawal failed');
			if (data) withdrawResult = { type: 'Commission', amount: String(data.amount), chain, signature: data.signature };
		} catch (e: unknown) {
			withdrawError = e instanceof Error ? e.message : 'Withdrawal failed';
		} finally { withdrawing = false; }
	}

	async function withdrawCashback(chain: Chain) {
		const managed = walletsResponse?.appWallets[chain];
		if (!managed) { withdrawError = `No managed wallet on ${chain}`; return; }
		withdrawing = true;
		withdrawError = '';
		withdrawResult = null;
		try {
			const { data, error } = await api.POST('/v2/referral/cashback', {
				body: { address: managed.address, chain }
			});
			if (error) throw new Error((error as ErrorResponse)?.message ?? 'Cashback withdrawal failed');
			if (data) withdrawResult = { type: 'Cashback', amount: String(data.amount), chain, signature: data.signature };
		} catch (e: unknown) {
			withdrawError = e instanceof Error ? e.message : 'Cashback withdrawal failed';
		} finally { withdrawing = false; }
	}

	async function fetchTgStatus() {
		tgLoading = true;
		try {
			const { data } = await api.GET('/v2/watchlist/manage/tg/login/status');
			tgLoggedIn = data?.loggedIn ?? false;
			if (tgLoggedIn) {
				fetchTgChats();
			}
		} catch {} finally {
			tgLoading = false;
		}
	}

	let tgDisconnecting = $state(false);

	async function tgLogout() {
		tgDisconnecting = true;
		try {
			await api.POST('/v2/watchlist/manage/tg/logout');
			tgLoggedIn = false;
			tgChats = [];
		} catch {} finally {
			tgDisconnecting = false;
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

	async function syncTgChats() {
		tgSyncing = true;
		try {
			const { data } = await api.POST('/v2/watchlist/manage/tg/chats/sync');
			tgChats = data?.chats ?? [];
		} catch {} finally {
			tgSyncing = false;
		}
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

	$effect(() => {
		if (!getIsLoggedIn()) return;
		untrack(() => {
			void loadProfile();
			void fetchWallets();
		});
	});

	$effect(() => {
		if (!getIsLoggedIn()) return;
		const key = subscribe('user', (event, data) => {
			if (event === 'TRADE_PRESETS' && data && typeof data === 'object') {
				tcPresets = data;
				tcConfigsFetched = true;
			} else if (event === 'USER_BALANCE') {
				applyWalletSnapshot(data);
			} else if (event === 'USER_PROFILE' && typeof data?.id === 'string') {
				setProfile(data);
			} else if (event === 'USER_FAVOURITES' && Array.isArray(data?.favourites)) {
				favourites = data.favourites;
				favouritesFetched = true;
			} else if (event === 'REFERRAL_CODE' && typeof data?.code === 'string') {
				referralCode = data;
			} else if (event === 'REFERRAL_COMMISSIONS_SUMMARY' && Array.isArray(data?.byChain)) {
				commissionSummary = data;
			} else if (event === 'USER_TG_STATUS' && typeof data?.loggedIn === 'boolean') {
				tgLoggedIn = data.loggedIn;
				if (!data.loggedIn) tgChats = [];
			} else if (event === 'WATCHLIST_TG_CHATS') {
				const chats = normalizeTgChats(data);
				if (chats) tgChats = chats;
			} else {
				applyUserEvent(event, data);
			}
		});
		return () => unsubscribe(key);
	});

	$effect(() => {
		if (!getIsLoggedIn()) return;
		if (activeTab === 'settings' && !getSettings()) fetchGlobalSettings();
		if (activeTab === 'settings' && !tcConfigsFetched) fetchTradeConfigs();
		if (activeTab === 'referrals' && !referralCode) fetchReferralData();
		if (activeTab === 'favourites' && !favouritesFetched) fetchFavourites();
		if (activeTab === 'telegram' && tgLoggedIn === null) fetchTgStatus();
		if (activeTab === 'social' && socialResults.length === 0 && !socialSearch) searchUsers('');
	});

	onDestroy(() => stopDepositWatch());

	type WalletEntry = { address: string; chain: Chain; kind: 'managed' | 'connected'; assets: WalletAsset[]; totalValueUsd: number };
	type WalletWithdrawResult = { signature: string; status: string };

	let sellingToken = $state<string | null>(null);
	let withdrawingAsset = $state<{ chain: Chain; asset: WalletAsset } | null>(null);
	let walletWithdrawResult = $state<WalletWithdrawResult | null>(null);

	function openAssetWithdrawal(chain: Chain, asset: WalletAsset) {
		walletWithdrawResult = null;
		withdrawingAsset = { chain, asset };
	}

	function completeAssetWithdrawal(result: WalletWithdrawResult) {
		walletWithdrawResult = result;
		withdrawingAsset = null;
		fetchWallets();
	}

	async function sellToken(chain: Chain, tokenAddress: string) {
		const key = `${chain}:${tokenAddress}`;
		if (sellingToken) return;
		sellingToken = key;
		try {
			await api.POST('/v2/user/wallets/{chain}/{token}/sell', {
				params: { path: { chain: chain as never, token: tokenAddress } },
				body: { pct: 100 }
			} as never);
			fetchWallets();
		} catch {}
		sellingToken = null;
	}

	function allWallets(): WalletEntry[] {
		if (!walletsResponse) return [];
		const result: WalletEntry[] = [];
		for (const [chain, w] of Object.entries(walletsResponse.appWallets)) {
			result.push({ address: w.address, chain: chain as Chain, kind: 'managed', assets: w.assets, totalValueUsd: w.totalValueUsd });
		}
		for (const w of walletsResponse.connectedWallets) {
			result.push({ address: w.address, chain: w.chain, kind: 'connected', assets: w.assets, totalValueUsd: w.totalValueUsd });
		}
		return result;
	}

	function walletsByChain(ch: Chain): WalletEntry[] {
		return allWallets().filter(w => w.chain === ch);
	}

	function totalValueAllWallets(): number {
		return walletsResponse?.totalAssetsUsd ?? 0;
	}

	function totalCommissions(): string {
		if (!commissionSummary) return '0';
		let total = 0;
		for (const c of commissionSummary.byChain) {
			total += Number(c.affiliateRevenueUsd);
		}
		return total.toFixed(2);
	}
</script>

<div class="min-h-screen bg-s0 pb-24 md:pb-0">
	{#if !getIsLoggedIn()}
		<div class="flex h-[calc(100dvh-48px)] items-center justify-center">
			<div class="text-center">
				<div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-s4 ring-1 ring-bd">
					<User class="h-7 w-7 text-g5" strokeWidth={1.5} />
				</div>
				<h2 class="mb-2 text-xl font-semibold text-tx">Profile</h2>
				<p class="mb-6 text-sm text-g6">Connect your wallet to view your profile</p>
				{#if !isPhantomInstalled()}
					<button onclick={() => (showMobileScan = true)} class="btn-primary px-6 py-2.5 text-base md:hidden"><span class="flex items-center gap-2"><Camera class="h-4 w-4" />Scan QR</span></button>
					<button onclick={handleConnect} class="btn-primary hidden px-6 py-2.5 text-base md:inline-flex">Install Phantom</button>
				{:else}
					<button onclick={handleConnect} disabled={getIsConnecting()} class="btn-primary px-6 py-2.5 text-base">{getIsConnecting() ? 'Connecting...' : 'Connect Wallet'}</button>
				{/if}
			</div>
		</div>
	{:else}
		<div class="mx-auto max-w-5xl p-3 md:p-6">
			{#if profileLoading}
				<div class="skeleton mb-6 h-32 rounded-xl"></div>
			{:else if profile}
				<div class="mb-3 md:mb-6 overflow-hidden rounded-xl md:rounded-2xl border border-bd bg-s1">
					<div class="relative bg-gradient-to-br from-grn/6 via-s1 to-transparent px-3 md:px-8 py-3 md:py-8">
						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-2.5 md:gap-5">
								<div class="relative shrink-0">
									{#if avatarUrl(profile.photoId)}
										<img src={avatarUrl(profile.photoId)} alt="" class="h-10 w-10 md:h-18 md:w-18 rounded-xl md:rounded-2xl object-cover ring-1 ring-grn/20" />
									{:else}
										<div class="flex h-10 w-10 md:h-18 md:w-18 items-center justify-center rounded-xl md:rounded-2xl bg-gradient-to-br from-grn/20 to-grn/5 text-lg md:text-3xl font-bold text-grn ring-1 ring-grn/20">
											{profile.username ? profile.username[0].toUpperCase() : '?'}
										</div>
									{/if}
									<button
										onclick={() => showCropper = true}
										disabled={profilePicUploading}
										class="absolute -bottom-1 -right-1 flex h-5 w-5 md:h-6 md:w-6 cursor-pointer items-center justify-center rounded-full border border-bd bg-s5 text-g7 transition-colors hover:text-tx disabled:opacity-50"
									>
										{#if profilePicUploading}
											<LoaderCircle class="h-2.5 w-2.5 md:h-3 md:w-3 animate-spin" />
										{:else}
											<Camera class="h-2.5 w-2.5 md:h-3 md:w-3" />
										{/if}
									</button>
								</div>
								<div>
									<div class="flex flex-wrap items-center gap-1.5 md:gap-3">
										<h1 class="text-base md:text-2xl font-bold text-tx">{profile.username || 'Anonymous'}</h1>
										{#if !profile.hasUsername}
											<span class="rounded bg-yel/20 px-1.5 py-0.5 text-[10px] md:text-xs font-medium text-yel">No username</span>
										{/if}
									</div>
									<div class="mt-0.5 md:mt-1.5 flex flex-wrap items-center gap-1.5 md:gap-4 text-[11px] md:text-sm">
										<span class="rounded bg-s7 px-1.5 py-0.5 md:px-2.5 md:py-1 font-medium text-g9">#{profile.rank}</span>
										<span class="flex items-center gap-1.5 text-g7">
											Lv{Math.floor(profile.level ?? 0)}
											<span class="inline-block h-1.5 md:h-2.5 w-12 md:w-24 overflow-hidden rounded-full bg-bd">
												<span class="block h-full rounded-full bg-gradient-to-r from-grn to-grn-dark" style="width: {((profile.level ?? 0) % 1) * 100}%"></span>
											</span>
										</span>
										<span class="text-g5">{shortAddress(getWalletAddress() ?? '')}</span>
									</div>
								</div>
							</div>
							<div class="text-right shrink-0">
								<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">Total Value</div>
								<div class="text-base md:text-2xl font-bold text-tx">{formatUsd(totalValueAllWallets())}</div>
							</div>
						</div>
					</div>

					{#if (profile.profitChart?.length ?? 0) > 0}
						{@const pts = profile.profitChart.length > 1 ? profile.profitChart : [profile.profitChart[0], profile.profitChart[0]]}
						{@const vals = pts.map(p => p.valueUsd)}
						{@const min = Math.min(...vals)}
						{@const max = Math.max(...vals)}
						{@const range = max - min || 1}
						{@const chartW = 600}
						{@const chartH = 60}
						{@const step = chartW / (vals.length - 1)}
						{@const points = vals.map((v, i) => `${(i * step).toFixed(1)},${(chartH - 2 - ((v - min) / range) * (chartH - 4)).toFixed(1)}`)}
						{@const zeroY = chartH - 2 - ((0 - min) / range) * (chartH - 4)}
						{@const lastVal = vals[vals.length - 1]}
						{@const lineColor = lastVal >= 0 ? 'var(--t-grn)' : 'var(--t-red)'}
						<div class="border-t border-bd px-3 md:px-5 py-3 md:py-4">
							<div class="mb-2 flex items-center justify-between">
								<div class="flex items-center gap-1.5">
									<span class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">30d PnL</span>
									<button onclick={() => showPnlCalendar = true} class="cursor-pointer text-g4 transition-colors hover:text-tx"><CalendarDays class="h-3.5 w-3.5" /></button>
								</div>
								<span class="text-xs font-bold {profile.totalPnlUsd >= 0 ? 'text-grn' : 'text-red'}">{profile.totalPnlUsd >= 0 ? '+' : ''}{formatUsd(profile.totalPnlUsd)}</span>
							</div>
							<svg viewBox="0 0 {chartW} {chartH}" class="w-full h-10 md:h-14" preserveAspectRatio="none">
								{#if min < 0 && max > 0}
									<line x1="0" y1={zeroY} x2={chartW} y2={zeroY} stroke="var(--t-g1)" stroke-width="1" stroke-dasharray="4,4" />
								{/if}
								<defs>
									<linearGradient id="pnl-fill" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color={lineColor} stop-opacity="0.2" />
										<stop offset="100%" stop-color={lineColor} stop-opacity="0" />
									</linearGradient>
								</defs>
								<polygon points="{points.join(' ')} {chartW},{chartH} 0,{chartH}" fill="url(#pnl-fill)" />
								<polyline points={points.join(' ')} fill="none" stroke={lineColor} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
							</svg>
						</div>
					{/if}

					<div class="grid grid-cols-4 gap-px border-t border-bd bg-bd">
						<div class="bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center">
							<div class="text-sm md:text-2xl font-bold text-tx">{profile.totalTrades}</div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">Trades</div>
						</div>
						<div class="bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center">
							<div class="text-sm md:text-2xl font-bold {profile.winRatePct >= 50 ? 'text-grn' : profile.winRatePct > 0 ? 'text-yel' : 'text-red'}">{profile.winRatePct.toFixed(1)}%</div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">Win Rate</div>
						</div>
						<div class="bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center">
							<div class="text-sm md:text-2xl font-bold text-tx"><span class="text-grn">{profile.wins}</span><span class="text-g1">/</span><span class="text-red">{profile.losses}</span></div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">W/L</div>
						</div>
						<div class="bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center">
							<div class="text-sm md:text-2xl font-bold {profile.totalPnlUsd >= 0 ? 'text-grn' : 'text-red'}">{formatUsd(profile.totalPnlUsd)}</div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">PnL</div>
						</div>
					</div>
					<div class="grid grid-cols-4 gap-px bg-bd">
						<div class="bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center">
							<div class="text-sm md:text-2xl font-bold text-tx">{formatUsd(profile.totalWageredUsd)}</div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">Wagered</div>
						</div>
						<div class="bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center">
							<div class="text-sm md:text-2xl font-bold text-tx">{profile.affiliateCount}</div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">Referrals</div>
						</div>
						<button onclick={() => { activeTab = 'social'; socialSubTab = 'followers'; fetchFollowers(true); }} class="cursor-pointer bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center transition-colors hover:bg-wh/5">
							<div class="text-sm md:text-2xl font-bold text-tx">{profile.followerCount}</div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">Followers</div>
						</button>
						<button onclick={() => { activeTab = 'social'; socialSubTab = 'following'; fetchFollowing(true); }} class="cursor-pointer bg-s1 px-1.5 md:px-5 py-2 md:py-4 text-center transition-colors hover:bg-wh/5">
							<div class="text-sm md:text-2xl font-bold text-tx">{profile.followingCount}</div>
							<div class="text-[9px] md:text-xs font-medium uppercase tracking-wider text-g5">Following</div>
						</button>
					</div>

					{#if !profile.hasUsername}
						<div class="border-t border-bd px-8 py-5">
							<div class="mb-2 text-sm font-medium text-g7">Set Username</div>
							<div class="flex gap-3">
								<input
									type="text"
									placeholder="Choose a username..."
									maxlength={32}
									bind:value={usernameInput}
									class="flex-1 rounded-xl border border-bd bg-s4 px-4 py-2.5 text-base text-tx placeholder-g3 outline-none transition-colors focus:border-grn/40"
								/>
								<button onclick={setUsername} disabled={usernameSaving || !usernameInput.trim()} class="btn-primary px-6 py-2.5 text-sm">
									{usernameSaving ? '...' : 'Set'}
								</button>
							</div>
							{#if usernameError}
								<div class="mt-2 text-xs text-red">{usernameError}</div>
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<div class="mb-3 md:mb-6 rounded-xl border border-bd bg-s1 p-6 text-center">
					<p class="mb-3 text-sm text-g6">Couldn’t load your profile.</p>
					<button
						type="button"
						class="btn-primary px-4 py-2 text-sm"
						onclick={() => void loadProfile()}
					>
						Retry
					</button>
				</div>
			{/if}

		<div class="mb-4 flex gap-1 rounded-xl border border-bd bg-s1 p-1 overflow-x-auto scrollbar-none">
			{#each [
				{ label: 'Wallets', value: 'wallets' as ProfileTab },
				{ label: 'Settings', value: 'settings' as ProfileTab },
				{ label: 'Social', value: 'social' as ProfileTab },
				{ label: 'Referrals', value: 'referrals' as ProfileTab },
				{ label: 'Favs', value: 'favourites' as ProfileTab },
				{ label: 'Telegram', value: 'telegram' as ProfileTab }
			] as tab}
					<button
						class="relative shrink-0 flex-1 rounded-lg px-2 md:px-3 py-2 text-xs md:text-sm font-medium transition-all {activeTab === tab.value
							? 'bg-s7 text-tx'
							: 'text-g6 hover:text-g9'}"
						onclick={() => (activeTab = tab.value)}
					>
						{tab.label}
						{#if activeTab === tab.value}
							<span class="absolute bottom-0.5 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-grn"></span>
						{/if}
					</button>
				{/each}
			</div>

			{#if activeTab === 'wallets'}
				{#if walletsLoading}
					<div class="space-y-3">
						{#each Array(2) as _, i}
							<div class="skeleton h-24 rounded-xl" style="animation-delay: {i * 80}ms"></div>
						{/each}
					</div>
				{:else if allWallets().length === 0}
					<div class="rounded-xl border border-bd bg-s1 p-8 text-center">
						<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-s7">
							<Wallet class="h-5 w-5 text-g5" strokeWidth={1.5} />
						</div>
						<span class="text-sm text-g6">No wallets found</span>
					</div>
				{:else}
					{#if depositAddress}
						<div class="mb-4 rounded-xl border border-grn/40 bg-grn/10 p-4">
							<div class="mb-2 flex items-center justify-between">
								<div class="flex items-center gap-2">
									<div class="h-2 w-2 animate-pulse rounded-full bg-grn"></div>
									<span class="text-sm font-medium text-grn">
										{depositDetected ? 'Deposit Detected!' : 'Watching for deposits...'}
									</span>
								</div>
								<button
									onclick={stopDepositWatch}
									class="cursor-pointer text-xs text-g7 hover:text-tx"
								>
									Close
								</button>
							</div>
							<div class="mb-2 text-xs text-g7">
								Send <span class="font-semibold text-tx">{depositChain}</span> tokens to:
							</div>
							<div class="flex items-center gap-2 rounded-lg border border-bd bg-s1 px-3 py-2">
								<code class="flex-1 select-all text-sm text-tx">{depositAddress}</code>
								<button onclick={copyDepositAddress} class="btn-secondary px-2 py-1 text-xs">Copy</button>
							</div>
							<div class="mt-2 text-xs text-g6">
								Transfers are detected automatically via WebSocket. Only send tokens on the {depositChain} network.
							</div>
						</div>
					{/if}

					<div class="space-y-3">
						{#each chains as ch}
							{@const chainWallets = walletsByChain(ch)}
							{#if chainWallets.length > 0}
								<div class="rounded-xl border border-bd bg-s1">
									<div class="flex items-center justify-between border-b border-bd px-4 py-3">
										<div class="flex items-center gap-2">
											<span class="rounded-lg bg-s7 px-2 py-0.5 text-sm font-semibold text-tx">{ch}</span>
											<span class="text-sm text-g6">{chainWallets.length} wallet{chainWallets.length > 1 ? 's' : ''}</span>
										</div>
									</div>
								{#each chainWallets as wallet}
									<div class="border-b border-bd/30 px-4 py-3 last:border-0">
										<div class="mb-2 flex items-center justify-between">
											<div class="flex items-center gap-2">
												<code class="text-sm text-tx">{shortAddress(wallet.address)}</code>
												<span class="rounded-md bg-s7 px-1.5 py-0.5 text-[11px] text-g7">{wallet.kind}</span>
											</div>
											<div class="flex items-center gap-2">
												<span class="text-sm font-semibold text-tx">{formatUsd(wallet.totalValueUsd)}</span>
												{#if wallet.kind === 'managed'}
													<button
														onclick={() => startDepositWatch(wallet.address, wallet.chain)}
														class="cursor-pointer rounded bg-grn/20 px-2 py-1 text-xs font-medium text-grn transition-colors hover:bg-grn/35"
													>
														Deposit
													</button>
												{/if}
											</div>
										</div>
										{#if walletWithdrawResult && wallet.kind === 'managed' && wallet.chain === 'SOL'}
											{@const withdrawalConfirmed = walletWithdrawResult.status === 'confirmed'}
											<div class="mb-2 break-all rounded-lg border px-3 py-2 text-xs {withdrawalConfirmed ? 'border-grn/40 bg-grn/10 text-grn' : 'border-yel/40 bg-yel/10 text-yel'}">
												{withdrawalConfirmed
													? 'Withdrawal confirmed'
													: walletWithdrawResult.status === 'pending'
														? 'Withdrawal submitted; confirmation pending'
														: `Withdrawal submitted; status: ${walletWithdrawResult.status || 'unknown'}`}: {walletWithdrawResult.signature}
											</div>
										{/if}
										{#if wallet.assets.length > 0}
											<div class="overflow-x-auto">
												<table class="w-full text-xs">
													<thead>
														<tr class="text-g6">
															<th class="pb-1 text-left font-medium">Token</th>
															<th class="pb-1 text-right font-medium">Balance</th>
															<th class="pb-1 text-right font-medium">Price</th>
															<th class="pb-1 text-right font-medium">Value</th>
															{#if wallet.kind === 'managed'}<th class="pb-1 w-10"></th>{/if}
														</tr>
													</thead>
													<tbody>
														{#each [...wallet.assets].sort((a, b) => (b.isNative ? 1 : 0) - (a.isNative ? 1 : 0)) as bal}
															{@const sellKey = `${wallet.chain}:${bal.token.address}`}
															<tr class="group/row border-t border-bd/20">
																<td class="py-1">{#if !bal.isNative}<a href="/?chain={wallet.chain}&token={bal.token.address}" class="text-tx hover:text-grn transition-colors">{bal.token.symbol}</a>{:else}<span class="text-tx">{bal.token.symbol}</span>{/if}</td>
																<td class="py-1 text-right text-g7">{bal.tokensBalance.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
																<td class="py-1 text-right text-g7">{formatUsd(bal.priceUsdStr)}</td>
																<td class="py-1 text-right text-tx">{formatUsd(bal.valueUsdStr)}</td>
																{#if wallet.kind === 'managed'}
																	<td class="py-1 text-right">
																		<div class="flex justify-end gap-1">
																			{#if wallet.chain === 'SOL'}
																				<button
																					onclick={() => openAssetWithdrawal(wallet.chain, bal)}
																					class="btn-secondary px-1.5 py-0.5 text-[9px]"
																				>Withdraw</button>
																			{/if}
																			{#if !bal.isNative}
																			<button
																				onclick={() => sellToken(wallet.chain, bal.token.address)}
																				disabled={sellingToken === sellKey}
																				class="cursor-pointer rounded bg-red/10 px-1.5 py-0.5 text-[9px] font-semibold text-red opacity-0 transition-all hover:bg-red/20 group-hover/row:opacity-100 disabled:opacity-50 {sellingToken === sellKey ? '!opacity-100' : ''}"
																			>{sellingToken === sellKey ? '...' : 'Sell'}</button>
																			{/if}
																		</div>
																	</td>
																{/if}
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{:else}
											<div class="text-xs text-g6">No balances</div>
										{/if}
									</div>
								{/each}
								</div>
							{/if}
						{/each}
					</div>
				{/if}

			{:else if activeTab === 'settings'}
				{#if !getSettings()}
					<div class="skeleton h-40 rounded-xl"></div>
				{:else}
					{@const s = getSettings()!}
					<div class="rounded-xl border border-bd bg-s1 p-6">
						<h2 class="mb-1 text-base font-semibold text-tx">Preferences</h2>
						<p class="mb-5 text-xs text-g6">Account and trading settings</p>
						<div class="space-y-3">
							<div class="flex items-center justify-between rounded-lg bg-s4 px-4 py-3">
								<div>
									<div class="text-sm font-medium text-tx">Anonymous</div>
									<div class="text-xs text-g6">Hide your profile from other users in search and leaderboards</div>
								</div>
								<button
									class="relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors {s.anonymous ? 'bg-grn' : 'bg-bd2'}"
									onclick={() => updateSetting('anonymous', !s.anonymous)}
									aria-label="Toggle Anonymous"
								>
									<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {s.anonymous ? 'left-[18px]' : 'left-0.5'}"></div>
								</button>
							</div>
						</div>
					</div>

					{@const presetSlots = (['S1', 'S2', 'S3'] as const).filter(s => tcPresets[s])}
					<div class="mt-4 rounded-xl border border-bd bg-s1 p-6">
						<div class="mb-4 flex items-center justify-between">
							<div>
								<h2 class="text-base font-semibold text-tx">Trade Presets</h2>
								<p class="text-xs text-g6">Saved trading presets you can select when buying. {presetSlots.length}/3 slots used.</p>
							</div>
							<button
								onclick={openCreateTc}
								disabled={!nextAvailableSlot()}
								class="cursor-pointer rounded-lg bg-grn px-3 py-1.5 text-xs font-semibold text-s0 transition-all disabled:opacity-50"
							>
								+ New Preset
							</button>
						</div>

						{#if tcLoading}
							<div class="space-y-2">
								{#each Array(2) as _, i}<div class="skeleton h-16 rounded-lg" style="animation-delay: {i * 80}ms"></div>{/each}
							</div>
						{:else if presetSlots.length === 0}
							<div class="rounded-lg border border-bd bg-s1 p-6 text-center text-sm text-g6">
								No trade presets yet. Create one to save gas, slippage, and anti-MEV settings as a reusable preset.
							</div>
						{:else}
							<div class="space-y-2">
								{#each presetSlots as slot}
									{@const preset = tcPresets[slot]!}
									{@const s = preset.settings}
									{@const tpCount = s.targets.filter(t => t.kind === 'TAKE_PROFIT').length}
									<div class="rounded-lg border border-bd bg-s1 p-3 transition-colors hover:border-bd">
										<div class="flex items-center justify-between">
											<div>
												<div class="flex items-center gap-2">
													<span class="text-sm font-semibold text-tx">{slot}</span>
												</div>
												<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-g7">
													<span class="rounded-md bg-grn/10 px-1.5 py-0.5 text-grn">Buy: {preset.amount.type === 'USD' ? '$' : ''}{preset.amount.value}{preset.amount.type === 'NATIVE' ? ' native' : ''}</span>
													<span class="rounded-md bg-s7 px-1.5 py-0.5">Buy Gas: {s.buyGas}</span>
													<span class="rounded-md bg-s7 px-1.5 py-0.5">Sell Gas: {s.sellGas}</span>
													{#if s.antiMev}
														<span class="rounded-md bg-wh/20 px-1.5 py-0.5 text-tx">Anti-MEV</span>
													{/if}
													{#if s.buySlippagePct === 'AUTO'}
														<span>Slippage: Auto</span>
													{:else}
														<span>Buy Slip: {s.buySlippagePct}%</span>
														<span>Sell Slip: {s.sellSlippagePct}%</span>
													{/if}
													{#if tpCount > 0}
														<span>{tpCount} sell target{tpCount !== 1 ? 's' : ''}</span>
													{/if}
												</div>
											</div>
											<div class="flex items-center gap-2">
												<button
													onclick={() => openEditTc(slot, preset)}
													class="cursor-pointer rounded-lg bg-s7 px-2 py-1 text-xs text-g7 transition-colors hover:text-tx"
												>
													Edit
												</button>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					{#if showTcForm}
					<div class="fixed inset-0 z-50 flex items-center justify-center bg-s0/60 backdrop-blur-[2px] p-4" role="presentation" onclick={() => { showTcForm = false; resetTcForm(); }} onkeydown={(e) => { if (e.key === 'Escape') { showTcForm = false; resetTcForm(); } }}>
						<div class="animate-fade-in w-full max-w-md rounded-2xl border border-bd bg-s5 p-6 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
							<div class="mb-4 flex items-center justify-between">
								<h2 class="text-base font-semibold text-tx">{tcPresets[tcEditSlot!] ? 'Edit' : 'Create'} Preset ({tcEditSlot})</h2>
									<button aria-label="Remove" onclick={() => { showTcForm = false; resetTcForm(); }} class="cursor-pointer text-g7 hover:text-tx">
										<X class="h-5 w-5" strokeWidth={2} />
									</button>
								</div>

							<div class="space-y-3">
								<div>
									<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Buy Amount</span>
									<div class="flex overflow-hidden rounded-lg border border-bd">
										<input type="text" inputmode="decimal" bind:value={tcBuyValue} placeholder="0.00" class="flex-1 bg-transparent px-3 py-1.5 text-sm text-tx outline-none" />
										<button onclick={() => (tcBuyAmountType = tcBuyAmountType === 'USD' ? 'NATIVE' : 'USD')} class="cursor-pointer border-l border-bd bg-s4 px-3 text-xs text-g7 hover:text-tx">{tcBuyAmountType}</button>
									</div>
								</div>

								<div>
									<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Buy At</span>
									<div class="flex gap-1">
										{#each [{ label: 'Market', value: 'MARKET' as const }, { label: 'Dip', value: 'DIP' as const }, { label: 'Limit', value: 'LIMIT' as const }] as opt}
											<button
												onclick={() => (tcStrategyType = opt.value)}
												class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {tcStrategyType === opt.value ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}"
											>
												{opt.label}
											</button>
										{/each}
									</div>
									{#if tcStrategyType === 'DIP'}
										<div class="mt-1.5 flex overflow-hidden rounded-lg border border-bd bg-s4">
											<input type="text" inputmode="decimal" bind:value={tcStrategyValue} placeholder="Dip %" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
											<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
										</div>
									{:else if tcStrategyType === 'LIMIT'}
										<div class="mt-1.5 flex overflow-hidden rounded-lg border border-bd bg-s4">
											<input type="text" inputmode="decimal" bind:value={tcStrategyValue} placeholder="Price USD" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
											<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">USD</span>
										</div>
									{/if}
								</div>

								{#each [{ value: tcBuyGas, set: (v: GasPreset) => (tcBuyGas = v), label: 'Buy Gas' }, { value: tcSellGas, set: (v: GasPreset) => (tcSellGas = v), label: 'Sell Gas' }] as gas}
									<div>
										<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">{gas.label}</span>
										<div class="flex gap-1">
											{#each gasOptions as opt}
												<button
													onclick={() => gas.set(opt.value)}
													class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {gas.value === opt.value ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}"
												>
													{opt.label}
												</button>
											{/each}
										</div>
									</div>
								{/each}

								<div class="flex gap-2">
									<div class="min-w-0 flex-1">
										<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Buy Slippage</span>
										<div class="flex overflow-hidden rounded-lg border border-bd bg-s4">
											<input type="text" inputmode="decimal" bind:value={tcSlippageBuy} placeholder="Auto" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
											<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
										</div>
									</div>
									<div class="min-w-0 flex-1">
										<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Sell Slippage</span>
										<div class="flex overflow-hidden rounded-lg border border-bd bg-s4">
											<input type="text" inputmode="decimal" bind:value={tcSlippageSell} placeholder="Auto" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
											<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
										</div>
									</div>
								</div>

								<div class="flex items-center justify-between rounded-lg border border-bd bg-s4 px-3 py-2">
									<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Anti-MEV (Private TX)</span>
									<button aria-label="Toggle Anti-MEV" onclick={() => (tcAntiMev = !tcAntiMev)} class="relative h-5 w-9 cursor-pointer rounded-full transition-colors {tcAntiMev ? 'bg-grn' : 'bg-bd2'}">
										<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {tcAntiMev ? 'left-[18px]' : 'left-0.5'}"></div>
									</button>
								</div>

									<div>
										<div class="mb-1 flex items-center justify-between">
											<span class="text-xs text-g7">Targets</span>
											<div class="flex items-center gap-1">
												<button onclick={() => (tcTargets = [...tcTargets, { triggerType: 'MULTIPLIER', value: '2', sellPct: '50', targetKind: 'TAKE_PROFIT', mode: 'NORMAL' }])} class="cursor-pointer rounded border border-bd px-2 py-0.5 text-[11px] text-grn transition-colors hover:border-grn/40 hover:bg-grn/10">+ TP</button>
												<button onclick={() => (tcTargets = [...tcTargets, { triggerType: 'PERCENT', value: '50', sellPct: '100', targetKind: 'STOP_LOSS', mode: 'NORMAL' }])} class="cursor-pointer rounded border border-bd px-2 py-0.5 text-[11px] text-red transition-colors hover:border-red/40 hover:bg-red/10">+ SL</button>
											</div>
										</div>
										<div class="grid auto-rows-max content-start gap-1.5 {tcTargets.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} {tcTargets.length > 4 ? 'max-h-[13rem] overflow-y-auto pr-1' : ''}">
											{#each tcTargets as target, i}
												<TargetCard
													target={tcToRow(target)}
													onupdate={(t) => { tcTargets[i] = rowToTc(t); }}
													onremove={() => (tcTargets = tcTargets.filter((_, j) => j !== i))}
												/>
											{/each}
										</div>
										{#if tcTargets.length === 0}
											<p class="text-[11px] text-g6">No targets configured</p>
										{/if}
									</div>

									{#if tcError}
										<div class="text-xs text-red">{tcError}</div>
									{/if}

									<button
										onclick={saveTc}
										disabled={tcSaving || !tcEditSlot}
										class="w-full cursor-pointer rounded-lg bg-grn py-2.5 text-sm font-semibold text-s0 transition-all disabled:opacity-50"
									>
										{tcSaving ? 'Saving...' : tcPresets[tcEditSlot!] ? 'Update Preset' : 'Create Preset'}
									</button>
								</div>
							</div>
						</div>
					{/if}
				{/if}

			{:else if activeTab === 'referrals'}
				{#if referralLoading}
					<div class="skeleton h-40 rounded-xl"></div>
				{:else}
					<div class="space-y-4">
						{#if referralCode}
							<div class="rounded-xl border border-bd bg-s1 p-6">
								<h2 class="mb-3 text-base font-semibold text-tx">Your Referral Code</h2>
								<div class="flex items-center gap-2">
									<div class="flex-1 rounded-lg border border-bd bg-s1 px-3 py-2">
										<code class="select-all text-base text-tx">{referralCode.code}</code>
									</div>
									<button onclick={copyReferralCode} class="btn-secondary px-4 py-2 text-sm">{codeCopied ? 'Copied!' : 'Copy'}</button>
								</div>
								{#if referralCode.isUsername}
									<div class="mt-1 text-xs text-g6">Using your username as referral code</div>
								{/if}
							</div>
						{/if}

						<div class="rounded-xl border border-bd bg-s1 p-6">
							<h2 class="mb-3 text-base font-semibold text-tx">Enter Referral Code</h2>
							<div class="flex gap-2">
								<input
									type="text"
									placeholder="Enter a referral code..."
									bind:value={referrerInput}
									class="flex-1 rounded-lg border border-bd bg-s4 px-3 py-2 text-base text-tx placeholder-g4 outline-none focus:border-grn"
								/>
								<button
									onclick={setReferrer}
									disabled={referrerSaving || !referrerInput.trim()}
									class="cursor-pointer rounded-lg bg-grn px-4 py-2 text-sm font-semibold text-s0 transition-all disabled:opacity-50"
								>
									{referrerSaving ? '...' : 'Apply'}
								</button>
							</div>
							{#if referrerError}
								<div class="mt-1 text-xs text-red">{referrerError}</div>
							{/if}
						</div>

						{#if feeRate}
							<div class="rounded-xl border border-bd bg-s1 p-6">
								<h2 class="mb-3 text-base font-semibold text-tx">Fee Rates (SOL)</h2>
								<div class="grid grid-cols-3 gap-3">
									<div class="rounded border border-bd bg-s1 px-3 py-2">
										<div class="text-xs text-g7">Swap Fee</div>
										<div class="text-base font-semibold text-tx">{Number(feeRate.systemFeeRate).toFixed(2)}%</div>
									</div>
									<div class="rounded border border-bd bg-s1 px-3 py-2">
										<div class="text-xs text-g7">Affiliate Rate</div>
										<div class="text-base font-semibold text-tx">{Number(feeRate.affiliateRate).toFixed(2)}%</div>
									</div>
									<div class="rounded border border-bd bg-s1 px-3 py-2">
										<div class="text-xs text-g7">Cashback Available</div>
										<div class="text-base font-semibold text-grn">{formatUsd(feeRate.cashbackAvailable)}</div>
									</div>
								</div>
							</div>
						{/if}

						<div class="rounded-xl border border-bd bg-s1 p-6">
							<h2 class="mb-3 text-base font-semibold text-tx">Withdraw Earnings</h2>
							<p class="mb-3 text-xs text-g6">Withdraw commissions or cashback to your managed wallet. Generates a signed coupon for on-chain claim.</p>
							<div class="space-y-2">
								{#each chains as ch}
									<div class="flex items-center gap-2">
										<span class="w-10 shrink-0 text-sm font-semibold text-tx">{ch}</span>
										<button
											onclick={() => withdrawCommissions(ch)}
											disabled={withdrawing}
											class="cursor-pointer rounded bg-wh/20 px-3 py-1.5 text-xs font-medium text-tx transition-colors hover:bg-wh/20 disabled:opacity-50"
										>
											Commission
										</button>
										<button
											onclick={() => withdrawCashback(ch)}
											disabled={withdrawing}
											class="cursor-pointer rounded bg-grn/20 px-3 py-1.5 text-xs font-medium text-grn transition-colors hover:bg-grn/35 disabled:opacity-50"
										>
											Cashback
										</button>
									</div>
								{/each}
							</div>
							{#if withdrawError}
								<div class="mt-3 text-xs text-red">{withdrawError}</div>
							{/if}
							{#if withdrawResult}
								<div class="mt-3 rounded border border-grn/40 bg-grn/10 p-3">
									<div class="mb-1 text-xs font-medium text-grn">{withdrawResult.type} Withdrawal Coupon Generated</div>
									<div class="space-y-0.5 text-xs text-g7">
										<div class="flex items-center gap-1">Chain: <ChainIcon chain={withdrawResult.chain} class="h-3.5 w-3.5 text-tx" /></div>
										<div>Amount: <span class="text-tx">{withdrawResult.amount}</span></div>
										<div class="text-[11px] text-g6">Coupon signature ready. Submit to the on-chain claim contract to finalize withdrawal.</div>
									</div>
								</div>
							{/if}
						</div>

						{#if commissionSummary}
							<div class="rounded-xl border border-bd bg-s1 p-6">
								<h2 class="mb-3 text-base font-semibold text-tx">Commission Summary</h2>
								<div class="mb-3 text-sm text-g7">
									Total Earned: <span class="font-semibold text-grn">{formatUsd(totalCommissions())}</span>
								</div>
								{#if commissionSummary.byChain.length > 0}
									<table class="mb-4 w-full text-sm">
										<thead>
											<tr class="border-b border-bd text-g7">
												<th class="pb-1 text-left font-medium">Chain</th>
												<th class="pb-1 text-right font-medium">Revenue</th>
											</tr>
										</thead>
										<tbody>
											{#each commissionSummary.byChain as cs}
												<tr class="border-b border-bd/30">
													<td class="py-1.5 text-tx"><ChainIcon chain={cs.chain} class="h-3.5 w-3.5" /></td>
													<td class="py-1.5 text-right text-grn">{formatUsd(cs.affiliateRevenueUsd)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								{/if}
								{#if commissionSummary.topReferrals.length > 0}
									<h3 class="mb-2 text-sm font-medium text-g7">Top Referrals</h3>
									<table class="w-full text-sm">
										<thead>
											<tr class="border-b border-bd text-g7">
												<th class="pb-1 text-left font-medium">User</th>
												<th class="pb-1 text-left font-medium">Chain</th>
												<th class="pb-1 text-right font-medium">Volume</th>
												<th class="pb-1 text-right font-medium">Revenue</th>
											</tr>
										</thead>
										<tbody>
											{#each commissionSummary.topReferrals as ref}
												<tr class="border-b border-bd/30">
													<td class="py-1.5 text-tx">{ref.username || 'anon'}</td>
													<td class="py-1.5 text-g7"><ChainIcon chain={ref.chain} class="h-3.5 w-3.5" /></td>
													<td class="py-1.5 text-right text-g7">{formatUsd(ref.volumeUsd)}</td>
													<td class="py-1.5 text-right text-grn">{formatUsd(ref.revenueUsd)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

			{:else if activeTab === 'favourites'}
				{#if favouritesLoading}
					<div class="space-y-2">
						{#each Array(3) as _, i}
							<div class="skeleton h-12 rounded-lg" style="animation-delay: {i * 80}ms"></div>
						{/each}
					</div>
				{:else if favourites.length === 0}
					<div class="rounded-xl border border-bd bg-s1 p-8 text-center">
						<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-s7">
							<Heart class="h-5 w-5 text-g5" strokeWidth={1.5} />
						</div>
						<span class="text-sm text-g6">No favourite tokens saved</span>
					</div>
				{:else}
					<div class="rounded-xl border border-bd bg-s1">
					{#each favourites as fav}
						<div class="flex items-center justify-between border-b border-bd/30 px-4 py-3 last:border-0">
							<div class="flex items-center gap-3">
								<img src={tokenImage(fav.token.chain, fav.token.address)} alt="" class="h-8 w-8 rounded-lg object-cover" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
								<div>
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium text-tx">{fav.token.symbol ?? shortAddress(fav.token.address)}</span>
										<ChainIcon chain={fav.token.chain} class="h-3 w-3 text-g7" />
									</div>
									{#if fav.token.name}
										<span class="text-xs text-g6">{fav.token.name}</span>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-3">
								<div class="text-right">
									<div class="text-sm font-medium text-tx">{@html formatPrice(fav.priceUsdStr)}</div>
									<div class="text-xs text-g6">MC {formatUsd(fav.marketCapUsdStr)}</div>
								</div>
								<a
									href="/?chain={fav.token.chain}&token={fav.token.address}"
									class="rounded-lg bg-s7 px-2 py-1 text-xs text-g7 transition-colors hover:text-tx"
								>
									View
								</a>
								<button
									onclick={() => removeFavourite(fav.token.chain, fav.token.address)}
									class="cursor-pointer rounded-lg bg-red/10 px-2 py-1 text-xs text-red transition-colors hover:bg-red/20"
								>
									Remove
								</button>
							</div>
						</div>
					{/each}
					</div>
				{/if}

			{:else if activeTab === 'social'}
				<div class="space-y-4">
					<div class="flex gap-1 rounded-xl border border-bd bg-s1 p-1">
						{#each [
							{ label: 'Discover', value: 'search' as const },
							{ label: `Followers${profile ? ` (${profile.followerCount})` : ''}`, value: 'followers' as const },
							{ label: `Following${profile ? ` (${profile.followingCount})` : ''}`, value: 'following' as const }
						] as tab}
							<button
								class="relative flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all cursor-pointer {socialSubTab === tab.value ? 'bg-s7 text-tx' : 'text-g6 hover:text-g9'}"
								onclick={() => {
									socialSubTab = tab.value;
									if (tab.value === 'followers') fetchFollowers(true);
									if (tab.value === 'following') fetchFollowing(true);
								}}
							>
								{tab.label}
								{#if socialSubTab === tab.value}
									<span class="absolute bottom-0.5 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-grn"></span>
								{/if}
							</button>
						{/each}
					</div>

					{#if socialSubTab === 'search'}
						<div class="relative">
							<Search class="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-g4" />
							<input
								type="text"
								bind:value={socialSearch}
								oninput={onSocialSearchInput}
								placeholder="Search users by username..."
								class="w-full rounded-xl border border-bd bg-s1 py-3 pl-10 pr-4 text-sm text-tx placeholder-g4 outline-none transition-colors focus:border-g1"
							/>
							{#if socialLoading}
								<LoaderCircle class="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-g4" />
							{/if}
						</div>

						{#if !socialSearch && socialResults.length > 0}
							<div class="text-xs font-medium uppercase tracking-wider text-g5">Top Users</div>
						{/if}

						{#if socialResults.length === 0 && !socialLoading}
							<div class="rounded-xl border border-bd bg-s1 p-8 text-center">
								<Users class="mx-auto mb-3 h-8 w-8 text-g3" strokeWidth={1.5} />
								<span class="text-sm text-g6">{socialSearch ? 'No users found' : 'Search for users to follow'}</span>
							</div>
						{:else}
						<div class="space-y-1.5 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
								{#each socialResults as user (user.id)}
									{@render userCard(user)}
								{/each}
							</div>
						{/if}
					{:else if socialSubTab === 'followers'}
						{#if followersLoading && followers.length === 0}
							<div class="space-y-2">{#each Array(4) as _, i}<div class="skeleton h-20 rounded-xl" style="animation-delay: {i * 60}ms"></div>{/each}</div>
						{:else if followers.length === 0}
							<div class="rounded-xl border border-bd bg-s1 p-8 text-center">
								<Users class="mx-auto mb-3 h-8 w-8 text-g3" strokeWidth={1.5} />
								<span class="text-sm text-g6">No followers yet</span>
							</div>
						{:else}
							<div class="space-y-1.5 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
								{#each followers as user}
									{@render userCard(user)}
								{/each}
							</div>
							{#if followersHasMore}
								<button onclick={() => { followersPage++; fetchFollowers(); }} class="mx-auto block cursor-pointer rounded-lg bg-s7 px-4 py-2 text-xs text-g7 transition-colors hover:text-tx">
									{followersLoading ? 'Loading...' : 'Load More'}
								</button>
							{/if}
						{/if}
					{:else if socialSubTab === 'following'}
						{#if followingLoading && following.length === 0}
							<div class="space-y-2">{#each Array(4) as _, i}<div class="skeleton h-20 rounded-xl" style="animation-delay: {i * 60}ms"></div>{/each}</div>
						{:else if following.length === 0}
							<div class="rounded-xl border border-bd bg-s1 p-8 text-center">
								<Users class="mx-auto mb-3 h-8 w-8 text-g3" strokeWidth={1.5} />
								<span class="text-sm text-g6">Not following anyone yet</span>
							</div>
						{:else}
							<div class="space-y-1.5 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
								{#each following as user}
									{@render userCard(user)}
								{/each}
							</div>
							{#if followingHasMore}
								<button onclick={() => { followingPage++; fetchFollowing(); }} class="mx-auto block cursor-pointer rounded-lg bg-s7 px-4 py-2 text-xs text-g7 transition-colors hover:text-tx">
									{followingLoading ? 'Loading...' : 'Load More'}
								</button>
							{/if}
						{/if}
					{/if}
				</div>

				{#if viewingProfile}
				<div class="fixed inset-0 z-50 flex items-center justify-center bg-s0/60 backdrop-blur-[2px] p-4" role="presentation" onclick={() => (viewingProfile = null)} onkeydown={(e) => { if (e.key === 'Escape') viewingProfile = null; }}>
					<div class="w-full max-w-sm overflow-hidden rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
						<div class="relative px-5 pt-5 pb-4">
							<button onclick={() => (viewingProfile = null)} class="absolute right-4 top-4 cursor-pointer text-g4 transition-colors hover:text-tx">
									<X class="h-4 w-4" />
								</button>
								<div class="flex items-center gap-3">
									{#if avatarUrl(viewingProfile.photoId)}
										<img src={avatarUrl(viewingProfile.photoId)} alt="" class="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-grn/20" />
									{:else}
										<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-grn/20 to-grn/5 text-lg font-bold text-grn ring-1 ring-grn/20">
											{viewingProfile.username ? viewingProfile.username[0].toUpperCase() : '?'}
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="truncate text-base font-bold text-tx">{viewingProfile.username || 'Anonymous'}</div>
										<div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-g5">
											<span class="rounded bg-s7 px-1.5 py-0.5 text-g9">#{viewingProfile.rank}</span>
											<span>Lv{Math.floor(viewingProfile.level)}</span>
											<span class="text-g2">&middot;</span>
											<span>{viewingProfile.followerCount} followers</span>
											<span class="text-g2">&middot;</span>
											<span>{viewingProfile.followingCount} following</span>
											{#if viewingProfile.isFollowedBy}
												<span class="rounded bg-grn/10 px-1 py-px text-[9px] text-grn">Follows you</span>
											{/if}
										</div>
									</div>
								</div>
							</div>
							<div class="grid grid-cols-5 gap-px border-t border-bd bg-bd">
								<div class="bg-s5 py-2.5 text-center">
									<div class="text-sm font-bold {viewingProfile.winRatePct >= 50 ? 'text-grn' : viewingProfile.winRatePct > 0 ? 'text-yel' : 'text-red'}">{viewingProfile.winRatePct.toFixed(0)}%</div>
									<div class="text-[9px] text-g5">Win</div>
								</div>
								<div class="bg-s5 py-2.5 text-center">
									<div class="text-sm font-bold text-tx"><span class="text-grn">{viewingProfile.wins}</span><span class="text-g2">/</span><span class="text-red">{viewingProfile.losses}</span></div>
									<div class="text-[9px] text-g5">W/L</div>
								</div>
								<div class="bg-s5 py-2.5 text-center">
									<div class="truncate px-1 text-sm font-bold {viewingProfile.totalPnlUsd >= 0 ? 'text-grn' : 'text-red'}">{formatUsd(viewingProfile.totalPnlUsd)}</div>
									<div class="text-[9px] text-g5">PnL</div>
								</div>
								<div class="bg-s5 py-2.5 text-center">
									<div class="text-sm font-bold text-tx">{viewingProfile.totalTrades}</div>
									<div class="text-[9px] text-g5">Trades</div>
								</div>
								<div class="bg-s5 py-2.5 text-center">
									<div class="truncate px-1 text-sm font-bold text-tx">{formatUsd(viewingProfile.totalWageredUsd)}</div>
									<div class="text-[9px] text-g5">Wagered</div>
								</div>
							</div>
							<div class="grid grid-cols-3 gap-px bg-bd">
								<div class="bg-s5 py-2 text-center">
									<div class="text-sm font-bold text-tx">{viewingProfile.affiliateCount}</div>
									<div class="text-[9px] text-g5">Referrals</div>
								</div>
								<div class="bg-s5 py-2 text-center">
									<div class="text-sm font-bold text-tx">{viewingProfile.followerCount}</div>
									<div class="text-[9px] text-g5">Followers</div>
								</div>
								<div class="bg-s5 py-2 text-center">
									<div class="text-sm font-bold text-tx">{viewingProfile.followingCount}</div>
									<div class="text-[9px] text-g5">Following</div>
								</div>
							</div>
							{#if viewingProfile.profitChart.length > 0}
								{@const vp = viewingProfile}
								{@const vpts = vp.profitChart.length > 1 ? vp.profitChart : [vp.profitChart[0], vp.profitChart[0]]}
								{@const vvals = vpts.map(p => p.valueUsd)}
								{@const vmin = Math.min(...vvals)}
								{@const vmax = Math.max(...vvals)}
								{@const vrange = vmax - vmin || 1}
								{@const vw = 400}
								{@const vh = 40}
								{@const vstep = vw / (vvals.length - 1)}
								{@const vpoints = vvals.map((v, i) => `${(i * vstep).toFixed(1)},${(vh - 2 - ((v - vmin) / vrange) * (vh - 4)).toFixed(1)}`)}
								{@const vlastVal = vvals[vvals.length - 1]}
								{@const vcolor = vlastVal >= 0 ? 'var(--t-grn)' : 'var(--t-red)'}
								<div class="px-4 py-2">
									<svg viewBox="0 0 {vw} {vh}" class="w-full h-8" preserveAspectRatio="none">
										<defs>
											<linearGradient id="vp-pnl-fill" x1="0" y1="0" x2="0" y2="1">
												<stop offset="0%" stop-color={vcolor} stop-opacity="0.2" />
												<stop offset="100%" stop-color={vcolor} stop-opacity="0" />
											</linearGradient>
										</defs>
										<polygon points="{vpoints.join(' ')} {vw},{vh} 0,{vh}" fill="url(#vp-pnl-fill)" />
										<polyline points={vpoints.join(' ')} fill="none" stroke={vcolor} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
									</svg>
								</div>
							{/if}
							{#if viewingProfile.id !== profile?.id}
								<div class="p-4">
									<button
										onclick={() => viewingProfile && toggleFollow(viewingProfile)}
										disabled={followToggling.has(viewingProfile.id)}
										class="w-full cursor-pointer rounded-lg py-2.5 text-xs font-semibold transition-all disabled:opacity-50 {viewingProfile.isFollowing
											? 'border border-bd bg-s7 text-g7 hover:border-red/40 hover:text-red'
											: 'bg-grn text-s0'}"
									>
										{#if followToggling.has(viewingProfile.id)}
											<LoaderCircle class="mx-auto h-3.5 w-3.5 animate-spin" />
										{:else if viewingProfile.isFollowing}
											Unfollow
										{:else}
											Follow
										{/if}
									</button>
								</div>
							{/if}
						</div>
					</div>
				{/if}

			{:else if activeTab === 'telegram'}
				{#if tgLoading}
					<div class="skeleton h-40 rounded-xl"></div>
				{:else if tgLoggedIn}
					<div class="space-y-4">
						<div class="rounded-xl border border-bd bg-s1 p-6">
							<div class="mb-4 flex items-center justify-between">
								<div class="flex items-center gap-2">
									<div class="h-2 w-2 rounded-full bg-grn"></div>
									<span class="text-base font-semibold text-tx">Telegram Connected</span>
								</div>
								<div class="flex items-center gap-2">
									<button onclick={syncTgChats} disabled={tgSyncing} class="btn-primary px-3 py-1.5 text-xs">{tgSyncing ? 'Syncing...' : 'Sync Chats'}</button>
									<button onclick={tgLogout} disabled={tgDisconnecting} class="btn-danger px-3 py-1.5 text-xs">Disconnect</button>
								</div>
							</div>

							{#if tgChatsLoading}
								<div class="space-y-2">
									{#each Array(3) as _, i}
										<div class="skeleton h-10 rounded-md" style="animation-delay: {i * 80}ms"></div>
									{/each}
								</div>
							{:else if tgChats.length === 0}
								<div class="rounded-lg border border-bd bg-s1 p-6 text-center">
									<span class="text-sm text-g6">No chats found. Click "Sync Chats" to fetch your Telegram groups.</span>
								</div>
							{:else}
								{#if tgChats.length > 5}
									<input
										type="text"
										bind:value={tgChatSearch}
										placeholder="Search chats..."
										class="mb-2 w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none placeholder-g3"
									/>
								{/if}
								<div class="rounded border border-bd bg-s1">
									{#each filteredTgChats as chat (chat.chatId)}
										<div class="flex items-center justify-between gap-3 border-b border-bd/30 px-4 py-3 last:border-0">
											<div class="flex min-w-0 flex-1 items-center gap-3">
												{#if avatarUrl(chat.photoId)}
													<img src={avatarUrl(chat.photoId)} alt="" loading="lazy" class="h-8 w-8 shrink-0 rounded-full object-cover" />
												{:else}
													<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-s7 text-sm font-bold text-g11">
														{chat.chatName?.[0]?.toUpperCase() ?? '#'}
													</div>
												{/if}
												<div class="min-w-0">
													<div class="truncate text-sm font-medium text-tx">{chat.chatName}</div>
													<div class="flex items-center gap-2 text-xs text-g6">
														<span>{chat.chatType}</span>
														{#if chat.isSuperGroup}
															<span class="rounded-md bg-s7 px-1 py-0.5 text-g7">supergroup</span>
														{/if}
														{#if chat.pendingTask}
															<span class="rounded bg-yel/10 px-1 py-0.5 text-yel">syncing</span>
														{/if}
													</div>
												</div>
											</div>
											<button
												class="relative h-5 w-9 cursor-pointer rounded-full transition-colors {chat.isEnabled ? 'bg-grn' : 'bg-bd2'}"
												onclick={() => toggleChat(chat.chatId, !chat.isEnabled)}
												aria-label="Toggle chat {chat.chatName}"
											>
												<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {chat.isEnabled ? 'left-[18px]' : 'left-0.5'}"></div>
											</button>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div class="rounded-xl border border-bd bg-s1 p-6">
						<h2 class="mb-2 text-base font-semibold text-tx">Connect Telegram</h2>
						<p class="mb-4 text-xs text-g7">Link your Telegram account to receive call alerts from your groups and channels.</p>

						<TgLoginForm onsuccess={() => { tgLoggedIn = true; fetchTgChats(); }} />
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

{#if withdrawingAsset}
	<WalletWithdrawModal
		chain={withdrawingAsset.chain}
		asset={withdrawingAsset.asset}
		onclose={() => (withdrawingAsset = null)}
		oncomplete={completeAssetWithdrawal}
	/>
{/if}

<ImageCropper bind:show={showCropper} onconfirm={async (base64) => {
	profilePicUploading = true;
	try {
		const { data } = await api.POST('/v2/user/profile-picture' as never, {
			body: { imageData: base64 }
		} as never);
		const resp = data as unknown as { photoId?: string } | undefined;
		if (resp?.photoId && profile) {
			setProfile({ ...profile, photoId: resp.photoId });
		}
	} catch {} finally {
		profilePicUploading = false;
	}
}} />

{#if profile}
	<PnlCalendarModal bind:show={showPnlCalendar} data={profile.profitChart} />
{/if}

<MobileScanModal bind:show={showMobileScan} />

{#snippet userCard(user: ProfileResponse)}
	<!-- Mobile: compact row -->
	<button onclick={() => viewUserProfile(user)} class="group md:hidden w-full cursor-pointer rounded-lg border border-bd bg-s1 px-3 py-2.5 text-left transition-all hover:border-bd3 hover:bg-wh/5">
		<div class="flex items-center gap-2.5">
			{#if avatarUrl(user.photoId)}
				<img src={avatarUrl(user.photoId)} alt="" class="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-grn/20" />
			{:else}
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-grn/15 to-grn/5 text-xs font-bold text-grn ring-1 ring-grn/20">
					{user.username ? user.username[0].toUpperCase() : '?'}
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<span class="truncate text-sm font-semibold text-tx">{user.username || 'Anonymous'}</span>
					{#if user.isFollowedBy}
						<span class="shrink-0 rounded bg-grn/10 px-1 py-px text-[9px] text-grn">Follows you</span>
					{/if}
				</div>
				<div class="flex items-center gap-1.5 text-[10px] text-g5">
					<span>#{user.rank}</span>
					<span class="text-g2">&middot;</span>
					<span>Lv{Math.floor(user.level)}</span>
					<span class="text-g2">&middot;</span>
					<span>{user.totalTrades} trades</span>
					<span class="text-g2">&middot;</span>
					<span class="{user.winRatePct >= 50 ? 'text-grn' : user.winRatePct > 0 ? 'text-yel' : 'text-red'}">{user.winRatePct.toFixed(0)}%</span>
					<span class="text-g2">&middot;</span>
					<span class="{user.totalPnlUsd >= 0 ? 'text-grn' : 'text-red'}">{formatUsd(user.totalPnlUsd)}</span>
				</div>
			</div>
			{#if user.id !== profile?.id}
				<div
					onclick={(e) => { e.stopPropagation(); toggleFollow(user); }}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleFollow(user); } }}
					class="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all {followToggling.has(user.id) ? 'opacity-50' : ''} {user.isFollowing
						? 'border border-bd text-g7 hover:border-red/40 hover:text-red'
						: 'bg-grn/10 text-grn ring-1 ring-grn/20 hover:bg-grn/20'}"
					role="button"
					tabindex="0"
				>
					{#if followToggling.has(user.id)}
						<LoaderCircle class="h-3 w-3 animate-spin" />
					{:else if user.isFollowing}
						<UserMinus class="h-3 w-3" />
					{:else}
						<UserPlus class="h-3 w-3" />
					{/if}
				</div>
			{/if}
		</div>
	</button>
	<!-- Desktop: full card -->
	<button onclick={() => viewUserProfile(user)} class="group hidden md:block w-full cursor-pointer overflow-hidden rounded-xl border border-bd bg-s1 text-left transition-all hover:border-bd3 hover:bg-wh/5">
		<div class="flex items-center justify-between gap-3 p-4 pb-3">
			<div class="flex items-center gap-3 min-w-0">
				{#if avatarUrl(user.photoId)}
					<img src={avatarUrl(user.photoId)} alt="" class="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-grn/20" />
				{:else}
					<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-grn/15 to-grn/5 text-sm font-bold text-grn ring-1 ring-grn/20">
						{user.username ? user.username[0].toUpperCase() : '?'}
					</div>
				{/if}
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<span class="truncate text-base font-bold text-tx group-hover:text-wh">{user.username || 'Anonymous'}</span>
						{#if user.isFollowedBy}
							<span class="shrink-0 rounded bg-grn/10 px-1.5 py-0.5 text-[10px] text-grn">Follows you</span>
						{/if}
					</div>
					<div class="mt-0.5 flex items-center gap-2 text-[11px] text-g5">
						<span class="rounded bg-s7 px-1.5 py-0.5 text-g9">#{user.rank}</span>
						<span>Level {Math.floor(user.level)}</span>
						<span class="text-g2">&middot;</span>
						<span>{user.followerCount} followers</span>
					</div>
				</div>
			</div>
			{#if user.id !== profile?.id}
				<div
					onclick={(e) => { e.stopPropagation(); toggleFollow(user); }}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleFollow(user); } }}
					class="shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all {followToggling.has(user.id) ? 'opacity-50' : ''} {user.isFollowing
						? 'border border-bd text-g7 hover:border-red/40 hover:text-red'
						: 'bg-grn/10 text-grn ring-1 ring-grn/20 hover:bg-grn/20'}"
					role="button"
					tabindex="0"
				>
					{#if followToggling.has(user.id)}
						<LoaderCircle class="h-3.5 w-3.5 animate-spin" />
					{:else if user.isFollowing}
						<span class="flex items-center gap-1.5"><UserMinus class="h-3.5 w-3.5" /> Unfollow</span>
					{:else}
						<span class="flex items-center gap-1.5"><UserPlus class="h-3.5 w-3.5" /> Follow</span>
					{/if}
				</div>
			{/if}
		</div>
		<div class="grid grid-cols-5 gap-px border-t border-bd bg-bd">
			<div class="bg-s1 group-hover:bg-wh/5 px-2 py-2.5 text-center transition-colors">
				<div class="text-sm font-bold {user.winRatePct >= 50 ? 'text-grn' : user.winRatePct > 0 ? 'text-yel' : 'text-red'}">{user.winRatePct.toFixed(1)}%</div>
				<div class="text-[9px] text-g5">Win Rate</div>
			</div>
			<div class="bg-s1 group-hover:bg-wh/5 px-2 py-2.5 text-center transition-colors">
				<div class="text-sm font-bold text-tx"><span class="text-grn">{user.wins}</span><span class="text-g2">/</span><span class="text-red">{user.losses}</span></div>
				<div class="text-[9px] text-g5">W / L</div>
			</div>
			<div class="bg-s1 group-hover:bg-wh/5 px-2 py-2.5 text-center transition-colors">
				<div class="truncate text-sm font-bold {user.totalPnlUsd >= 0 ? 'text-grn' : 'text-red'}">{formatUsd(user.totalPnlUsd)}</div>
				<div class="text-[9px] text-g5">PnL</div>
			</div>
			<div class="bg-s1 group-hover:bg-wh/5 px-2 py-2.5 text-center transition-colors">
				<div class="text-sm font-bold text-tx">{user.totalTrades}</div>
				<div class="text-[9px] text-g5">Trades</div>
			</div>
			<div class="bg-s1 group-hover:bg-wh/5 px-2 py-2.5 text-center transition-colors">
				<div class="truncate text-sm font-bold text-tx">{formatUsd(user.totalWageredUsd)}</div>
				<div class="text-[9px] text-g5">Wagered</div>
			</div>
		</div>
	</button>
{/snippet}
