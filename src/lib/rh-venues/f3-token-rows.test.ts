import {cleanup,render,screen} from '@testing-library/svelte';
import {afterEach,expect,test,vi} from 'vitest';
import type {ScannerItem} from '$lib/api/types';
import TokenRow from '$lib/components/TokenRow.svelte';
import MemescopeCard from '$lib/components/MemescopeCard.svelte';
vi.mock('$lib/stores/auth.svelte',()=>({getIsLoggedIn:()=>false}));
vi.mock('$lib/stores/settings.svelte',()=>({getFavourites:()=>[],addFavourite:vi.fn(),removeFavourite:vi.fn()}));
afterEach(cleanup);
function tf() {
	return { priceChangePct: 0, volume: 0, volumeStr: '0', buys: 0, sells: 0, fees: { totalFeeUsd: 0, totalFeeUsdStr: '0' } };
}

function item(isHolderReward: boolean): ScannerItem {
	return {
		chain: 'SOL',
		tokenAddress: 'Token1111111111111111111111111111111111111',
		tokenSymbol: 'HR',
		tokenName: 'Holder',
		pairAddress: 'Pair11111111111111111111111111111111111111',
		platformType: 'PUMPFUN',
		createdAtTimestampStr: '2026-01-01T00:00:00Z',
		calls: 0,
		theses: 0,
		sparkline: [],
		quote: {
			priceUsd: 1,
			marketCapUsd: 1,
			liquidityUsd: 1,
			priceUsdStr: '1',
			marketCapUsdStr: '1',
			liquidityUsdStr: '1',
			priceNativeStr: '1',
			liquidityNativeStr: '1',
			fullyDilutedValueStr: '1',
			marketCapInitialUsdStr: '1'
		},
		stats: {
			total: { volume: 0, volumeStr: '0' },
			timeframes: { '5m': tf(), '1h': tf(), '6h': tf(), '24h': tf() }
		},
		audit: { mintable: false, freezable: false, honeypot: false },
		holders: { holderCount: 0, snipers: 0, bundlers: 0, insiders: 0 },
		launchPad: {
			pumpfun: {
				cashbackPct: 0,
				isAgent: false,
				isBoost: false,
				isMayhem: false,
				isHolderReward
			}
		}
	} as unknown as ScannerItem;
}


function rh(){return {...item(false),chain:'RH',tokenAddress:'0x2222222222222222222222222222222222222222',pairAddress:'0x3333333333333333333333333333333333333333',platformType:'SUSHISWAP_V3',executionProtocol:'UNISWAP_V3',launchPad:null,launchOrigin:{chainId:4663,platformType:'LONG',launchMode:'DIRECT_POOL',tokenAddress:'0x2222222222222222222222222222222222222222'},poolAssessment:{hookPresence:'UNKNOWN',reviewState:'UNKNOWN'},capability:{executable:true}} as unknown as ScannerItem;}
test('f3_happy',()=>{for(const component of [TokenRow,MemescopeCard]){const x=render(component,{props:{token:rh()}});expect(x.container.querySelector('[aria-label="Launch origin: Long"]')).not.toBeNull();expect(x.container.innerHTML).toMatch(/SushiSwap V3/);expect(x.container.innerHTML).toMatch(/Uniswap V3/);expect(x.container.innerHTML).not.toMatch(/migratedAt|About to graduate/);cleanup();}});
test('f3_negative_a',()=>{const v4={...rh(),poolAssessment:{hookPresence:'UNKNOWN',reviewState:'UNKNOWN',pool:{protocol:'UNISWAP_V4'}}} as unknown as ScannerItem;const x=render(MemescopeCard,{props:{token:v4}});expect(x.container.innerHTML).toMatch(/Unassessed pool component/);expect(x.container.innerHTML).not.toMatch(/Reviewed pool component|SAFE hook/);});
test('f3_no_hook_badge_off_v4',()=>{const x=render(MemescopeCard,{props:{token:rh()}});expect(x.container.innerHTML).not.toMatch(/pool component|Pool hook/);});
test('f3_scanner_row_has_no_pool_chip',()=>{const v4={...rh(),poolAssessment:{hookPresence:'UNKNOWN',reviewState:'UNKNOWN',pool:{protocol:'UNISWAP_V4'}}} as unknown as ScannerItem;const x=render(TokenRow,{props:{token:v4}});expect(x.container.innerHTML).not.toMatch(/pool component|Pool hook/);});
test('f3_negative_b',()=>{render(MemescopeCard,{props:{token:item(true)}});expect(screen.getByTitle('Holder rewards')).toBeTruthy();cleanup();const x=render(TokenRow,{props:{token:{...item(false),chain:'BSC',platformType:'UNISWAP_V3'} as unknown as ScannerItem}});expect(x.container.innerHTML).toMatch(/pancake/i);});
