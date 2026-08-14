import { tc } from '$lib/stores/theme.svelte';

const CACHE_MAX = 500;
const svgCache = new Map<string, string>();
const imgCache = new Map<string, HTMLImageElement>();
let lastThemeKey = '';

function lruSet<V>(cache: Map<string, V>, key: string, value: V) {
	if (cache.size >= CACHE_MAX && !cache.has(key)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, value);
}

function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
	const value = cache.get(key);
	if (value !== undefined) {
		cache.delete(key);
		cache.set(key, value);
	}
	return value;
}

function themeKey(): string {
	return [
		tc('--t-grn'), tc('--t-red'), tc('--t-blu'),
		tc('--t-yel'), tc('--t-org'), tc('--t-pnk'), tc('--t-s2')
	].join('|');
}

function invalidateIfThemeChanged() {
	const k = themeKey();
	if (k !== lastThemeKey) {
		svgCache.clear();
		imgCache.clear();
		lastThemeKey = k;
	}
}

function djb2(str: string, salt: number): number {
	let h = 5381;
	for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i) + salt) & 0x7fffffff;
	return h;
}

function hb(seed: string, i: number): number {
	return djb2(seed, i) & 0xff;
}

function polarXY(cx: number, cy: number, r: number, deg: number): [number, number] {
	const rad = ((deg - 90) * Math.PI) / 180;
	return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function generateSvg(seed: string): string {
	const palette = [
		tc('--t-grn'), tc('--t-red'), tc('--t-blu'),
		tc('--t-yel'), tc('--t-org'), tc('--t-pnk')
	];
	const bg = tc('--t-s2');

	const c1 = palette[hb(seed, 0) % palette.length];
	const c2idx = (hb(seed, 0) % palette.length + 1 + hb(seed, 1) % (palette.length - 1)) % palette.length;
	const c2 = palette[c2idx];
	const c3idx = (c2idx + 1 + hb(seed, 2) % (palette.length - 1)) % palette.length;
	const c3 = palette[c3idx];

	const cx = 50, cy = 50;
	const GAP = 1.2;          // minimum spacing between circle edges
	const CLIP_INSET = 48;    // keep circles fully inside the round frame

	type Circle = { x: number; y: number; r: number; color: string; opacity: string; fixed?: boolean };
	const circles: Circle[] = [];

	// Center dot is fixed (never moves); outer dots relax around it.
	const centerR = 4 + (hb(seed, 30) % 4);
	circles.push({ x: cx, y: cy, r: centerR, color: c3, opacity: '0.85', fixed: true });

	const nDots = 4 + (hb(seed, 7) % 3);
	const baseRot = hb(seed, 8) * 1.73;
	for (let i = 0; i < nDots; i++) {
		const angle = baseRot + (i * 360) / nDots + (hb(seed, 40 + i) % 30) - 15;
		const dist = 12 + (hb(seed, 32 + i) % 22);
		const [px, py] = polarXY(cx, cy, dist, angle);
		const r = 7 + (hb(seed, 50 + i) % 9);
		circles.push({
			x: px, y: py, r,
			color: [c1, c2, c3][hb(seed, 32 + i) % 3],
			opacity: (0.75 + (hb(seed, 60 + i) % 20) / 100).toFixed(2)
		});
	}

	// Relaxation: push overlapping circles apart along their center line, then
	// clamp back inside the frame. Deterministic (fixed iteration count / order).
	for (let pass = 0; pass < 24; pass++) {
		for (let a = 0; a < circles.length; a++) {
			for (let b = a + 1; b < circles.length; b++) {
				const ca = circles[a], cb = circles[b];
				let dx = cb.x - ca.x, dy = cb.y - ca.y;
				let d = Math.hypot(dx, dy);
				const min = ca.r + cb.r + GAP;
				if (d >= min) continue;
				if (d < 0.01) { dx = Math.cos(a * 2.4); dy = Math.sin(a * 2.4); d = 1; }
				const push = (min - d) / d;
				const ax = dx * push, ay = dy * push;
				if (ca.fixed) { cb.x += ax; cb.y += ay; }
				else if (cb.fixed) { ca.x -= ax; ca.y -= ay; }
				else { ca.x -= ax * 0.5; ca.y -= ay * 0.5; cb.x += ax * 0.5; cb.y += ay * 0.5; }
			}
		}
		// Clamp non-fixed circles inside the round frame.
		for (const c of circles) {
			if (c.fixed) continue;
			const dist = Math.hypot(c.x - cx, c.y - cy);
			const max = CLIP_INSET - c.r;
			if (dist > max && dist > 0.01) {
				const s = max / dist;
				c.x = cx + (c.x - cx) * s;
				c.y = cy + (c.y - cy) * s;
			}
		}
	}

	let paths = '';
	let centerPath = '';
	for (const c of circles) {
		const circle = `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r}" fill="${c.color}" opacity="${c.opacity}"/>`;
		if (c.fixed) centerPath = circle;
		else paths += circle;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
		`<clipPath id="c"><circle cx="${cx}" cy="${cy}" r="50"/></clipPath>` +
		`<circle cx="${cx}" cy="${cy}" r="50" fill="${bg}"/>` +
		`<g clip-path="url(#c)">` +
		paths +
		centerPath +
		`</g>` +
		`</svg>`;
}

export function getWalletIconUrl(address: string): string {
	invalidateIfThemeChanged();
	let url = lruGet(svgCache, address);
	if (url) return url;
	const svg = generateSvg(address);
	url = 'data:image/svg+xml;base64,' + btoa(svg);
	lruSet(svgCache, address, url);
	return url;
}

export function getWalletIconImage(address: string, onLoad?: () => void): HTMLImageElement | null {
	invalidateIfThemeChanged();
	const cached = lruGet(imgCache, address);
	if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
	const img = new Image();
	img.src = getWalletIconUrl(address);
	img.onload = () => {
		lruSet(imgCache, address, img);
		onLoad?.();
	};
	lruSet(imgCache, address, img);
	return null;
}

export function getWalletAddress(source: Record<string, unknown>): string | undefined {
	if (source.type === 'WALLET' && typeof source.walletAddress === 'string') return source.walletAddress;
	if (source.type === 'WALLET' && typeof source.id === 'string') return source.id;
	return undefined;
}
