import { browser } from '$app/environment';

export interface ThemeBg {
	url: string;
	dim: number;
	blur: number;
	surfaceAlpha: number;
}

const STORAGE_KEY = 'ombra_bg';
const CUSTOM_KEY = 'ombra_bg_custom';

export interface CustomWallpaper {
	id: string;
	name: string;
	url: string;
}

const defaults: ThemeBg = {
	url: '',
	dim: 0.4,
	blur: 2,
	surfaceAlpha: 0.85
};

let bg = $state<ThemeBg>({ ...defaults });
let customWallpapers = $state<CustomWallpaper[]>([]);

function apply() {
	if (!browser) return;
	const el = document.documentElement.style;
	if (bg.url) {
		el.setProperty('--bg-image', `url("${bg.url}")`);
		el.setProperty('--bg-dim', String(bg.dim));
		el.setProperty('--bg-blur', `${bg.blur}px`);
		el.setProperty('--surface-alpha', String(bg.surfaceAlpha));
		document.documentElement.setAttribute('data-bg', 'on');
	} else {
		el.removeProperty('--bg-image');
		el.removeProperty('--bg-dim');
		el.removeProperty('--bg-blur');
		el.removeProperty('--surface-alpha');
		document.documentElement.removeAttribute('data-bg');
	}
}

function persist() {
	if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(bg));
}

function persistCustom() {
	if (browser) localStorage.setItem(CUSTOM_KEY, JSON.stringify(customWallpapers));
}

export function initThemeBg() {
	if (!browser) return;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) bg = { ...defaults, ...JSON.parse(raw) };
	} catch {}
	try {
		const raw = localStorage.getItem(CUSTOM_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) customWallpapers = parsed.filter((w) => w && typeof w.url === 'string');
		}
	} catch {}
	apply();
}

export function getCustomWallpapers(): CustomWallpaper[] {
	return customWallpapers;
}

export function addCustomWallpaper(url: string, name?: string): CustomWallpaper {
	const existing = customWallpapers.find((w) => w.url === url);
	if (existing) return existing;
	const wp: CustomWallpaper = {
		id: `wp_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
		name: name || `Custom ${customWallpapers.length + 1}`,
		url
	};
	customWallpapers = [...customWallpapers, wp];
	persistCustom();
	return wp;
}

export function removeCustomWallpaper(id: string) {
	customWallpapers = customWallpapers.filter((w) => w.id !== id);
	persistCustom();
}

export function getThemeBg(): ThemeBg {
	return bg;
}

export function setThemeBg(next: Partial<ThemeBg>) {
	bg = { ...bg, ...next };
	apply();
	persist();
}

export function clearThemeBg() {
	bg = { ...defaults, url: '' };
	apply();
	persist();
}
