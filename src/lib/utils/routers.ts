import type { components } from '$lib/api/v2.d.ts';

export type RouterInfo = {
	name: string;
	icon: string;
	color: string;
};

function ri(path: string): string {
	return `/router-icons/${path}`;
}

const routerMap: Record<string, RouterInfo> = {
	PUMPFUN: { name: 'Pump.fun', icon: ri('pumpfun.svg'), color: '#00e599' },
	PUMPSWAP: { name: 'PumpSwap', icon: ri('pumpswap.svg'), color: '#00e599' },
	METEORA_BONDING_CURVE: { name: 'Meteora DBC', icon: ri('meteora-bonding.svg'), color: '#e8d44d' },
	METEORA_DYN: { name: 'Meteora Dyn', icon: ri('meteora.svg'), color: '#e8d44d' },
	METEORA_DYN_V2: { name: 'Meteora DAMM V2', icon: ri('meteora.svg'), color: '#e8d44d' },
	METEORA_DLMM: { name: 'Meteora DLMM', icon: ri('meteora.svg'), color: '#e8d44d' },
	RAYDIUM: { name: 'Raydium', icon: ri('raydium.svg'), color: '#5b7eff' },
	RAYDIUM_CP: { name: 'Raydium CP', icon: ri('raydium.svg'), color: '#5b7eff' },
	RAYDIUM_CLMM: { name: 'Raydium CLMM', icon: ri('raydium.svg'), color: '#5b7eff' },
	WHIRLPOOL: { name: 'Orca Whirlpool', icon: ri('whirlpool.svg'), color: '#ffc83d' },
	RAYDIUM_LAUNCH: { name: 'Raydium Launchlab', icon: ri('raydium-launchlab.svg'), color: '#5b7eff' },
	// Uniswap pink plus the version digit. The unicorn made v2/v3/v4 one blob at
	// badge size, so each version also has its own disc: V2 solid pink, V3 white
	// with a pink ring, V4 dark with a pink ring.
	UNISWAP_V2: { name: 'Uniswap V2', icon: ri('uniswap-v2.svg'), color: '#ff007a' },
	UNISWAP_V3: { name: 'Uniswap V3', icon: ri('uniswap-v3.svg'), color: '#ff5fa8' },
	SLIPSTREAM: { name: 'Slipstream', icon: '', color: '#888888' },
	UNISWAP_V4: { name: 'Uniswap V4', icon: ri('uniswap-v4.svg'), color: '#e040fb' },
	// flap.sh/icon.svg — the lime wing mark.
	FLAP: { name: 'Flap', icon: ri('flap.svg'), color: '#d0ff00' },
	// ponsfamily.com/pons.png — the glass P.
	PONS: { name: 'Pons', icon: ri('pons.png'), color: '#b7f5c8' },
	AERODROME_V2: { name: 'Aerodrome', icon: ri('uniswap.svg'), color: '#0052ff' },
	MOONSHOT: { name: 'Moonshot', icon: ri('moonshot.svg'), color: '#f5c542' },
	HEAVEN: { name: 'Heaven', icon: ri('heavenxyz.svg'), color: '#aaaacc' },
	FOURMEME_V2: { name: '4Meme', icon: ri('fourmeme.svg'), color: '#ff6644' },
	BELIEVE: { name: 'Believe', icon: ri('believe-bonding.svg'), color: '#00ccff' },
	LETS_BONK: { name: "Let's Bonk", icon: ri('bonk.svg'), color: '#f7931a' },
	BAGS: { name: 'Bags', icon: ri('bags.svg'), color: '#88ff44' },
	PRINTR: { name: 'Printr', icon: ri('printr.svg'), color: '#ff44aa' },
	STONKFUN: { name: 'Stonk.fun', icon: ri('stonkfun.svg'), color: '#a4c5cf' },
	OTCDESKS: { name: 'OTC Desks', icon: ri('otcdesks.svg'), color: '#5cb26f' },
	// Brand mark is near-black, so the asset is recoloured white to read on a
	// dark chip; the brand blue stays as the accent colour.
	PURPS: { name: 'Purps', icon: ri('purps.svg'), color: '#3a49b8' },
	// Raster brand asset (no SVG published), so it is a downscaled WebP.
	EMBERCURVE: { name: 'Embercurve', icon: ri('embercurve.webp'), color: '#f82146' },
	// Solana prop AMMs and order books. Logos are DefiLlama's protocol icons,
	// downscaled to 64px WebP.
	MANIFEST: { name: 'Manifest', icon: ri('manifest.webp'), color: '#e8b05c' },
	BYREAL: { name: 'Byreal', icon: ri('byreal.webp'), color: '#f7a600' },
	HUMIDIFI: { name: 'HumidiFi', icon: ri('humidifi.webp'), color: '#2f5bff' },
	ALPHAQ: { name: 'AlphaQ', icon: ri('alphaq.webp'), color: '#1d2b4f' },
	SOLFI_V2: { name: 'SolFi V2', icon: ri('solfi.webp'), color: '#d9d9d9' },
	AQUIFER: { name: 'Aquifer', icon: ri('aquifer.webp'), color: '#12355b' },
	// No published brand mark anywhere (DefiLlama and DexScreener only carry a
	// placeholder), so these show the name with no icon.
	BISONFI: { name: 'BisonFi', icon: '', color: '#888888' },
	TESSERA_V: { name: 'Tessera V', icon: '', color: '#888888' },
	GOONFI_V2: { name: 'GoonFi V2', icon: '', color: '#888888' },
	SCORCH: { name: 'Scorch', icon: '', color: '#888888' },
	ZEROFI: { name: 'ZeroFi', icon: '', color: '#888888' },
};

