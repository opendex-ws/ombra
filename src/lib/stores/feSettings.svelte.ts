import { browser } from '$app/environment';

const STORAGE_KEY = 'ombra_fe_settings';

interface FeSettings {
	expandPositions: boolean;
	watchlistOpen: boolean;
	twitterFeedCollapsed: boolean;
	twitterFeedHeightPct: number;
	twitterFeedPopout: boolean;
	twitterFeedFloat: { x: number; y: number; w: number; h: number };
	/** Social feed: which tab is docked, and the swaps tab's own popout window. */
	socialFeedTab: 'x' | 'swaps' | 'thesis';
	/** Swaps tab filters, so a refresh keeps the view you set up. */
	swapFeedFilters: {
		feedMode: 'all' | 'mine';
		side: '' | 'BUY' | 'SELL';
		minUsd: number;
		maxUsd: number | null;
		labels: string[];
		sources: string[];
	};
	/** Swaps tab: one-line rows instead of the full card. */
	swapFeedCompact: boolean;
	swapFeedPopout: boolean;
	swapFeedFloat: { x: number; y: number; w: number; h: number };
	thesisFeedPopout: boolean;
	thesisFeedFloat: { x: number; y: number; w: number; h: number };
	tradePanelCollapsed: boolean;
	tradePanelPopout: boolean;
	tradePanelFloat: { x: number; y: number; w: number; h: number };
	bubbleWatchlist: boolean;
	multiTab: boolean;
	moneyFlow: boolean;
	/**
	 * Memescope filters, kept per column so each one holds the view you set up.
	 * `platforms` is an array because a Set does not survive JSON.
	 */
	memescopeFilters: Record<
		'new' | 'graduating' | 'graduated',
		{ filters: Record<string, string>; platforms: string[]; chain: string }
	>;
	/**
	 * What manual buys are funded with. A preference, not a per-trade choice, so
	 * it lives here rather than in the trade form. `amount` is unaffected — it
	 * still sizes the trade; this only picks the currency that pays for it.
	 * Bots carry their own `buyWith` in their config.
	 */
	buyWith: 'NATIVE' | 'FIAT';
	/** FE-only: watchlist source ids that fire a call toast (per-individual-source). */
	callToastSourceIds: string[];
	/** FE-only: trade ids hidden from the positions list (long-term holds). */
	hiddenTradeIds: number[];
	/** Bumped when a default changes in a way that must override a persisted value. */
	settingsVersion: number;
}

/**
 * Every save writes the whole blob, so a persisted value shadows its default
 * forever. Bump this and add a migration when a new default has to win.
 */
const SETTINGS_VERSION = 2;

const defaults: FeSettings = {
	expandPositions: false,
	watchlistOpen: true,
	twitterFeedCollapsed: false,
	twitterFeedHeightPct: 45,
	twitterFeedPopout: false,
	twitterFeedFloat: { x: 80, y: 80, w: 380, h: 520 },
	socialFeedTab: 'swaps',
	swapFeedFilters: { feedMode: 'all', side: '', minUsd: 10, maxUsd: null, labels: [], sources: [] },
	swapFeedCompact: false,
	swapFeedPopout: false,
	swapFeedFloat: { x: 480, y: 120, w: 400, h: 520 },
	thesisFeedPopout: false,
	thesisFeedFloat: { x: 280, y: 160, w: 400, h: 520 },
	tradePanelCollapsed: false,
	tradePanelPopout: false,
	tradePanelFloat: { x: 120, y: 100, w: 340, h: 560 },
	bubbleWatchlist: false,
	multiTab: false,
	moneyFlow: false,
	memescopeFilters: {
		new: { filters: {}, platforms: [], chain: 'All' },
		graduating: { filters: {}, platforms: [], chain: 'All' },
		graduated: { filters: {}, platforms: [], chain: 'All' }
	},
	buyWith: 'NATIVE',
	callToastSourceIds: [],
	hiddenTradeIds: [],
	settingsVersion: SETTINGS_VERSION,
};

let settings = $state<FeSettings>({ ...defaults });

