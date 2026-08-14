export interface HSL { h: number; s: number; l: number }

export function hexToHsl(hex: string): HSL {
	hex = hex.replace('#', '');
	const r = parseInt(hex.slice(0, 2), 16) / 255;
	const g = parseInt(hex.slice(2, 4), 16) / 255;
	const b = parseInt(hex.slice(4, 6), 16) / 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h = 0, s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
		else if (max === g) h = ((b - r) / d + 2) / 6;
		else h = ((r - g) / d + 4) / 6;
	}
	return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
	s /= 100; l /= 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
	return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

function lerpHex(a: string, b: string, t: number): string {
	const ah = hexToHsl(a), bh = hexToHsl(b);
	return hslToHex(lerp(ah.h, bh.h, t), lerp(ah.s, bh.s, t), lerp(ah.l, bh.l, t));
}

export interface ThemeSeed {
	bg: string;
	text: string;
	green: string;
	red: string;
	yellow: string;
	blue: string;
	orange: string;
	pink: string;
	isDark: boolean;
}

export interface ThemeVars {
	[key: string]: string;
}

export function generateSurfaceRamp(bg: string, isDark: boolean): string[] {
	const { h, s, l: baseL } = hexToHsl(bg);
	const sat = s > 60 ? Math.round(s * 0.7) : Math.min(s, 15);
	const spread = isDark ? 18 : 10;
	return Array.from({ length: 10 }, (_, i) => {
		const l = isDark
			? baseL + (i / 9) * spread
			: baseL - (i / 9) * spread;
		return hslToHex(h, sat, Math.max(0, Math.min(100, l)));
	});
}

export function generateGrayRamp(isDark: boolean, bgHue: number, bgSat: number, surfaceTopL: number): string[] {
	const steps = 11;
	const sat = bgSat > 60 ? Math.round(bgSat * 0.5) : Math.min(bgSat, 8);
	const darkStart = Math.max(surfaceTopL + 3, 22);
	const lightStart = Math.min(surfaceTopL - 3, 78);
	return Array.from({ length: steps }, (_, i) => {
		const l = isDark
			? darkStart + (i / (steps - 1)) * (80 - darkStart)
			: lightStart - (i / (steps - 1)) * (lightStart - 18);
		return hslToHex(bgHue, sat, Math.max(0, Math.min(100, Math.round(l))));
	});
}

export function generateBorders(surfaces: string[], isDark: boolean): [string, string, string] {
	const s0 = hexToHsl(surfaces[0]);
	const s9 = hexToHsl(surfaces[9]);
	const { h } = s0;
	const sat = Math.min(s0.s, 12);
	if (isDark) {
		const base = Math.round((s9.l + s0.l * 0.3) / 1.3) + 1;
		return [
			hslToHex(h, sat, base),
			hslToHex(h, sat, base + 3),
			hslToHex(h, sat, base + 6)
		];
	}
	const base = Math.round((s9.l + s0.l * 0.3) / 1.3) - 1;
	return [
		hslToHex(h, sat, base),
		hslToHex(h, sat, base - 3),
		hslToHex(h, sat, base - 6)
	];
}

export function generateAccentShades(hex: string, isDark: boolean): { base: string; dim: string; dark: string; darker: string } {
	const { h, s, l } = hexToHsl(hex);
	if (isDark) {
		return {
			base: hex,
			dim: hslToHex(h, s, Math.max(l - 8, 10)),
			dark: hslToHex(h, s, Math.max(l - 15, 10)),
			darker: hslToHex(h, s, Math.max(l - 25, 10))
		};
	}
	return {
		base: hslToHex(h, s, Math.min(l - 10, 45)),
		dim: hslToHex(h, s, Math.min(l - 5, 40)),
		dark: hslToHex(h, s, Math.max(l - 18, 20)),
		darker: hslToHex(h, s, Math.max(l - 28, 15))
	};
}

export function generateRedShades(hex: string, isDark: boolean): { base: string; bright: string; light: string; light2: string; dark: string } {
	const { h, s, l } = hexToHsl(hex);
	if (isDark) {
		return {
			base: hex,
			bright: hslToHex(h, Math.min(s + 5, 100), Math.min(l + 3, 60)),
			light: hslToHex(h, s, Math.min(l + 10, 70)),
			light2: hslToHex(h, s, Math.min(l + 12, 72)),
			dark: hslToHex(h, s, Math.max(l - 20, 15))
		};
	}
	return {
		base: hslToHex(h, s, Math.min(l - 5, 45)),
		bright: hslToHex(h, Math.min(s + 5, 100), Math.max(l - 8, 35)),
		light: hslToHex(h, s, Math.min(l + 5, 55)),
		light2: hslToHex(h, s, Math.min(l + 8, 58)),
		dark: hslToHex(h, s, Math.max(l - 25, 15))
	};
}

