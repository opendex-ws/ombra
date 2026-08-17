<script lang="ts">
	import Lock from 'lucide-svelte/icons/lock';
	import Plus from 'lucide-svelte/icons/plus';
	import Check from 'lucide-svelte/icons/check';
	import Copy from 'lucide-svelte/icons/copy';
	import Camera from 'lucide-svelte/icons/camera';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import PictureInPicture2 from 'lucide-svelte/icons/picture-in-picture-2';
	import Minimize2 from 'lucide-svelte/icons/minimize-2';
	import { portal } from '$lib/actions/portal';
	import { getTradePanelCollapsed, toggleTradePanelCollapsed, getTradePanelPopout, setTradePanelPopout, getTradePanelFloat, setTradePanelFloatPos, setTradePanelFloatSize } from '$lib/stores/feSettings.svelte';
	import { getPanelZ, bringToFront } from '$lib/stores/floatingPanels.svelte';
	import MobileScanModal from './MobileScanModal.svelte';
	import TargetCard from './TargetCard.svelte';
	import ChainIcon from './ChainIcon.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import type { Chain, GasPreset } from '$lib/api/types';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { connectWallet, getIsConnecting, isPhantomInstalled, getAuthToken } from '$lib/stores/auth.svelte';
	import { authenticate } from '$lib/ws/client';
	import { formatUsd, fmtVal, formatCompactNumber } from '$lib/utils/format';
	import { isUsd } from '$lib/stores/currency.svelte';
	import {
		getActiveTradeTab, setActiveTradeTab, getOrderType, setOrderType,
		getBuyAmount, setBuyAmount, getSellPercent, setSellPercent,
		getBuyGasType, setBuyGasType, getSellGasType, setSellGasType,
		getSlippageBuy, setSlippageBuy, getSlippageSell, setSlippageSell,
		getAntiMev, setAntiMev, getBuyLoading, getSellLoading,
		getDipPercent, setDipPercent, getLimitPrice, setLimitPrice,
		getTradeError, clearTradeError, getFeeEstimate, fetchFeeEstimate,
		subscribeFeeEstimate, getLiveFeeEstimate,
		executeBuy, executeSell, getTradeForToken,
		fetchManagedWallets, getManagedWalletForChain,
		getTradeConfigs, getSelectedConfigId, setSelectedConfigId,
		getSelectedConfig, fetchTradeConfigs, loadConfigIntoForm,
		getSellTargets, addSellTarget, removeSellTarget, updateSellTarget,
		getStopLoss, updateStopLossField,
		type TradeTab, type SellTargetKind, type StopLossKind, type OrderType, type TargetKind
	} from '$lib/stores/trade.svelte';

	let { chain, tokenAddress, tokenSymbol = '???', autoSlippage = null, currentPriceUsd = 0, mobile = false }: {
		chain: Chain;
		tokenAddress: string;
		tokenSymbol?: string;
		autoSlippage?: number | null;
		currentPriceUsd?: number;
		mobile?: boolean;
	} = $props();

	let limitPctOffset = $state(0);

	let floatEl = $state<HTMLDivElement | null>(null);
	let floatDragging = $state(false);
	let floatDragStartX = 0;
	let floatDragStartY = 0;
	let floatDragStartPos = { x: 0, y: 0 };

	function onFloatDragMove(ev: MouseEvent) {
		if (!floatDragging) return;
		const nx = Math.max(0, Math.min(window.innerWidth - 120, floatDragStartPos.x + ev.clientX - floatDragStartX));
		const ny = Math.max(48, Math.min(window.innerHeight - 48, floatDragStartPos.y + ev.clientY - floatDragStartY));
		setTradePanelFloatPos(nx, ny);
	}

	function onFloatDragUp() {
		floatDragging = false;
		window.removeEventListener('mousemove', onFloatDragMove);
		window.removeEventListener('mouseup', onFloatDragUp);
		document.body.style.userSelect = '';
	}

	function onFloatDragDown(ev: MouseEvent) {
		const t = ev.target as HTMLElement;
		if (t.closest('button, a, input, select')) return;
		ev.preventDefault();
		floatDragging = true;
		floatDragStartX = ev.clientX;
		floatDragStartY = ev.clientY;
		const f = getTradePanelFloat();
		floatDragStartPos = { x: f.x, y: f.y };
		window.addEventListener('mousemove', onFloatDragMove);
		window.addEventListener('mouseup', onFloatDragUp);
		document.body.style.userSelect = 'none';
	}

	$effect(() => {
		if (!floatEl) return;
		const el = floatEl;
		const ro = new ResizeObserver(() => {
			if (getTradePanelCollapsed()) return;
			if (el.offsetWidth > 0 && el.offsetHeight > 0) {
				setTradePanelFloatSize(el.offsetWidth, el.offsetHeight);
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		if (getOrderType() === 'LIMIT' && currentPriceUsd > 0 && !getLimitPrice()) {
			setLimitPrice(String(currentPriceUsd));
			limitPctOffset = 0;
		}
	});

	function applyLimitPctOffset(pct: number) {
		if (currentPriceUsd <= 0) return;
		limitPctOffset = Math.max(-99, Math.min(100, pct));
		const adjusted = currentPriceUsd * (1 + limitPctOffset / 100);
		setLimitPrice(adjusted.toPrecision(6));
	}

	let sliderDragging = $state(false);
	let sliderEl = $state<HTMLDivElement | null>(null);

	function sliderPctFromEvent(e: MouseEvent | Touch) {
		const rect = sliderEl!.getBoundingClientRect();
		const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
		return Math.round((x / rect.width) * 199 - 99);
	}

	function onSliderDown(e: MouseEvent) {
		sliderDragging = true;
		applyLimitPctOffset(sliderPctFromEvent(e));
		document.addEventListener('mousemove', onSliderMove);
		document.addEventListener('mouseup', onSliderUp);
	}

	function onSliderMove(e: MouseEvent) {
		if (!sliderDragging) return;
		applyLimitPctOffset(sliderPctFromEvent(e));
	}

	function onSliderUp() {
		sliderDragging = false;
		document.removeEventListener('mousemove', onSliderMove);
		document.removeEventListener('mouseup', onSliderUp);
	}

	function onSliderTouchStart(e: TouchEvent) {
		e.preventDefault();
		sliderDragging = true;
		applyLimitPctOffset(sliderPctFromEvent(e.touches[0]));
		document.addEventListener('touchmove', onSliderTouchMove, { passive: false });
		document.addEventListener('touchend', onSliderTouchEnd);
	}

	function onSliderTouchMove(e: TouchEvent) {
		e.preventDefault();
		if (!sliderDragging) return;
		applyLimitPctOffset(sliderPctFromEvent(e.touches[0]));
	}

	function onSliderTouchEnd() {
		sliderDragging = false;
		document.removeEventListener('touchmove', onSliderTouchMove);
		document.removeEventListener('touchend', onSliderTouchEnd);
	}

	const orderTypes: OrderType[] = ['MARKET', 'DIP', 'LIMIT'];
	const gasOptions: { label: string; value: GasPreset }[] = [
		{ label: 'Auto', value: 'AUTO' },
		{ label: 'Low', value: 'LOW' },
		{ label: 'Med', value: 'MEDIUM' },
		{ label: 'High', value: 'HIGH' }
	];
	const quickBuyAmountsUsd = ['10', '25', '50', '100', '250'];
	const quickBuyAmountsNative: Record<string, string[]> = {
		SOL: ['0.1', '0.5', '1', '5'],
		ETH: ['0.005', '0.01', '0.025', '0.05', '0.1'],
		BASE: ['0.005', '0.01', '0.025', '0.05', '0.1'],
		BSC: ['0.01', '0.05', '0.1', '0.25', '0.5'],
	};
	const quickBuyAmounts = $derived(isUsd() ? quickBuyAmountsUsd : (quickBuyAmountsNative[chain] ?? quickBuyAmountsUsd));
	const quickSellPcts = [25, 50, 75, 100];

	let showSlippage = $state(false);
	let customSlippage = $state('');
	let copied = $state(false);
	let showMobileScan = $state(false);

	const slipValue = $derived(getActiveTradeTab() === 'buy' ? getSlippageBuy() : getSlippageSell());
	const presetLocked = $derived(getActiveTradeTab() === 'buy' && getSelectedConfigId() !== null);

	function copyAddress() {
		if (!managedWallet) return;
		navigator.clipboard.writeText(managedWallet.address);
		copied = true;
		setTimeout(() => (copied = false), 500);
	}

	const nativeSymbol = $derived(chain === 'SOL' ? 'SOL' : chain === 'ETH' ? 'ETH' : chain === 'BASE' ? 'ETH' : chain === 'BSC' ? 'BNB' : 'ETH');
	const existingTrade = $derived(getTradeForToken(chain, tokenAddress));
	$effect(() => {
		if (!existingTrade && getActiveTradeTab() === 'sell') setActiveTradeTab('buy');
	});
	const managedWallet = $derived(getManagedWalletForChain(chain));
	const nativeBalance = $derived(managedWallet?.assets.find(b => b.isNative || b.token.symbol === nativeSymbol) ?? null);
	const nativeValueUsd = $derived(nativeBalance ? nativeBalance.valueUsd : 0);
	const hasBalance = $derived(nativeValueUsd > 0);

	$effect(() => {
		if (getIsLoggedIn()) {
			fetchManagedWallets();
			fetchTradeConfigs();
		}
	});

	$effect(() => {
		if (chain && getIsLoggedIn()) {
			// Live all-tier fee estimate over WS; REST as an initial fallback until
			// the first frame arrives.
			subscribeFeeEstimate(chain as Chain);
			if (!getLiveFeeEstimate()) fetchFeeEstimate(chain, getBuyGasType());
		}
	});

	async function handleConnect() {
		try {
			await connectWallet();
			authenticate(getAuthToken());
		} catch {}
	}

	async function handleBuy() {
		try {
			await executeBuy(chain, tokenAddress, getSelectedConfigId());
		} catch (e: any) {
			addToast('error', 'Buy Failed', e?.message ?? 'Unknown error', 8000);
		}
	}

	async function handleSell() {
		try {
			await executeSell(chain, tokenAddress, existingTrade?.id);
		} catch (e: any) {
			addToast('error', 'Sell Failed', e?.message ?? 'Unknown error', 8000);
		}
	}

	function handleSlippageChange(value: string) {
		const num = parseFloat(value);
		if (isNaN(num)) {
			if (getActiveTradeTab() === 'buy') setSlippageBuy(null);
			else setSlippageSell(null);
		} else {
			if (getActiveTradeTab() === 'buy') setSlippageBuy(num);
			else setSlippageSell(num);
		}
	}
</script>

{#if mobile}
	<div class="relative flex h-full flex-col overflow-y-auto bg-transparent">
		{@render panelBody()}
	</div>
{:else if getTradePanelPopout()}
	{@const f = getTradePanelFloat()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		bind:this={floatEl}
		class="fixed flex flex-col overflow-hidden rounded-xl border border-bd bg-s2 shadow-2xl glass-strong"
		style="left: {f.x}px; top: {f.y}px; width: {f.w}px; {getTradePanelCollapsed() ? 'height: auto;' : `height: ${f.h}px; resize: both; min-height: 320px;`} min-width: 300px; z-index: {getPanelZ('trade')};"
		onmousedown={() => bringToFront('trade')}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex shrink-0 items-center gap-2 border-b border-bd px-3 py-1.5 {floatDragging ? 'cursor-grabbing' : 'cursor-grab'}"
			onmousedown={onFloatDragDown}
		>
			<span class="text-[11px] font-bold text-tx">Trade {tokenSymbol}</span>
			<div class="ml-auto flex items-center gap-1">
				<button
					onclick={() => setTradePanelPopout(false)}
					class="cursor-pointer p-0.5 text-g4 transition-colors hover:text-tx"
					aria-label="Dock trade panel"
					title="Dock back to sidebar"
				>
					<Minimize2 class="h-3.5 w-3.5" />
				</button>
				<button
					onclick={toggleTradePanelCollapsed}
					class="cursor-pointer p-0.5 text-g4 transition-colors hover:text-tx"
					aria-label={getTradePanelCollapsed() ? 'Expand' : 'Collapse'}
				>
					<ChevronDown class="h-3.5 w-3.5 transition-transform duration-200 {getTradePanelCollapsed() ? 'rotate-180' : ''}" />
				</button>
			</div>
		</div>
		{#if !getTradePanelCollapsed()}
			<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
				{@render panelBody()}
			</div>
		{/if}
	</div>
{:else}
	<div class="relative flex {getTradePanelCollapsed() ? '' : 'h-full'} flex-col overflow-y-auto bg-transparent">
		{@render panelBody()}
	</div>
{/if}

{#snippet panelBody()}
	{@const bodyVisible = mobile || getTradePanelPopout() || !getTradePanelCollapsed()}
	{@const gated = bodyVisible && (!getIsLoggedIn() || (getActiveTradeTab() === 'buy' && managedWallet && !hasBalance))}
	{#if bodyVisible && !getIsLoggedIn()}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-s4/40 p-6">
			<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-s4 ring-1 ring-bd">
				<Lock class="h-7 w-7 text-g5" strokeWidth={1.5} />
			</div>
			<span class="text-sm text-g6">Connect wallet to trade</span>
			{#if !isPhantomInstalled()}
				<button
					onclick={() => (showMobileScan = true)}
					class="cursor-pointer rounded-lg bg-grn px-5 py-2 text-sm font-semibold text-s0 transition-all md:hidden"
				>
					<span class="flex items-center gap-1.5"><Camera class="h-3.5 w-3.5" />Scan QR</span>
				</button>
				<button
					onclick={handleConnect}
					class="hidden cursor-pointer rounded-lg bg-grn px-5 py-2 text-sm font-semibold text-s0 transition-all md:inline-flex"
				>
					Install Phantom
				</button>
			{:else}
				<button
					onclick={handleConnect}
					disabled={getIsConnecting()}
					class="cursor-pointer rounded-lg bg-grn px-5 py-2 text-sm font-semibold text-s0 transition-all disabled:opacity-50"
				>
					{getIsConnecting() ? 'Connecting...' : 'Connect Wallet'}
				</button>
			{/if}
		</div>
	{:else if bodyVisible && getActiveTradeTab() === 'buy' && managedWallet && !hasBalance}
		<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-s4/40 p-6">
			<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-s4 ring-1 ring-bd">
				<Plus class="h-6 w-6 text-g5" strokeWidth={1.5} />
			</div>
			<div class="text-center">
				<div class="text-sm font-medium text-tx">Deposit {nativeSymbol} to Trade</div>
				<div class="mt-0.5 text-xs text-g6">Send {nativeSymbol} to your managed wallet</div>
			</div>
			<button
				onclick={copyAddress}
				class="flex cursor-pointer items-center gap-2 rounded-xl border border-bd bg-s4 px-4 py-2.5 font-mono text-xs text-tx transition-all hover:border-grn/40 hover:bg-grn/10"
			>
				<span>{managedWallet.address.slice(0, 8)}...{managedWallet.address.slice(-6)}</span>
				{#if copied}
					<Check class="h-4 w-4 text-grn" strokeWidth={2} />
				{:else}
					<Copy class="h-4 w-4 text-g6" strokeWidth={2} />
				{/if}
			</button>
			{#if copied}
				<span class="text-xs text-grn">Copied!</span>
			{/if}
		</div>
	{/if}

	<div class="flex min-h-0 flex-1 flex-col transition-[filter] duration-200 {gated ? 'pointer-events-none blur-[6px]' : ''}">
	<div class="flex items-center gap-1 border-b border-bd px-2 py-1.5">
		<button
			class="{existingTrade ? 'flex-1' : 'flex-1'} cursor-pointer rounded-lg py-1 text-sm font-bold transition-all duration-200 {getActiveTradeTab() === 'buy'
				? 'bg-grn/10 text-grn'
				: 'text-g7 hover:bg-wh/5 hover:text-g11'}"
			onclick={() => setActiveTradeTab('buy')}
		>
			Buy
		</button>
		{#if existingTrade}
			<button
				class="flex-1 cursor-pointer rounded-lg py-1 text-sm font-bold transition-all duration-200 {getActiveTradeTab() === 'sell'
					? 'bg-red/10 text-red'
					: 'text-g7 hover:bg-wh/5 hover:text-g11'}"
				onclick={() => setActiveTradeTab('sell')}
			>
				Sell
			</button>
		{/if}
		{#if !mobile && !getTradePanelPopout()}
			<button
				onclick={() => { setTradePanelPopout(true); bringToFront('trade'); }}
				class="shrink-0 cursor-pointer p-0.5 text-g4 transition-colors hover:text-tx"
				aria-label="Pop out trade panel"
				title="Pop out to floating window"
			>
				<PictureInPicture2 class="h-3.5 w-3.5" />
			</button>
			<button
				onclick={toggleTradePanelCollapsed}
				class="shrink-0 cursor-pointer p-0.5 text-g4 transition-colors hover:text-tx"
				aria-label={getTradePanelCollapsed() ? 'Expand trade panel' : 'Collapse trade panel'}
			>
				<ChevronDown class="h-3.5 w-3.5 transition-transform duration-200 {getTradePanelCollapsed() ? 'rotate-180' : ''}" />
			</button>
		{/if}
	</div>

	{#if bodyVisible}
	<div class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
		{#if getActiveTradeTab() === 'buy'}
			<div class="flex items-center justify-between border-b border-bd px-1 pb-1.5">
				<div class="flex gap-5">
					{#each orderTypes as ot}
						<button
							class="relative cursor-pointer pb-1.5 -mb-1.5 text-[11px] font-semibold capitalize transition-colors {getOrderType() === ot ? 'text-tx' : 'text-g5 hover:text-g8'}"
							onclick={() => setOrderType(ot)}
						>
							{ot.toLowerCase()}
							{#if getOrderType() === ot}
								<div class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-grn"></div>
							{/if}
						</button>
					{/each}
				</div>
				{#if getTradeConfigs().length > 0}
					<select
						value={getSelectedConfigId() ?? 'MANUAL'}
						onchange={(e) => {
							const v = (e.target as HTMLSelectElement).value;
							if (v === 'MANUAL') setSelectedConfigId(null);
							else { const cfg = getTradeConfigs().find(c => c.id === v); if (cfg) loadConfigIntoForm(cfg); }
						}}
						class="cursor-pointer rounded-md border border-bd bg-s4 px-1.5 py-0.5 text-[11px] font-semibold {getSelectedConfigId() ? 'text-yel' : 'text-tx'} outline-none"
						style="color-scheme:dark"
					>
						<option value="MANUAL">Manual</option>
						{#each getTradeConfigs() as cfg}
							<option value={cfg.id}>{cfg.name}</option>
						{/each}
					</select>
				{/if}
			</div>

			{#if !managedWallet}
				<div class="rounded-md border border-red/20 bg-red/10 px-2.5 py-1.5 text-xs text-red">
					No managed wallet for {chain}
				</div>
			{/if}

			<div>
				<div class="relative">
					<input
						type="text"
						inputmode="decimal"
						placeholder="0.00"
						value={getBuyAmount()}
						oninput={(e) => setBuyAmount((e.target as HTMLInputElement).value)}
						class="w-full rounded-lg border border-bd bg-s4 py-2 pl-3 pr-14 text-lg font-bold text-tx placeholder-g3 outline-none transition-all focus:border-grn/40"
					/>
					<span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center text-xs font-bold text-g5">{#if isUsd()}USD{:else}<ChainIcon chain={chain} class="h-4 w-4 text-g5" />{/if}</span>
				</div>
				<div class="mt-1 flex gap-1">
					{#each quickBuyAmounts as amt}
						<button
							class="flex-1 cursor-pointer rounded-md py-1 text-[11px] font-bold transition-all duration-150 {getBuyAmount() === amt ? 'bg-grn/20 text-grn' : 'bg-s4 text-g6 hover:bg-s7 hover:text-g9'}"
							onclick={() => setBuyAmount(amt)}
						>
							{isUsd() ? `$${amt}` : amt}
						</button>
					{/each}
				</div>
				<div class="mt-1 flex items-center justify-between px-0.5 text-[10px] text-g5">
					<span>{#if getFeeEstimate()}Fee {@html fmtVal(getFeeEstimate()?.gasFeeUsdStr ?? '0', getFeeEstimate()?.gasFeeNativeStr ?? '0', chain)}{/if}</span>
					{#if managedWallet}
						<span>Avail <span class="{hasBalance ? 'text-g8' : 'text-red'} font-semibold">{@html fmtVal(nativeBalance?.valueUsdStr ?? '0', nativeBalance?.tokensBalanceStr ?? '0', chain)}</span></span>
					{/if}
				</div>
			</div>

			{#if getOrderType() === 'DIP'}
				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-g6">Dip %</span>
						<span class="text-[10px] text-g5">Buy when price drops this %</span>
					</div>
					<div class="flex gap-1">
						<input
							type="text"
							inputmode="decimal"
							placeholder="10"
							value={getDipPercent()}
							oninput={(e) => setDipPercent((e.target as HTMLInputElement).value)}
							class="w-20 shrink-0 rounded-md border border-bd bg-s4 px-2 py-1.5 text-sm font-bold text-tx placeholder-g3 outline-none transition-all focus:border-grn/40"
						/>
						<div class="flex min-w-0 flex-1 gap-0.5">
							{#each ['5', '10', '20', '30', '50'] as pct}
								<button
									class="flex-1 cursor-pointer rounded-md border py-1.5 text-[11px] font-semibold transition-all {getDipPercent() === pct ? 'border-grn/40 bg-grn/10 text-grn' : 'border-bd text-g6 hover:text-g11'}"
									onclick={() => setDipPercent(pct)}
								>
									{pct}%
								</button>
							{/each}
						</div>
					</div>
				</div>
			{:else if getOrderType() === 'LIMIT'}
				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-g6">Limit Price (USD)</span>
						{#if currentPriceUsd > 0}
							<button onclick={() => { setLimitPrice(String(currentPriceUsd)); limitPctOffset = 0; }} class="cursor-pointer text-[10px] text-grn hover:text-grn-dim">Current: ${currentPriceUsd < 0.01 ? currentPriceUsd.toPrecision(4) : currentPriceUsd.toFixed(4)}</button>
						{/if}
					</div>
					<input
						type="text"
						inputmode="decimal"
						placeholder="0.001"
						value={getLimitPrice()}
						oninput={(e) => { setLimitPrice((e.target as HTMLInputElement).value); limitPctOffset = 0; }}
						class="w-full rounded-md border border-bd bg-s4 px-2 py-1.5 text-sm font-bold text-tx placeholder-g3 outline-none transition-all focus:border-grn/40"
					/>
					{#if currentPriceUsd > 0}
						{@const thumbPos = (limitPctOffset + 99) / 199 * 100}
						{@const midPos = 99 / 199 * 100}
						<div class="mt-1.5">
							<div class="mb-1 flex items-center justify-between text-[10px]">
								<span class="text-g5">-99%</span>
								<span class="font-semibold {limitPctOffset > 0 ? 'text-grn' : limitPctOffset < 0 ? 'text-red' : 'text-g7'}">{limitPctOffset > 0 ? '+' : ''}{limitPctOffset.toFixed(0)}%</span>
								<span class="text-g5">+100%</span>
							</div>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								bind:this={sliderEl}
								class="relative h-5 cursor-pointer select-none touch-none"
								onmousedown={onSliderDown}
								ontouchstart={onSliderTouchStart}
							>
								<div class="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full bg-bd2"></div>
								{#if limitPctOffset > 0}
									<div class="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-grn" style="left: {midPos}%; width: {thumbPos - midPos}%;"></div>
								{:else if limitPctOffset < 0}
									<div class="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-red" style="left: {thumbPos}%; width: {midPos - thumbPos}%;"></div>
								{/if}
								<div
									class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full shadow-lg {limitPctOffset >= 0 ? 'bg-grn' : 'bg-red'}"
									style="left: {thumbPos}%;"
								></div>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{:else}
			<div>
				<div class="mb-1 flex items-center justify-between">
					<span class="text-[10px] font-semibold uppercase tracking-wider text-g6">Sell %</span>
					<span class="text-sm font-bold text-tx">{getSellPercent()}%</span>
				</div>
				<input
					type="range"
					min="1"
					max="100"
					value={getSellPercent()}
					oninput={(e) => setSellPercent(parseInt((e.target as HTMLInputElement).value))}
					class="w-full"
					aria-label="Sell percentage"
				/>
				<div class="mt-1 flex gap-1">
					{#each quickSellPcts as pct}
						<button
							class="flex-1 cursor-pointer rounded-md border py-1 text-[11px] font-bold transition-all duration-200 {getSellPercent() === pct ? 'border-red/40 bg-red/10 text-red' : 'border-bd text-g7 hover:text-g11 hover:border-g1'}"
							onclick={() => setSellPercent(pct)}
						>
							{pct}%
						</button>
					{/each}
				</div>
			</div>

			{#if existingTrade}
				<div class="overflow-hidden rounded-lg border border-bd bg-s1">
					<div class="flex items-center justify-between px-2.5 py-1.5">
						<div>
							<div class="text-[10px] text-g5">Holding</div>
							<div class="text-xs font-bold text-tx">{formatCompactNumber(existingTrade.tokensRemaining)} <span class="font-medium text-g7">{existingTrade.tokenSymbol}</span></div>
						</div>
						<div class="text-right">
							<div class="text-[10px] text-g5">Value</div>
							<div class="text-xs font-bold text-tx">{@html fmtVal(existingTrade.currentValue.usdStr, existingTrade.currentValue.nativeStr, chain)}
								<span class="font-semibold {existingTrade.pnl.usd >= 0 ? 'text-grn' : 'text-red'}">({existingTrade.pnl.usd >= 0 ? '+' : ''}{Number(existingTrade.pnl.pct).toFixed(1)}%)</span>
							</div>
						</div>
					</div>
					<div class="flex items-center justify-between border-t border-bd bg-red/[0.04] px-2.5 py-1.5">
						<span class="text-[10px] text-g6">Selling {getSellPercent()}%</span>
						<span class="text-xs font-bold text-red">&approx; {@html fmtVal(existingTrade.currentValue.usd * getSellPercent() / 100, existingTrade.currentValue.native * getSellPercent() / 100, chain)}</span>
					</div>
				</div>
			{/if}
		{/if}

		<div class="relative flex items-end gap-2 rounded-lg border border-bd bg-s2 px-2.5 py-2 {presetLocked ? 'opacity-60' : ''}">
			{#if presetLocked}
				<div class="absolute -top-2 right-2 rounded bg-s6 px-1.5 py-px text-[8px] font-semibold uppercase tracking-wider text-yel ring-1 ring-yel/40 shadow-sm">Set by {getSelectedConfigId()}</div>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="mb-0.5 text-[9px] font-medium uppercase tracking-wider text-g5">Gas</div>
				<select
					disabled={presetLocked}
					value={getActiveTradeTab() === 'buy' ? getBuyGasType() : getSellGasType()}
					onchange={(e) => {
						const v = (e.target as HTMLSelectElement).value as GasPreset;
						if (getActiveTradeTab() === 'buy') setBuyGasType(v);
						else setSellGasType(v);
					}}
					class="w-full cursor-pointer rounded-md border border-bd bg-s4 px-1.5 py-1 text-[11px] font-semibold text-tx outline-none disabled:cursor-not-allowed"
					style="color-scheme:dark"
				>
					{#each gasOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div class="min-w-0 flex-1">
				<div class="mb-0.5 text-[9px] font-medium uppercase tracking-wider text-g5">Slippage</div>
				<select
					disabled={presetLocked}
					value={slipValue === null ? 'AUTO' : String(slipValue)}
					onchange={(e) => {
						const v = (e.target as HTMLSelectElement).value;
						handleSlippageChange(v === 'AUTO' ? '' : v);
					}}
					class="w-full cursor-pointer rounded-md border border-bd bg-s4 px-1.5 py-1 text-[11px] font-semibold text-tx outline-none disabled:cursor-not-allowed"
					style="color-scheme:dark"
				>
					<option value="AUTO">Auto{autoSlippage != null ? ` ~${autoSlippage.toFixed(1)}%` : ''}</option>
					{#if slipValue !== null && ![1, 5, 10, 25].includes(slipValue)}
						<option value={String(slipValue)}>{slipValue}%</option>
					{/if}
					{#each [1, 5, 10, 25] as pct}
						<option value={String(pct)}>{pct}%</option>
					{/each}
				</select>
			</div>
			<div class="shrink-0">
				<div class="mb-0.5 text-center text-[9px] font-medium uppercase tracking-wider text-g5">MEV</div>
				<button
					disabled={presetLocked}
					class="relative mb-0.5 block h-5 w-9 cursor-pointer rounded-full transition-all duration-200 disabled:cursor-not-allowed {getAntiMev() ? 'bg-grn' : 'bg-bd2'}"
					onclick={() => setAntiMev(!getAntiMev())}
					aria-label="Toggle Anti-MEV protection"
				>
					<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh shadow-sm transition-transform duration-200 {getAntiMev() ? 'left-[18px]' : 'left-0.5'}"></div>
				</button>
			</div>
		</div>

		{#if getActiveTradeTab() === 'buy'}
		<div class="flex max-h-52 flex-col">
			<div class="mb-1.5 flex shrink-0 items-center justify-between">
				<span class="text-[10px] font-medium uppercase tracking-wider text-g6">Targets{#if presetLocked} <span class="normal-case text-yel/80">— set by {getSelectedConfigId()}</span>{/if}</span>
				{#if !presetLocked}
					<div class="flex items-center gap-1">
						<button
							onclick={() => addSellTarget('TAKE_PROFIT')}
							class="cursor-pointer rounded-md border border-bd px-2 py-0.5 text-[11px] text-grn transition-all hover:border-grn/40 hover:bg-grn/10"
						>
							+ TP
						</button>
						<button
							onclick={() => addSellTarget('STOP_LOSS')}
							class="cursor-pointer rounded-md border border-bd px-2 py-0.5 text-[11px] text-red transition-all hover:border-red/40 hover:bg-red/10"
						>
							+ SL
						</button>
						<button
							onclick={() => addSellTarget('STOP_LOSS', 'TRAILING')}
							class="cursor-pointer rounded-md border border-bd px-2 py-0.5 text-[11px] text-red transition-all hover:border-red/40 hover:bg-red/10"
						>
							+ Trailing SL
						</button>
					</div>
				{/if}
			</div>
			{#if getSellTargets().length === 0}
				<div class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-bd/50 text-[11px] text-g5">No targets — held until manual sell</div>
			{/if}
			<div class="grid min-h-0 auto-rows-max content-start gap-1.5 overflow-y-auto {getSellTargets().length === 1 ? 'grid-cols-1' : 'grid-cols-2'} {presetLocked ? 'pointer-events-none opacity-60' : ''}">
			{#each getSellTargets() as target, i}
				<TargetCard {target} onupdate={(t) => updateSellTarget(i, t)} onremove={() => removeSellTarget(i)} />
			{/each}
			</div>
		</div>
		{/if}
	</div>

	<div class="shrink-0 border-t border-bd bg-transparent p-2">
		{#if getActiveTradeTab() === 'buy' && managedWallet && !hasBalance}
			<button onclick={copyAddress} class="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-sm">
				{#if copied}
					Copied!
				{:else}
					Copy Deposit Address
				{/if}
			</button>
		{:else if getActiveTradeTab() === 'buy'}
			<button onclick={handleBuy} disabled={getBuyLoading() || !getBuyAmount()} class="btn-primary w-full py-2.5 text-sm active:scale-[0.98]">
				{#if getBuyLoading()}
					{getOrderType() === 'MARKET' ? 'Buying...' : 'Placing Order...'}
				{:else if !getBuyAmount()}
					Enter Amount
				{:else if getOrderType() === 'DIP'}
					<span class="inline-flex items-center gap-1">Dip Buy {#if isUsd()}${getBuyAmount()}{:else}{getBuyAmount()} <ChainIcon chain={chain} class="h-4 w-4" />{/if} at -{getDipPercent()}%</span>
				{:else if getOrderType() === 'LIMIT'}
					<span class="inline-flex items-center gap-1">Limit Buy {#if isUsd()}${getBuyAmount()}{:else}{getBuyAmount()} <ChainIcon chain={chain} class="h-4 w-4" />{/if} at ${getLimitPrice() || '?'}</span>
				{:else}
					<span class="inline-flex items-center gap-1">Buy {#if isUsd()}${getBuyAmount()}{:else}{getBuyAmount()} <ChainIcon chain={chain} class="h-4 w-4" />{/if}</span>
				{/if}
			</button>
		{:else}
			<button onclick={handleSell} disabled={getSellLoading()} class="btn-danger w-full py-2.5 text-sm active:scale-[0.98]">
				{#if getSellLoading()}
					Selling...
				{:else}
					Sell {getSellPercent()}%
				{/if}
			</button>
		{/if}
	</div>
	{/if}
	</div>
{/snippet}

<MobileScanModal bind:show={showMobileScan} />