function persist() {
	if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let hydrated = false;

/**
 * Hydration runs at module load, not from the layout's `onMount`. A child
 * route's `<script>` — including `$state` initialisers that seed local copies
 * from these getters — executes BEFORE the parent layout mounts, so anything
 * reading at component-init time would otherwise get defaults and never see the
 * persisted blob. Module bodies run before any importer's body, so this is the
 * only point that is guaranteed to be early enough.
 */
function hydrate() {
	if (hydrated || !browser) return;
	hydrated = true;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return;
		const parsed = JSON.parse(stored) as Partial<FeSettings>;
		const from = parsed.settingsVersion ?? 1;
		// v2: swaps became the default social tab; drop the value persisted under
		// the old default so the new one applies (an explicit pick re-persists).
		if (from < 2) delete parsed.socialFeedTab;
		settings = { ...defaults, ...parsed, settingsVersion: SETTINGS_VERSION };
		if (from < SETTINGS_VERSION) persist();
	} catch {}
}

if (browser) hydrate();

export function initFeSettings() {
	hydrate();
}

export function getExpandPositions(): boolean {
	return settings.expandPositions;
}

export function toggleExpandPositions() {
	settings.expandPositions = !settings.expandPositions;
	persist();
}

export function getBubbleWatchlist(): boolean {
	return settings.bubbleWatchlist;
}

export function toggleBubbleWatchlist() {
	settings.bubbleWatchlist = !settings.bubbleWatchlist;
	persist();
}

export function getSwapFeedFilters(): FeSettings['swapFeedFilters'] {
	return settings.swapFeedFilters;
}

export function setSwapFeedFilters(next: Partial<FeSettings['swapFeedFilters']>) {
	settings.swapFeedFilters = { ...settings.swapFeedFilters, ...next };
	persist();
}

export function getMemescopeFilters(
	phase: 'new' | 'graduating' | 'graduated'
): FeSettings['memescopeFilters']['new'] {
	return settings.memescopeFilters?.[phase] ?? { filters: {}, platforms: [], chain: 'All' };
}

export function setMemescopeFilters(
	phase: 'new' | 'graduating' | 'graduated',
	next: FeSettings['memescopeFilters']['new']
) {
	settings.memescopeFilters = { ...settings.memescopeFilters, [phase]: next };
	persist();
}

export function getBuyWith(): FeSettings['buyWith'] {
	return settings.buyWith ?? 'NATIVE';
}

export function setBuyWith(next: FeSettings['buyWith']) {
	settings.buyWith = next;
	persist();
}

export function getSwapFeedCompact(): boolean {
	return settings.swapFeedCompact;
}

export function toggleSwapFeedCompact() {
	settings.swapFeedCompact = !settings.swapFeedCompact;
	persist();
}

export function getMoneyFlow(): boolean {
	return settings.moneyFlow;
}

export function toggleMoneyFlow() {
	settings.moneyFlow = !settings.moneyFlow;
	persist();
}

export function getMultiTab(): boolean {
	return settings.multiTab;
}

export function toggleMultiTab() {
	settings.multiTab = !settings.multiTab;
	persist();
}

export function getWatchlistOpen(): boolean {
	return settings.watchlistOpen;
}

export function setWatchlistOpen(open: boolean) {
	settings.watchlistOpen = open;
	persist();
}

export function toggleWatchlistOpen() {
	settings.watchlistOpen = !settings.watchlistOpen;
	persist();
}

export function getTwitterFeedCollapsed(): boolean {
	return settings.twitterFeedCollapsed;
}

export function toggleTwitterFeedCollapsed() {
	settings.twitterFeedCollapsed = !settings.twitterFeedCollapsed;
	persist();
}

export function getTwitterFeedHeightPct(): number {
	return settings.twitterFeedHeightPct;
}

export function getTwitterFeedPopout(): boolean {
	return settings.twitterFeedPopout;
}

export function setTwitterFeedPopout(popout: boolean) {
	settings.twitterFeedPopout = popout;
	persist();
}

export function getTwitterFeedFloat(): { x: number; y: number; w: number; h: number } {
	return settings.twitterFeedFloat;
}

export function setTwitterFeedFloatPos(x: number, y: number) {
	settings.twitterFeedFloat = { ...settings.twitterFeedFloat, x, y };
	persist();
}

export function setTwitterFeedFloatSize(w: number, h: number) {
	settings.twitterFeedFloat = { ...settings.twitterFeedFloat, w, h };
	persist();
}

