import {cleanup,render,screen,waitFor} from '@testing-library/svelte';
import {afterEach,expect,test,vi} from 'vitest';
import TradeQuotePreview from '$lib/components/TradeQuotePreview.svelte';
const state=vi.hoisted(()=>({handler:null as null|((event:string,data:unknown)=>void),status:200}));
const token='0x2222222222222222222222222222222222222222';const weth='0x1111111111111111111111111111111111111111';
function quote(){return {inputToken:weth,outputToken:token,expectedOutStr:'990000',minAmountOutStr:'900000',priceImpactPct:1,legs:[{venue:'SUSHISWAP_V3',pool:'0x3333333333333333333333333333333333333333',inputToken:weth,outputToken:token,inputSymbol:'WETH',outputSymbol:'TEST'}],launchOrigin:{chainId:4663,platformType:'LONG',launchMode:'DIRECT_POOL',tokenAddress:token}};}
vi.mock('$lib/api/client',()=>({api:{GET:vi.fn(async()=>state.status===200?{data:quote(),response:{status:200}}:{error:{error:'UNSUPPORTED_ROUTE'},response:{status:422}})}}));
vi.mock('$lib/ws/client',()=>({subscribe:vi.fn((_topic,handler)=>{state.handler=handler;return 'one';}),unsubscribe:vi.fn(),updateParams:vi.fn()}));
afterEach(()=>{cleanup();state.status=200;state.handler=null;});
function mount(){return render(TradeQuotePreview,{props:{chain:'RH',tokenAddress:token,tokenSymbol:'TEST',query:{side:'BUY',amount:'1',amountType:'NATIVE'}}});}
test('f4_happy',async()=>{const x=mount();await waitFor(()=>expect(screen.getByTitle('990000')).toBeTruthy());expect(x.container.innerHTML).toMatch(/SushiSwap V3/);expect(x.container.innerHTML).not.toMatch(/via Long/);});
test('f4_negative_a',async()=>{state.status=422;const x=mount();await waitFor(()=>expect(x.container.textContent).toContain('No route available'));expect(x.container.textContent).not.toContain('990000');});
test('f4_negative_b',async()=>{const x=mount();await waitFor(()=>expect(state.handler).not.toBeNull());state.handler?.('TRADE_QUOTE',{quote:{...quote(),launchOrigin:null,expectedOutStr:'880000'}});await waitFor(()=>expect(screen.getByTitle('880000')).toBeTruthy());expect(x.container.querySelector('[aria-label="Launch origin: Long"]')).toBeNull();});
