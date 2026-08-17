<script lang="ts">
	import { untrack } from 'svelte';
	import X from 'lucide-svelte/icons/x';
	import { api } from '$lib/api/client';
	import type { components } from '$lib/api/v2.d.ts';
	import { getManagedWalletForChain, fetchManagedWallets } from '$lib/stores/trade.svelte';
	import { isUsd } from '$lib/stores/currency.svelte';
	import { getPegPrices } from '$lib/stores/peg.svelte';
	import { portal } from '$lib/actions/portal';
	import { typeBadge } from '$lib/utils/format';
	import {
		buildBotConfig,
		createBotConfigForm,
		getBotChain,
		hydrateBotConfig,
		type Bot,
		type BotConfigErrors,
		type BotConfigField,
		type BotSourceDescriptor,
		type Chain,
		type GasMode
	} from '$lib/utils/bot-settings';
	import TargetCard from './TargetCard.svelte';
	type CreateBotRequest = components['schemas']['CreateBotRequest'];
	type UpdateBotStatusRequest = components['schemas']['UpdateBotStatusRequest'];
	type ErrorResponse = components['schemas']['ErrorResponse'];



	let {
		show = $bindable(false),
		source = null,
		editBot = null,
		defaultChain = 'SOL' as Chain,
		oncreated = () => {},
		onupdated = () => {}
	}: {
		show: boolean;
		source: BotSourceDescriptor | null;
		editBot?: Bot | null;
		defaultChain?: Chain;
		oncreated?: () => void;
		onupdated?: () => void;
	} = $props();

	let creating = $state(false);
	let error = $state('');
	let fieldErrors = $state<BotConfigErrors>({});

	function pegForChain(c: Chain): number {
		const pegChain = c === 'BASE' ? 'ETH' : c;
		return parseFloat(getPegPrices()[pegChain] ?? '0') || 0;
	}

	function convertAmount(val: string, from: 'USD' | 'NATIVE', to: 'USD' | 'NATIVE', c: Chain): string {
		const n = parseFloat(val);
		if (!n || isNaN(n)) return '';
		const peg = pegForChain(c);
		if (!peg) return val;
		const decimals = c === 'SOL' ? 4 : 6;
		if (from === 'USD' && to === 'NATIVE') return (n / peg).toFixed(decimals).replace(/\.?0+$/, '');
		if (from === 'NATIVE' && to === 'USD') return (n * peg).toFixed(2).replace(/\.?0+$/, '');
		return val;
	}

	function toggleAmountType() {
		const newType = form.amountType === 'USD' ? 'NATIVE' as const : 'USD' as const;
		form.amount = convertAmount(form.amount, form.amountType, newType, form.chain);
		form.amountType = newType;
	}

	let form = $state(createBotConfigForm('SOL', isUsd() ? 'USD' : 'NATIVE'));
	let botStatus = $state<'ACTIVE' | 'PAUSED'>('ACTIVE');
	let isWallet = $derived(source?.type === 'WALLET');
	let isEditing = $derived(!!editBot);

	const chains: Chain[] = ['SOL', 'ETH', 'BASE', 'BSC'];
	const gasOptions: { label: string; value: GasMode }[] = [
		{ label: 'Auto', value: 'AUTO' },
		{ label: 'Low', value: 'LOW' },
		{ label: 'Med', value: 'MEDIUM' },
		{ label: 'High', value: 'HIGH' },
		{ label: 'Custom', value: 'CUSTOM' }
	];

	function populateFromBot(bot: Bot) {
		botStatus = bot.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
		const chainKey = getBotChain(bot);
		if (!chainKey) return;
		form = hydrateBotConfig(chainKey, bot.chainConfigs[chainKey]);
	}

	$effect(() => {
		if (!show) return;
		const currentSource = source;
		const currentEditBot = editBot;
		const sourceChain = currentSource?.type === 'WALLET' ? currentSource.chain : undefined;
		const editChain = currentEditBot ? getBotChain(currentEditBot) : null;
		const initialChain = sourceChain ?? editChain ?? defaultChain;
		untrack(() => {
			resetForm(initialChain);
			void fetchManagedWallets();
			if (currentEditBot) populateFromBot(currentEditBot);
		});
	});

	function resetForm(chain: Chain = defaultChain) {
		botStatus = 'ACTIVE';
		const amountType = isUsd() ? 'USD' : 'NATIVE';
		const amount = amountType === 'USD' ? '25' : convertAmount('25', 'USD', 'NATIVE', chain);
		form = createBotConfigForm(chain, amountType, amount);
		error = '';
		fieldErrors = {};
	}

	function close() {
		show = false;
		resetForm();
	}

	function addSellTarget(targetKind: 'TAKE_PROFIT' | 'STOP_LOSS' = 'TAKE_PROFIT', mode: 'NORMAL' | 'TRAILING' = 'NORMAL') {
		const trailing = mode === 'TRAILING';
		form.sellTargets = [...form.sellTargets, { kind: targetKind === 'TAKE_PROFIT' ? 'MULTIPLE' : 'PERCENTAGE', triggerValue: targetKind === 'TAKE_PROFIT' ? '2' : trailing ? '20' : '50', sellPercent: targetKind === 'TAKE_PROFIT' ? '50' : '100', targetKind: trailing ? 'STOP_LOSS' : targetKind, mode: trailing ? 'TRAILING' : 'NORMAL' }];
	}

	function updateSellTarget(idx: number, target: typeof form.sellTargets[number]) {
		form.sellTargets = form.sellTargets.map((t, i) => i === idx ? target : t);
	}

	function removeSellTarget(idx: number) {
		form.sellTargets = form.sellTargets.filter((_, i) => i !== idx);
	}

	function fieldError(field: BotConfigField): string | undefined {
		return fieldErrors[field];
	}

	async function submit() {
		if (!source) return;
		if (isWallet && !source.chain && !editBot) {
			error = 'This wallet source is missing its chain. Re-select the wallet and try again.';
			return;
		}
		const managed = getManagedWalletForChain(form.chain);
		if (!managed) { error = `No managed wallet for ${form.chain}`; return; }
		const built = buildBotConfig(form, managed.address, isWallet, isEditing ? 'update' : 'create');
		if (!built.ok) {
			fieldErrors = built.errors;
			error = 'Fix the highlighted settings before saving.';
			return;
		}

		creating = true;
		error = '';
		fieldErrors = {};
		try {
			if (isEditing && editBot) {
				const { error: apiErr } = await api.POST('/v2/bots/{id}/update', {
					params: { path: { id: editBot.id } },
					body: { chainConfigs: { [form.chain]: built.config } }
				});
				if (apiErr) throw new Error((apiErr as ErrorResponse)?.message ?? 'Update failed');
				if (botStatus !== editBot.status) {
					const { error: statusError } = await api.POST('/v2/bots/{id}/status', {
						params: { path: { id: editBot.id } },
						body: { status: botStatus } satisfies UpdateBotStatusRequest
					});
					if (statusError) throw new Error((statusError as ErrorResponse)?.message ?? 'Status update failed');
				}
				close();
				onupdated();
			} else {
				const body: CreateBotRequest = {
					source: { id: source.id, type: source.type },
					chainConfigs: { [form.chain]: built.config as components['schemas']['BotChainConfigRequest'] }
				};
				const { error: apiErr } = await api.POST('/v2/bots/create', { body });
				if (apiErr) throw new Error((apiErr as ErrorResponse)?.message ?? 'Failed');
				close();
				oncreated();
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : isEditing ? 'Update failed' : 'Failed to create bot';
		} finally { creating = false; }
	}
</script>

{#if show && source}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[200] overflow-y-auto bg-s0/60 backdrop-blur-[2px]" use:portal>
		<div class="flex min-h-full items-center justify-center p-3 md:p-6" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
		<div class="animate-fade-in w-full max-w-md overflow-x-hidden rounded-2xl border border-bd bg-s5 p-6 shadow-2xl backdrop-blur-xl" onclick={(e) => e.stopPropagation()}>
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<h2 class="text-base font-semibold text-tx">{isEditing ? 'Edit' : 'Create'} {isWallet ? 'Copy Trade Bot' : 'Bot'}</h2>
					{#if isEditing}
					<button
						class="relative h-5 w-9 cursor-pointer rounded-full transition-colors {botStatus === 'ACTIVE' ? 'bg-grn' : 'bg-bd2'}"
						onclick={() => botStatus = botStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}
						title={botStatus === 'ACTIVE' ? 'Active — click to pause' : 'Paused — click to activate'}
						aria-label={botStatus === 'ACTIVE' ? 'Pause bot' : 'Activate bot'}
					>
						<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {botStatus === 'ACTIVE' ? 'left-[18px]' : 'left-0.5'}"></div>
						</button>
						<span class="text-xs {botStatus === 'ACTIVE' ? 'text-grn' : 'text-red'}">{botStatus === 'ACTIVE' ? 'Active' : 'Paused'}</span>
					{/if}
				</div>
				<button onclick={close} aria-label="Close" class="cursor-pointer text-g4 transition-colors hover:text-tx">
					<X class="h-4 w-4" />
				</button>
			</div>

			{#if error}
				<div class="mb-3 rounded-lg border border-red/20 bg-red/10 px-3 py-2 text-xs text-red">
					{error}
					<button class="ml-2 cursor-pointer underline opacity-70 hover:opacity-100" onclick={() => (error = '')}>dismiss</button>
				</div>
			{/if}

			<div class="mb-3 rounded-lg border border-bd bg-s2 p-3 text-xs">
				<div class="flex justify-between"><span class="text-g6">Source</span><span class="text-tx">{source.name}</span></div>
				<div class="mt-1 flex justify-between"><span class="text-g6">Type</span><span class="rounded px-1.5 py-0.5 {typeBadge(source.type)}">{source.type}</span></div>
				{#if isWallet}<div class="mt-1 flex justify-between"><span class="text-g6">Source chain</span><span class="font-medium text-tx">{form.chain}</span></div>{/if}
			</div>

			<div class="space-y-3">
				{#if !isWallet}
					<div>
						<span class="mb-1 block text-xs text-g6">Chain</span>
						<div class="flex gap-1">
							{#each chains as c}
								<button onclick={() => (form.chain = c)} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.chain === c ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">{c}</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if isWallet}
					<div class="space-y-3 rounded-lg border border-bd bg-s2 p-3">
						<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Copy Trade Settings</span>

						<div>
							<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Buy Sizing</span>
							<div class="flex gap-1">
							<button onclick={() => (form.buySizing = 'fixed')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.buySizing === 'fixed' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">Fixed</button>
							<button onclick={() => (form.buySizing = 'proportion')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.buySizing === 'proportion' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">Match</button>
							<button onclick={() => (form.buySizing = 'balance_pct')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.buySizing === 'balance_pct' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">% Balance</button>
						</div>
						{#if form.buySizing === 'proportion'}
							<div class="mt-1.5">
								<span class="text-[10px] text-g4">Proportion of source trade (1.0 = match exactly)</span>
								<div class="mt-0.5 flex overflow-hidden rounded-lg border bg-s4 {fieldError('buyProportion') ? 'border-red/40' : 'border-bd'}">
									<input type="text" inputmode="decimal" bind:value={form.buyProportion} placeholder="1.0" class="flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
									<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">x</span>
								</div>
								{#if fieldError('buyProportion')}<p class="mt-1 text-[10px] text-red">{fieldError('buyProportion')}</p>{/if}
							</div>
						{:else if form.buySizing === 'balance_pct'}
							<div class="mt-1.5">
								<span class="text-[10px] text-g4">Percent of your wallet balance per buy</span>
								<div class="mt-0.5 flex overflow-hidden rounded-lg border bg-s4 {fieldError('buyBalancePct') ? 'border-red/40' : 'border-bd'}">
									<input type="text" inputmode="decimal" bind:value={form.buyBalancePct} placeholder="10" class="flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
									<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
								</div>
								{#if fieldError('buyBalancePct')}<p class="mt-1 text-[10px] text-red">{fieldError('buyBalancePct')}</p>{/if}
								</div>
							{/if}
						</div>

						<div class="flex items-center justify-between rounded-lg border border-bd bg-s4 px-3 py-2">
							<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Copy Sells</span>
						<button aria-label="Toggle copy sells" onclick={() => (form.copySells = !form.copySells)} class="relative h-5 w-9 cursor-pointer rounded-full transition-colors {form.copySells ? 'bg-grn' : 'bg-bd2'}">
							<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {form.copySells ? 'left-[18px]' : 'left-0.5'}"></div>
							</button>
						</div>

					{#if form.copySells}
							<div>
								<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Sell Sizing</span>
								<div class="flex gap-1">
							<button onclick={() => (form.sellSizing = 'proportion')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.sellSizing === 'proportion' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">Match</button>
							<button onclick={() => (form.sellSizing = 'position_pct')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.sellSizing === 'position_pct' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">% Position</button>
						</div>
						{#if form.sellSizing === 'proportion'}
							<div class="mt-1.5">
								<span class="text-[10px] text-g4">Proportion of the source sell, capped by the remaining bot position</span>
								<div class="mt-0.5 flex overflow-hidden rounded-lg border bg-s4 {fieldError('sellProportion') ? 'border-red/40' : 'border-bd'}">
									<input type="text" inputmode="decimal" bind:value={form.sellProportion} placeholder="1.0" class="flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
									<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">x</span>
								</div>
								{#if fieldError('sellProportion')}<p class="mt-1 text-[10px] text-red">{fieldError('sellProportion')}</p>{/if}
								{#if form.sellProportion.trim() === '0'}<p class="mt-1 rounded-md bg-yel/10 px-2 py-1 text-[10px] text-yel">Zero submits no swap and ends copy-sell tracking as fully sold.</p>{/if}
							</div>
						{:else}
							<div class="mt-1.5">
								<span class="text-[10px] text-g4">Percent of the remaining bot position on each source sell</span>
								<div class="mt-0.5 flex overflow-hidden rounded-lg border bg-s4 {fieldError('sellPositionPct') ? 'border-red/40' : 'border-bd'}">
									<input type="text" inputmode="decimal" bind:value={form.sellPositionPct} placeholder="100" class="flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
									<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
								</div>
								{#if fieldError('sellPositionPct')}<p class="mt-1 text-[10px] text-red">{fieldError('sellPositionPct')}</p>{/if}
								{#if form.sellPositionPct.trim() === '0'}<p class="mt-1 rounded-md bg-yel/10 px-2 py-1 text-[10px] text-yel">Zero submits no swap and ends copy-sell tracking as fully sold.</p>{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				{#if form.buySizing === 'fixed'}
					<div>
						<span class="mb-1 block text-xs text-g6">Buy Amount</span>
						<div class="flex overflow-hidden rounded-lg border bg-s4 {fieldError('amount') ? 'border-red/40' : 'border-bd'}">
							<input type="text" inputmode="decimal" bind:value={form.amount} placeholder="0.00" class="flex-1 bg-transparent px-3 py-1.5 text-sm text-tx outline-none" />
							<button onclick={toggleAmountType} class="cursor-pointer border-l border-bd bg-s4 px-3 text-xs text-g7 hover:text-tx">{form.amountType}</button>
						</div>
						{#if fieldError('amount')}<p class="mt-1 text-[10px] text-red">{fieldError('amount')}</p>{/if}
					</div>
				{/if}

				<div>
					<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Buy At</span>
					<div class="flex gap-1">
						<button onclick={() => (form.buyAt = 'market')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.buyAt === 'market' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">Market</button>
						<button onclick={() => (form.buyAt = 'dip')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.buyAt === 'dip' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">Dip</button>
						<button onclick={() => (form.buyAt = 'limit')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-medium transition-colors {form.buyAt === 'limit' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">Limit</button>
					</div>
					{#if form.buyAt === 'dip'}
						<div class="mt-1.5 flex overflow-hidden rounded-lg border bg-s4 {fieldError('buyAtDipPercent') ? 'border-red/40' : 'border-bd'}">
							<input type="text" inputmode="decimal" bind:value={form.buyAtDipPercent} placeholder="Dip %" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
							<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
						</div>
						{#if fieldError('buyAtDipPercent')}<p class="mt-1 text-[10px] text-red">{fieldError('buyAtDipPercent')}</p>{/if}
					{:else if form.buyAt === 'limit'}
						<div class="mt-1.5 flex overflow-hidden rounded-lg border bg-s4 {fieldError('buyAtLimitPrice') ? 'border-red/40' : 'border-bd'}">
							<input type="text" inputmode="decimal" bind:value={form.buyAtLimitPrice} placeholder="Price USD" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
							<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">USD</span>
						</div>
						{#if fieldError('buyAtLimitPrice')}<p class="mt-1 text-[10px] text-red">{fieldError('buyAtLimitPrice')}</p>{/if}
					{/if}
				</div>

				{#each [{ value: form.buyGasMode, set: (v: GasMode) => (form.buyGasMode = v), custom: form.buyCustomGas, setCustom: (v: string) => (form.buyCustomGas = v), field: 'buyCustomGas' as const, label: 'Buy Gas' }, { value: form.sellGasMode, set: (v: GasMode) => (form.sellGasMode = v), custom: form.sellCustomGas, setCustom: (v: string) => (form.sellCustomGas = v), field: 'sellCustomGas' as const, label: 'Sell Gas' }] as gas}
					<div>
						<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">{gas.label}</span>
						<div class="flex gap-1">
							{#each gasOptions as opt}
								<button onclick={() => gas.set(opt.value)} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-[11px] font-medium transition-colors {gas.value === opt.value ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">{opt.label}</button>
							{/each}
						</div>
						{#if gas.value === 'CUSTOM'}
							<div class="mt-1.5 flex overflow-hidden rounded-lg border bg-s4 {fieldError(gas.field) ? 'border-red/40' : 'border-bd'}">
								<input type="text" inputmode="decimal" value={gas.custom} oninput={(e) => gas.setCustom((e.target as HTMLInputElement).value)} placeholder="0" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
								<span class="flex items-center border-l border-bd bg-s4 px-2 text-[10px] text-g5">{form.chain} priority fee</span>
							</div>
							<p class="mt-1 text-[10px] text-g4">Native-token priority or tip budget, not the total transaction fee.</p>
							{#if fieldError(gas.field)}<p class="mt-1 text-[10px] text-red">{fieldError(gas.field)}</p>{/if}
						{/if}
					</div>
				{/each}

				<div class="flex gap-2">
					<div class="min-w-0 flex-1">
						<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Buy Slippage</span>
						<div class="flex overflow-hidden rounded-lg border bg-s4 {fieldError('buySlippage') ? 'border-red/40' : 'border-bd'}">
							<input type="text" inputmode="decimal" bind:value={form.buySlippage} placeholder="Auto" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
							<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
						</div>
						{#if fieldError('buySlippage')}<p class="mt-1 text-[10px] text-red">{fieldError('buySlippage')}</p>{/if}
					</div>
					<div class="min-w-0 flex-1">
						<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Sell Slippage</span>
						<div class="flex overflow-hidden rounded-lg border bg-s4 {fieldError('sellSlippage') ? 'border-red/40' : 'border-bd'}">
							<input type="text" inputmode="decimal" bind:value={form.sellSlippage} placeholder="Auto" class="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none" />
							<span class="flex items-center border-l border-bd bg-s4 px-2 text-xs text-g5">%</span>
						</div>
						{#if fieldError('sellSlippage')}<p class="mt-1 text-[10px] text-red">{fieldError('sellSlippage')}</p>{/if}
					</div>
				</div>

				<div class="flex items-center justify-between rounded-lg border border-bd bg-s4 px-3 py-2">
					<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Anti-MEV (Private TX)</span>
					<button aria-label="Toggle anti-MEV" onclick={() => (form.antiMev = !form.antiMev)} class="relative h-5 w-9 cursor-pointer rounded-full transition-colors {form.antiMev ? 'bg-grn' : 'bg-bd2'}">
						<div class="absolute top-0.5 h-4 w-4 rounded-full bg-wh transition-transform {form.antiMev ? 'left-[18px]' : 'left-0.5'}"></div>
					</button>
				</div>

				<div>
					<div class="mb-1.5 flex items-center justify-between">
						<span class="text-xs text-g6">Targets</span>
						<div class="flex items-center gap-1">
							<button onclick={() => addSellTarget('TAKE_PROFIT')} class="cursor-pointer rounded-md border border-bd px-2 py-0.5 text-[11px] text-grn transition-all hover:border-grn/40 hover:bg-grn/10">+ TP</button>
							<button onclick={() => addSellTarget('STOP_LOSS')} class="cursor-pointer rounded-md border border-bd px-2 py-0.5 text-[11px] text-red transition-all hover:border-red/40 hover:bg-red/10">+ SL</button>
							<button onclick={() => addSellTarget('STOP_LOSS', 'TRAILING')} class="cursor-pointer rounded-md border border-bd px-2 py-0.5 text-[11px] text-red transition-all hover:border-red/40 hover:bg-red/10">+ Trailing SL</button>
						</div>
					</div>
					{#if form.sellTargets.length === 0}
						<div class="rounded-md bg-s2 px-2.5 py-2 text-[11px] text-g5">
							{form.copySells ? 'No targets set. Copied sells remain active independently.' : 'No targets set. Tokens held until manual sell.'}
						</div>
					{:else}
						<div class="grid max-h-44 auto-rows-max content-start gap-1.5 overflow-y-auto {form.sellTargets.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}">
							{#each form.sellTargets as target, i}
								<TargetCard {target} triggerError={fieldError(`target.${i}.triggerValue`)} sellError={fieldError(`target.${i}.sellPercent`)} onupdate={(t) => updateSellTarget(i, t)} onremove={() => removeSellTarget(i)} />
							{/each}
						</div>
						{#if form.copySells}<p class="mt-1 text-[10px] text-g4">Targets and copied sells trigger independently; either may reduce the remaining position first.</p>{/if}
					{/if}
				</div>

				<button onclick={submit} disabled={creating} class="btn-primary w-full py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50">
					{creating ? (isEditing ? 'Updating...' : 'Creating...') : isEditing ? 'Update Bot' : isWallet ? 'Create Copy Trade Bot' : 'Create Bot'}
				</button>
			</div>
		</div>
		</div>
	</div>
{/if}
