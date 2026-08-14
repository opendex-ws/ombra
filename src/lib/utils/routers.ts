type RouterInfo = {
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
	RAYDIUM_LAUNCH: { name: 'Raydium Launchlab', icon: ri('raydium-launchlab.svg'), color: '#5b7eff' },
	UNISWAP_V2: { name: 'Uniswap V2', icon: ri('uniswap.svg'), color: '#ff007a' },
	UNISWAP_V3: { name: 'Uniswap V3', icon: ri('uniswap.svg'), color: '#ff007a' },
	AERODROME_V2: { name: 'Aerodrome', icon: ri('uniswap.svg'), color: '#0052ff' },
	MOONSHOT: { name: 'Moonshot', icon: ri('moonshot.svg'), color: '#f5c542' },
	HEAVEN: { name: 'Heaven', icon: ri('heavenxyz.svg'), color: '#aaaacc' },
	FOURMEME_V2: { name: '4Meme', icon: ri('fourmeme.svg'), color: '#ff6644' },
	BELIEVE: { name: 'Believe', icon: ri('believe-bonding.svg'), color: '#00ccff' },
	LETS_BONK: { name: "Let's Bonk", icon: ri('bonk.svg'), color: '#f7931a' },
	BAGS: { name: 'Bags', icon: ri('bags.svg'), color: '#88ff44' },
	PRINTR: { name: 'Printr', icon: ri('printr.svg'), color: '#ff44aa' },
};

export function getRouterInfo(platform: string): RouterInfo {
	return routerMap[platform] ?? { name: platform, icon: '', color: '#888888' };
}

export function getRouterName(platform: string | undefined | null): string {
	if (!platform) return '—';
	return routerMap[platform]?.name ?? platform;
}

export function getRouterIconForChain(platform: string, chain: string): string {
	if ((platform === 'UNISWAP_V2' || platform === 'UNISWAP_V3') && chain === 'BSC') {
		return ri('pancake.svg');
	}
	return routerMap[platform]?.icon ?? '';
}
