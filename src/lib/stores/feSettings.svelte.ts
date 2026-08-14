import { browser } from '$app/environment';

const STORAGE_KEY = 'ombra_fe_settings';

interface FeSettings {
	expandPositions: boolean;
	watchlistOpen: boolean;
	twitterFeedCollapsed: boolean;
	twitterFeedHeightPct: number;
	twitterFeedPopout: boolean;
	twitterFeedFloat: { x: number; y: number; w: number; h: number };
	tradePanelCollapsed: boolean;
	tradePanelPopout: boolean;
	tradePanelFloat: { x: number; y: number; w: number; h: number };
	bubbleWatchlist: boolean;
	multiTab: boolean;
}

const defaults: FeSettings = {
	expandPositions: false,
	watchlistOpen: true,
	twitterFeedCollapsed: false,
	twitterFeedHeightPct: 45,
	twitterFeedPopout: false,
	twitterFeedFloat: { x: 80, y: 80, w: 380, h: 520 },
	tradePanelCollapsed: false,
	tradePanelPopout: false,
	tradePanelFloat: { x: 120, y: 100, w: 340, h: 560 },
	bubbleWatchlist: false,
	multiTab: false,
};

let settings = $state<FeSettings>({ ...defaults });

function persist() {
	if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function initFeSettings() {
	if (!browser) return;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) settings = { ...defaults, ...JSON.parse(stored) };
	} catch {}
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

let activeToken = $state('');

export function getActiveToken(): string {
	return activeToken;
}

export function setActiveToken(address: string) {
	activeToken = address;
}