export function seedToVars(seed: ThemeSeed): ThemeVars {
	const surfaces = generateSurfaceRamp(seed.bg, seed.isDark);
	const { h: bgHue, s: bgSat } = hexToHsl(seed.bg);
	const surfaceTopL = hexToHsl(surfaces[9]).l;
	const grays = generateGrayRamp(seed.isDark, bgHue, bgSat, surfaceTopL);
	const [bd, bd2, bd3] = generateBorders(surfaces, seed.isDark);
	const grn = generateAccentShades(seed.green, seed.isDark);
	const red = generateRedShades(seed.red, seed.isDark);
	const { h: yH, s: yS, l: yL } = hexToHsl(seed.yellow);
	const { h: bH, s: bS, l: bL } = hexToHsl(seed.blue);

	return {
		'--t-s0': surfaces[0], '--t-s1': surfaces[1], '--t-s2': surfaces[2],
		'--t-s3': surfaces[3], '--t-s4': surfaces[4], '--t-s5': surfaces[5],
		'--t-s6': surfaces[6], '--t-s7': surfaces[7], '--t-s8': surfaces[8], '--t-s9': surfaces[9],
		'--t-bd': bd, '--t-bd2': bd2, '--t-bd3': bd3,
		'--t-g1': grays[0], '--t-g2': grays[1], '--t-g3': grays[2],
		'--t-g4': grays[3], '--t-g5': grays[4], '--t-g6': grays[5],
		'--t-g7': grays[6], '--t-g8': grays[7], '--t-g9': grays[8],
		'--t-g10': grays[9], '--t-g11': grays[10],
		'--t-tx': seed.isDark ? hslToHex(bgHue, Math.min(bgSat, 8), 88) : hslToHex(bgHue, Math.min(bgSat, 8), 10),
		'--t-wh': seed.isDark ? '#ffffff' : '#000000',
		'--t-grn': grn.base, '--t-grn-dim': grn.dim, '--t-grn-dark': grn.dark, '--t-grn-darker': grn.darker,
		'--t-red': red.base, '--t-red-bright': red.bright, '--t-red-light': red.light,
		'--t-red-light2': red.light2, '--t-red-dark': red.dark,
		'--t-yel': seed.yellow,
		'--t-yel-dark': hslToHex(yH, yS, Math.max(yL - 15, 15)),
		'--t-org': seed.orange,
		'--t-blu': seed.blue,
		'--t-blu-light': hslToHex(bH, bS, Math.min(bL + 15, 65)),
		'--t-pnk': seed.pink
	};
}

export function applyVars(vars: ThemeVars): void {
	const root = document.documentElement;
	for (const [k, v] of Object.entries(vars)) {
		root.style.setProperty(k, v);
	}
}

export function clearCustomVars(): void {
	const root = document.documentElement;
	const props = Array.from({ length: 10 }, (_, i) => `--t-s${i}`)
		.concat(['--t-bd', '--t-bd2', '--t-bd3'])
		.concat(Array.from({ length: 11 }, (_, i) => `--t-g${i + 1}`))
		.concat(['--t-tx', '--t-wh'])
		.concat(['--t-grn', '--t-grn-dim', '--t-grn-dark', '--t-grn-darker'])
		.concat(['--t-red', '--t-red-bright', '--t-red-light', '--t-red-light2', '--t-red-dark'])
		.concat(['--t-yel', '--t-yel-dark', '--t-org', '--t-blu', '--t-blu-light', '--t-pnk']);
	for (const p of props) root.style.removeProperty(p);
}

export const DARK_SEED: ThemeSeed = {
	bg: '#000000', text: '#e0e0e0', green: '#00ff88', red: '#ff4466',
	yellow: '#ffaa00', blue: '#0088cc', orange: '#ff8800', pink: '#ff6b9d', isDark: true
};

export const LIGHT_SEED: ThemeSeed = {
	bg: '#ffffff', text: '#1a1a1a', green: '#00b860', red: '#dd2244',
	yellow: '#cc8800', blue: '#0077bb', orange: '#dd6600', pink: '#dd4477', isDark: false
};

export type HarmonyType = 'complementary' | 'analogous' | 'triadic' | 'split-complementary';

