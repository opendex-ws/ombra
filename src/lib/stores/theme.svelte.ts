import { browser } from '$app/environment';
import { type ThemeSeed, type ThemeVars, seedToVars, applyVars, clearCustomVars, DARK_SEED, LIGHT_SEED } from '$lib/utils/themeColors';

type ThemeMode = 'dark' | 'light' | 'custom';

const STORAGE_KEY = 'ombra_theme';
const CUSTOM_KEY = 'ombra_custom_theme';

let theme = $state<ThemeMode>('dark');
let customSeed = $state<ThemeSeed | null>(null);
let themeVersion = $state(0);

function applyTheme(t: ThemeMode) {
	if (!browser) return;
	clearCustomVars();
	if (t === 'custom' && customSeed) {
		document.documentElement.setAttribute('data-theme', customSeed.isDark ? 'dark' : 'light');
		const vars = seedToVars(customSeed);
		applyVars(vars);
	} else {
		document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
	}
	localStorage.setItem(STORAGE_KEY, t);
}

export function initTheme() {
	if (!browser) return;
	const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
	try {
		const raw = localStorage.getItem(CUSTOM_KEY);
		if (raw) customSeed = JSON.parse(raw);
	} catch {}
	theme = stored === 'light' ? 'light' : stored === 'custom' ? 'custom' : 'dark';
	applyTheme(theme);
}

export function getTheme(): ThemeMode {
	void themeVersion;
	return theme;
}

export function getThemeVersion(): number {
	return themeVersion;
}

export function toggleTheme() {
	theme = theme === 'dark' ? 'light' : 'dark';
	applyTheme(theme);
}

export function isDark(): boolean {
	if (theme === 'custom' && customSeed) return customSeed.isDark;
	return theme === 'dark';
}

const VARS_KEY = 'ombra_custom_vars';

export function setCustomTheme(seed: ThemeSeed): void {
	customSeed = seed;
	theme = 'custom';
	if (browser) {
		localStorage.setItem(CUSTOM_KEY, JSON.stringify(seed));
		localStorage.setItem(VARS_KEY, JSON.stringify(seedToVars(seed)));
	}
	applyTheme('custom');
	themeVersion++;
}

export function getCustomSeed(): ThemeSeed | null {
	return customSeed;
}

export function previewTheme(seed: ThemeSeed): void {
	if (!browser) return;
	document.documentElement.setAttribute('data-theme', seed.isDark ? 'dark' : 'light');
	applyVars(seedToVars(seed));
}

export function resetToBuiltin(mode: 'dark' | 'light'): void {
	theme = mode;
	customSeed = null;
	if (browser) {
		localStorage.removeItem(CUSTOM_KEY);
		localStorage.removeItem(VARS_KEY);
	}
	applyTheme(mode);
	themeVersion++;
}

// Dark-theme (:root) defaults, used only when getComputedStyle can't yet resolve
// a CSS var (e.g. a canvas chart reading colors before the stylesheet applies on
// a cold load). Keep in sync with app.css :root.
const TC_FALLBACKS: Record<string, string> = {
	'--t-grn': '#00ff88',
	'--t-red': '#ff4466',
	'--t-s0': '#000000',
	'--t-s4': '#161616',
	'--t-s5': '#1a1a1a',
	'--t-s7': '#252525',
	'--t-s8': '#2a2a2a',
	'--t-bd': '#2a2a2a',
	'--t-bd2': '#333333',
	'--t-g7': '#888888',
	'--t-g11': '#cccccc',
	'--t-tx': '#e0e0e0',
	'--t-yel': '#ffaa00',
	'--t-yel-dark': '#cc8800',
	'--t-blu-light': '#66bbff',
	'--t-org': '#ff8833',
	'--t-red-dark': '#aa2233',
	'--t-grn-darker': '#006633',
};

export function tc(varName: string): string {
	if (!browser) return TC_FALLBACKS[varName] ?? '#888888';
	const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
	return val || TC_FALLBACKS[varName] || '#888888';
}
