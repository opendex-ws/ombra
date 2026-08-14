import { browser } from '$app/environment';
import type { Chain } from '$lib/api/types';

export interface TokenTab {
	chain: Chain;
	address: string;
	symbol: string;
}

export interface TokenPopout {
	id: string;
	chain: Chain;
	address: string;
	symbol: string;
	x: number;
	y: number;
	w: number;
	h: number;
	z: number;
}

const MAX_TABS = 5;
const MAX_POPOUTS = 5;
const STORAGE_KEY = 'ombra_token_tabs';
const POPOUT_STORAGE_KEY = 'ombra_token_popouts';

let tabs = $state<TokenTab[]>([]);
let popouts = $state<TokenPopout[]>([]);
let focusedPopoutId = $state<string | null>(null);
let zCounter = 1;

function persist() {
	if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
}

function persistPopouts() {
	if (browser) localStorage.setItem(POPOUT_STORAGE_KEY, JSON.stringify(popouts));
}

export function initTokenTabs() {
	if (!browser) return;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed)) {
				tabs = parsed
					.filter((t) => t && typeof t.chain === 'string' && typeof t.address === 'string')
					.slice(0, MAX_TABS)
					.map((t) => ({ chain: t.chain, address: t.address, symbol: typeof t.symbol === 'string' ? t.symbol : '' }));
			}
		}
	} catch {}
	try {
		const stored = localStorage.getItem(POPOUT_STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed)) {
				popouts = parsed
					.filter((p) => p && typeof p.chain === 'string' && typeof p.address === 'string')
					.slice(0, MAX_POPOUTS)
					.map((p, i) => ({
						id: typeof p.id === 'string' ? p.id : `po_${Date.now()}_${i}`,
						chain: p.chain,
						address: p.address,
						symbol: typeof p.symbol === 'string' ? p.symbol : '',
						x: typeof p.x === 'number' ? p.x : 120 + i * 24,
						y: typeof p.y === 'number' ? p.y : 100 + i * 24,
						w: typeof p.w === 'number' ? p.w : 420,
						h: typeof p.h === 'number' ? p.h : 460,
						z: typeof p.z === 'number' ? p.z : i + 1
					}));
				zCounter = popouts.reduce((m, p) => Math.max(m, p.z), 0) + 1;
				if (popouts.length > 0) focusedPopoutId = popouts.reduce((a, b) => (a.z > b.z ? a : b)).id;
			}
		}
	} catch {}
}

export function getTokenTabs(): TokenTab[] {
	return tabs;
}

export function openTokenTab(chain: Chain, address: string, symbol = '') {
	const existing = tabs.findIndex((t) => t.chain === chain && t.address === address);
	if (existing !== -1) {
		if (symbol && !tabs[existing].symbol) {
			tabs[existing].symbol = symbol;
			persist();
		}
		return;
	}
	if (tabs.length >= MAX_TABS) {
		tabs[tabs.length - 1] = { chain, address, symbol };
	} else {
		tabs.push({ chain, address, symbol });
	}
	persist();
}

export function closeTokenTab(chain: Chain, address: string) {
	const idx = tabs.findIndex((t) => t.chain === chain && t.address === address);
	if (idx !== -1) {
		tabs.splice(idx, 1);
		persist();
	}
}

// A popped-out window IS a tab that's just floating: register it as a tab
// (respecting the 5-tab limit, replace-last on overflow — and closing the
// replaced tab's floating window) AND open/refocus its floating window.
export function openTokenAsPopout(chain: Chain, address: string, symbol = ''): string {
	const existing = tabs.findIndex((t) => t.chain === chain && t.address === address);
	if (existing === -1) {
		if (tabs.length >= MAX_TABS) {
			const replaced = tabs[tabs.length - 1];
			const rp = popouts.find((p) => p.chain === replaced.chain && p.address === replaced.address);
			if (rp) closePopout(rp.id);
			tabs[tabs.length - 1] = { chain, address, symbol };
		} else {
			tabs.push({ chain, address, symbol });
		}
		persist();
	} else if (symbol && !tabs[existing].symbol) {
		tabs[existing].symbol = symbol;
		persist();
	}
	return popoutToken(chain, address, symbol);
}

export function updateTabSymbol(chain: Chain, address: string, symbol: string) {
	if (!symbol) return;
	const t = tabs.find((t) => t.chain === chain && t.address === address);
	if (t && t.symbol !== symbol) {
		t.symbol = symbol;
		persist();
	}
}

export function clearTokenTabs() {
	tabs = [];
	persist();
}

export function getPopouts(): TokenPopout[] {
	return popouts;
}

export function getFocusedPopoutId(): string | null {
	return focusedPopoutId;
}

export function hasPopouts(): boolean {
	return popouts.length > 0;
}

export function popoutToken(chain: Chain, address: string, symbol = ''): string {
	const existing = popouts.find((p) => p.chain === chain && p.address === address);
	if (existing) {
		focusPopout(existing.id);
		return existing.id;
	}
	const id = `po_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
	const offset = (popouts.length % 6) * 28;
	if (popouts.length >= MAX_POPOUTS) popouts.shift();
	popouts.push({
		id,
		chain,
		address,
		symbol,
		x: 160 + offset,
		y: 96 + offset,
		w: 420,
		h: 460,
		z: ++zCounter
	});
	focusedPopoutId = id;
	persistPopouts();
	return id;
}

export function closePopout(id: string) {
	const idx = popouts.findIndex((p) => p.id === id);
	if (idx === -1) return;
	popouts.splice(idx, 1);
	if (focusedPopoutId === id) {
		focusedPopoutId = popouts.length > 0 ? popouts.reduce((a, b) => (a.z > b.z ? a : b)).id : null;
	}
	persistPopouts();
}

// Fully dismiss a token: close its floating window AND remove its tab, so it
// disappears from the dock too. (restoreToTab keeps the tab; the X removes both.)
export function closePopoutAndTab(id: string) {
	const p = popouts.find((p) => p.id === id);
	if (p) closeTokenTab(p.chain, p.address);
	closePopout(id);
}

let suppressRedirectOnce = false;

export function suppressPopoutRedirect() {
	suppressRedirectOnce = true;
}

export function consumePopoutRedirectSuppressed(): boolean {
	if (suppressRedirectOnce) {
		suppressRedirectOnce = false;
		return true;
	}
	return false;
}

export function focusPopout(id: string) {
	const p = popouts.find((p) => p.id === id);
	if (!p) return;
	focusedPopoutId = id;
	if (p.z < zCounter) {
		p.z = ++zCounter;
		persistPopouts();
	}
}

export function setPopoutPos(id: string, x: number, y: number) {
	const p = popouts.find((p) => p.id === id);
	if (!p) return;
	p.x = x;
	p.y = y;
	persistPopouts();
}

export function setPopoutSize(id: string, w: number, h: number) {
	const p = popouts.find((p) => p.id === id);
	if (!p) return;
	p.w = w;
	p.h = h;
	persistPopouts();
}

export function setPopoutToken(id: string, chain: Chain, address: string, symbol = '') {
	const p = popouts.find((p) => p.id === id);
	if (!p) return;
	p.chain = chain;
	p.address = address;
	p.symbol = symbol;
	persistPopouts();
}

export function updatePopoutSymbol(id: string, symbol: string) {
	if (!symbol) return;
	const p = popouts.find((p) => p.id === id);
	if (p && p.symbol !== symbol) {
		p.symbol = symbol;
		persistPopouts();
	}
}