export function generateHarmony(baseHue: number, type: HarmonyType): number[] {
	switch (type) {
		case 'complementary': return [baseHue, (baseHue + 180) % 360];
		case 'analogous': return [baseHue, (baseHue + 30) % 360, (baseHue + 330) % 360];
		case 'triadic': return [baseHue, (baseHue + 120) % 360, (baseHue + 240) % 360];
		case 'split-complementary': return [baseHue, (baseHue + 150) % 360, (baseHue + 210) % 360];
	}
}

export function autoGenerateSeed(primary: string, isDark: boolean): ThemeSeed {
	const { h, s } = hexToHsl(primary);
	const hues = generateHarmony(h, 'split-complementary');
	const redHue = (h + 180) % 360;

	const greenS = Math.min(s + 10, 100);
	const greenL = isDark ? 50 : 36;

	return {
		bg: isDark ? hslToHex(h, Math.min(s, 8), 0) : hslToHex(h, Math.min(s, 8), 100),
		text: isDark ? '#e0e0e0' : '#1a1a1a',
		green: primary,
		red: hslToHex(redHue, Math.min(80, s + 20), isDark ? 63 : 45),
		yellow: hslToHex(hues[1], 100, isDark ? 50 : 40),
		blue: hslToHex(hues[2], 70, isDark ? 40 : 37),
		orange: hslToHex((h + 30) % 360, 100, isDark ? 50 : 43),
		pink: hslToHex((h + 300) % 360, 80, isDark ? 55 : 45),
		isDark
	};
}

export function autoGenerateFromTwo(primary: string, accent: string, isDark: boolean): ThemeSeed {
	const p = hexToHsl(primary);
	const a = hexToHsl(accent);
	const midHue = (p.h + a.h) / 2;
	const yellowHue = (p.h + 60) % 360;
	const blueHue = (a.h + 120) % 360;

	return {
		bg: isDark ? hslToHex(p.h, Math.min(p.s, 8), 0) : hslToHex(p.h, Math.min(p.s, 8), 100),
		text: isDark ? '#e0e0e0' : '#1a1a1a',
		green: primary,
		red: accent,
		yellow: hslToHex(yellowHue, 100, isDark ? 50 : 40),
		blue: hslToHex(blueHue, 70, isDark ? 40 : 37),
		orange: hslToHex((midHue + 30) % 360, 100, isDark ? 50 : 43),
		pink: hslToHex((a.h + 30) % 360, 80, isDark ? 55 : 45),
		isDark
	};
}

export function flipSeed(seed: ThemeSeed): ThemeSeed {
	const { h, s } = hexToHsl(seed.bg);
	const isDark = !seed.isDark;
	const flipAccent = (hex: string): string => {
		const c = hexToHsl(hex);
		const newL = isDark ? Math.min(c.l + 15, 60) : Math.max(c.l - 15, 30);
		return hslToHex(c.h, c.s, newL);
	};
	return {
		bg: isDark ? hslToHex(h, Math.min(s, 15), 3) : hslToHex(h, Math.min(s, 15), 98),
		text: isDark ? '#e0e0e0' : '#1a1a1a',
		green: flipAccent(seed.green),
		red: flipAccent(seed.red),
		yellow: flipAccent(seed.yellow),
		blue: flipAccent(seed.blue),
		orange: flipAccent(seed.orange),
		pink: flipAccent(seed.pink),
		isDark
	};
}

export interface ThemePreset {
	name: string;
	dark: ThemeSeed;
	light: ThemeSeed;
}

function pair(name: string, seed: ThemeSeed): ThemePreset {
	const flipped = flipSeed(seed);
	return seed.isDark
		? { name, dark: seed, light: flipped }
		: { name, dark: flipped, light: seed };
}