const rhVenueMap = {
	LONG: { name: 'Long', icon: '', color: 'var(--t-g6)' },
	BANKR: { name: 'Bankr', icon: ri('rh-venues/bankr.svg'), color: 'var(--t-pnk)' },
	FLYWHEEL: { name: 'Flywheel', icon: ri('rh-venues/flywheel.png'), color: 'var(--t-grn)' },
	AERO_SLIPSTREAM: { name: 'Aero Slipstream', icon: ri('rh-venues/aero.svg'), color: 'var(--t-blu)' },
	METRIC_V1: { name: 'Metric V1', icon: ri('rh-venues/metric.svg'), color: '#84e0f7' },
	RAMSES_CL: { name: 'Ramses CL', icon: ri('rh-venues/ramses.svg'), color: 'var(--t-g6)' },
	SUSHISWAP_V3: { name: 'SushiSwap V3', icon: ri('rh-venues/sushi.png'), color: '#a259ff' },
	UP_SLIPSTREAM: { name: 'Up Slipstream', icon: ri('rh-venues/up.svg'), color: 'var(--t-grn)' }
} satisfies Partial<Record<components['schemas']['PlatformType'], RouterInfo>>;

export type RhVenue = keyof typeof rhVenueMap;
export const RH_VENUES = Object.keys(rhVenueMap) as RhVenue[];

const rhRouters = new Map<string, RouterInfo>(Object.entries(rhVenueMap));
const unknownRouter: RouterInfo = { name: 'Unknown', icon: '', color: 'var(--t-g6)' };

export function isRhChain(chain: string | number | null | undefined): boolean {
	return chain === 'RH' || chain === 4663 || chain === '4663';
}

export function getRouterInfo(platform: string, chain?: string | number | null): RouterInfo {
	const rhRouter = rhRouters.get(platform);
	if (rhRouter) {
		if (isRhChain(chain)) return rhRouter;
		return chain == null ? { ...rhRouter, icon: '' } : unknownRouter;
	}
	return Object.hasOwn(routerMap, platform) ? routerMap[platform] : unknownRouter;
}

export function getRouterName(
	platform: string | undefined | null,
	chain?: string | number | null
): string {
	if (!platform) return '—';
	return getRouterInfo(platform, chain).name;
}

export function getRouterIconForChain(platform: string, chain: string | number): string {
	if ((platform === 'UNISWAP_V2' || platform === 'UNISWAP_V3') && chain === 'BSC') {
		return ri('pancake.svg');
	}
	return getRouterInfo(platform, chain).icon;
}