export function setTwitterFeedHeightPct(pct: number) {
	settings.twitterFeedHeightPct = Math.min(80, Math.max(15, pct));
	persist();
}

export function getTradePanelCollapsed(): boolean {
	return settings.tradePanelCollapsed;
}

export function toggleTradePanelCollapsed() {
	settings.tradePanelCollapsed = !settings.tradePanelCollapsed;
	persist();
}

export function getTradePanelPopout(): boolean {
	return settings.tradePanelPopout;
}

export function setTradePanelPopout(popout: boolean) {
	settings.tradePanelPopout = popout;
	persist();
}

export function getTradePanelFloat(): { x: number; y: number; w: number; h: number } {
	return settings.tradePanelFloat;
}

export function setTradePanelFloatPos(x: number, y: number) {
	settings.tradePanelFloat = { ...settings.tradePanelFloat, x, y };
	persist();
}

export function setTradePanelFloatSize(w: number, h: number) {
	settings.tradePanelFloat = { ...settings.tradePanelFloat, w, h };
	persist();
}

// --- Call toast source enablement (per-individual-source) ---------------------
// Ids are namespaced by source type ("tg:<id>", "lists:<id>", "wallets:<id>") so
// they can't collide across families.
export function getCallToastSourceIds(): string[] {
	return settings.callToastSourceIds;
}

export function isCallToastSourceEnabled(id: string): boolean {
	return settings.callToastSourceIds.includes(id);
}

export function toggleCallToastSource(id: string) {
	settings.callToastSourceIds = settings.callToastSourceIds.includes(id)
		? settings.callToastSourceIds.filter((s) => s !== id)
		: [...settings.callToastSourceIds, id];
	persist();
}

export function getCallToastCount(): number {
	return settings.callToastSourceIds.length;
}

let activeToken = $state('');

export function getActiveToken(): string {
	return activeToken;
}

export function setActiveToken(address: string) {
	activeToken = address;
}

/**
 * Hidden trades — a local "don't tempt me" list for long-term holds. FE-only and
 * per-browser: hiding is a UI preference, not a change to the position itself.
 */
export function getHiddenTradeIds(): number[] {
	return settings.hiddenTradeIds;
}

export function isTradeHidden(id: number): boolean {
	return settings.hiddenTradeIds.includes(id);
}

export function toggleTradeHidden(id: number) {
	settings.hiddenTradeIds = settings.hiddenTradeIds.includes(id)
		? settings.hiddenTradeIds.filter((t) => t !== id)
		: [...settings.hiddenTradeIds, id];
	persist();
}

export function getSocialFeedTab(): 'x' | 'swaps' | 'thesis' {
	return settings.socialFeedTab;
}

export function setSocialFeedTab(tab: 'x' | 'swaps' | 'thesis') {
	settings.socialFeedTab = tab;
	persist();
}

/** The swaps feed pops out independently of the X feed. */
export function getSwapFeedPopout(): boolean {
	return settings.swapFeedPopout;
}

export function setSwapFeedPopout(popout: boolean) {
	settings.swapFeedPopout = popout;
	persist();
}

export function getSwapFeedFloat(): { x: number; y: number; w: number; h: number } {
	return settings.swapFeedFloat;
}

export function setSwapFeedFloatPos(x: number, y: number) {
	settings.swapFeedFloat = { ...settings.swapFeedFloat, x, y };
	persist();
}

export function setSwapFeedFloatSize(w: number, h: number) {
	settings.swapFeedFloat = { ...settings.swapFeedFloat, w, h };
	persist();
}

/** The thesis feed pops out independently of the other two. */
export function getThesisFeedPopout(): boolean {
	return settings.thesisFeedPopout;
}

export function setThesisFeedPopout(popout: boolean) {
	settings.thesisFeedPopout = popout;
	persist();
}

export function getThesisFeedFloat(): { x: number; y: number; w: number; h: number } {
	return settings.thesisFeedFloat;
}

export function setThesisFeedFloatPos(x: number, y: number) {
	settings.thesisFeedFloat = { ...settings.thesisFeedFloat, x, y };
	persist();
}

export function setThesisFeedFloatSize(w: number, h: number) {
	settings.thesisFeedFloat = { ...settings.thesisFeedFloat, w, h };
	persist();
}