export const PRESETS: ThemePreset[] = [
	{ name: 'Ombra', dark: DARK_SEED, light: LIGHT_SEED },
	{
		name: 'Tomorrow',
		light: { bg: '#ffffff', text: '#4d4d4c', green: '#718c00', red: '#c82829', yellow: '#eab700', blue: '#4271ae', orange: '#f5871f', pink: '#8959a8', isDark: false },
		dark: { bg: '#1d1f21', text: '#c5c8c6', green: '#b5bd68', red: '#cc6666', yellow: '#f0c674', blue: '#81a2be', orange: '#de935f', pink: '#b294bb', isDark: true }
	},
	pair('Clean', { bg: '#f8f9fa', text: '#1a1a2e', green: '#16a34a', red: '#dc2626', yellow: '#ca8a04', blue: '#2563eb', orange: '#ea580c', pink: '#db2777', isDark: false }),
	pair('Midnight Blue', { bg: '#080e1e', text: '#c8d4e8', green: '#4daaff', red: '#ff4d6a', yellow: '#ffc44d', blue: '#3388ee', orange: '#ff7a33', pink: '#bb77ff', isDark: true }),
	pair('Deep Purple', { bg: '#120a20', text: '#d0c4e8', green: '#aa66ff', red: '#ff3366', yellow: '#ffcc00', blue: '#7755ee', orange: '#ff6633', pink: '#ff44bb', isDark: true }),
	pair('Emerald', { bg: '#041a10', text: '#c0e8d0', green: '#00e070', red: '#ff5544', yellow: '#ddcc00', blue: '#00aadd', orange: '#ff8833', pink: '#ff66aa', isDark: true }),
	pair('Warm Sand', { bg: '#faf4e8', text: '#2a2418', green: '#22a866', red: '#cc3344', yellow: '#bb8800', blue: '#3377aa', orange: '#cc6622', pink: '#cc4477', isDark: false }),
	pair('Arctic', { bg: '#eef4ff', text: '#1a2233', green: '#0099bb', red: '#cc2255', yellow: '#aa8800', blue: '#2266cc', orange: '#cc6600', pink: '#aa3388', isDark: false }),
	pair('Cyber Punk', { bg: '#0c0016', text: '#e0d0f0', green: '#00ffcc', red: '#ff0066', yellow: '#ffdd00', blue: '#0099ff', orange: '#ff6600', pink: '#ff00aa', isDark: true }),
	pair('DEXC', { bg: '#010101', text: '#b5b5b5', green: '#18ecb7', red: '#ff3d41', yellow: '#ffca45', blue: '#1da1f2', orange: '#eca619', pink: '#f4245e', isDark: true }),
	pair('Solarized', { bg: '#002b36', text: '#93a1a1', green: '#859900', red: '#dc322f', yellow: '#b58900', blue: '#268bd2', orange: '#cb4b16', pink: '#d33682', isDark: true }),
	pair('Monokai', { bg: '#272822', text: '#f8f8f2', green: '#a6e22e', red: '#f92672', yellow: '#e6db74', blue: '#66d9ef', orange: '#fd971f', pink: '#ae81ff', isDark: true }),
	pair('Nord', { bg: '#2e3440', text: '#d8dee9', green: '#a3be8c', red: '#bf616a', yellow: '#ebcb8b', blue: '#81a1c1', orange: '#d08770', pink: '#b48ead', isDark: true }),
	pair('Dracula', { bg: '#282a36', text: '#f8f8f2', green: '#50fa7b', red: '#ff5555', yellow: '#f1fa8c', blue: '#8be9fd', orange: '#ffb86c', pink: '#ff79c6', isDark: true }),
	pair('Gruvbox', { bg: '#1d2021', text: '#ebdbb2', green: '#b8bb26', red: '#fb4934', yellow: '#fabd2f', blue: '#83a598', orange: '#fe8019', pink: '#d3869b', isDark: true }),
	pair('Catppuccin', { bg: '#1e1e2e', text: '#cdd6f4', green: '#a6e3a1', red: '#f38ba8', yellow: '#f9e2af', blue: '#89b4fa', orange: '#fab387', pink: '#f5c2e7', isDark: true }),
	pair('Catppuccin Macho', { bg: '#1e1e2e', text: '#cdd6f4', green: '#40d875', red: '#e8304a', yellow: '#e8b820', blue: '#4488ff', orange: '#e87020', pink: '#d040a0', isDark: true }),
	pair('Rose Pine', { bg: '#191724', text: '#e0def4', green: '#9ccfd8', red: '#eb6f92', yellow: '#f6c177', blue: '#31748f', orange: '#ea9a97', pink: '#c4a7e7', isDark: true }),
	pair('Studio Ghibli', { bg: '#d2cf94', text: '#3a3720', green: '#4e8a35', red: '#c85a3c', yellow: '#c8971f', blue: '#3f7f96', orange: '#cf7526', pink: '#bd6f92', isDark: false }),
	{ name: 'Hotdog Stand', dark: { bg: '#dd0000', text: '#ffff00', green: '#ffff00', red: '#000000', yellow: '#ffffff', blue: '#ffff00', orange: '#ffffff', pink: '#ffff00', isDark: true }, light: { bg: '#dd0000', text: '#ffff00', green: '#ffff00', red: '#000000', yellow: '#ffffff', blue: '#ffff00', orange: '#ffffff', pink: '#ffff00', isDark: true } },
];
