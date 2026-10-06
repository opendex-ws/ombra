import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { getRouterIconForChain, getRouterInfo } from './routers';

describe('router icons', () => {
	test('robinhood venues do not share the uniswap chip', () => {
		const icons = ['UNISWAP_V2', 'UNISWAP_V3', 'UNISWAP_V4', 'PONS', 'FLAP'].map(
			(platform) => getRouterInfo(platform).icon
		);
		expect(new Set(icons).size).toBe(icons.length);
		for (const icon of icons) {
			expect(icon).not.toBe('/router-icons/uniswap.svg');
			expect(existsSync(resolve('static' + icon)), icon).toBe(true);
		}
	});

	test('bsc uniswap v2 and v3 stay pancake', () => {
		expect(getRouterIconForChain('UNISWAP_V2', 'BSC')).toBe('/router-icons/pancake.svg');
		expect(getRouterIconForChain('UNISWAP_V3', 'BSC')).toBe('/router-icons/pancake.svg');
		expect(getRouterIconForChain('UNISWAP_V2', 'RH')).toBe('/router-icons/uniswap-v2.svg');
	});
});
