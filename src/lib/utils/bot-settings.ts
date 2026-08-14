import type { components } from '$lib/api/v2.d.ts';
import type { SellTargetKind, SellTargetRow } from '$lib/stores/trade.svelte';

export type Bot = components['schemas']['Bot'];
export type BotChainConfig = components['schemas']['BotChainConfig'];
export type BotChainConfigDiff = components['schemas']['BotChainConfigDiff'];
export type BotChainConfigRequest = components['schemas']['BotChainConfigRequest'];
export type BotSourceStrategy = components['schemas']['BotSourceStrategy'];
export type CallerSource = components['schemas']['CallerSource'];
export type Chain = components['schemas']['Chain'];
export type GasPreset = components['schemas']['GasPreset'];
export type TradeTargetConfig = components['schemas']['TradeTargetConfig'];

export type GasMode = GasPreset | 'CUSTOM';
export type BuySizingMode = 'fixed' | 'proportion' | 'balance_pct';
export type SellSizingMode = 'proportion' | 'position_pct';
export type BuyAtMode = 'market' | 'dip' | 'limit';
export type AmountType = 'USD' | 'NATIVE';

export type BotSourceDescriptor = {
	id: string;
	type: CallerSource;
	name: string;
	chain?: Chain;
};

export type BotConfigForm = {
	chain: Chain;
	amount: string;
	amountType: AmountType;
	buyGasMode: GasMode;
	buyCustomGas: string;
	sellGasMode: GasMode;
	sellCustomGas: string;
	buySlippage: string;
	sellSlippage: string;
	antiMev: boolean;
	buyAt: BuyAtMode;
	buyAtDipPercent: string;
	buyAtLimitPrice: string;
	sellTargets: SellTargetRow[];
	copySells: boolean;
	buySizing: BuySizingMode;
	buyProportion: string;
	buyBalancePct: string;
	sellSizing: SellSizingMode;
	sellProportion: string;
	sellPositionPct: string;
};

export type BotConfigField = keyof BotConfigForm | `target.${number}.triggerValue` | `target.${number}.sellPercent`;
export type BotConfigErrors = Partial<Record<BotConfigField, string>>;

type ParsedNumber = { value?: number; error?: string };

export type BotConfigBuildResult =
	| { ok: true; config: BotChainConfigRequest | BotChainConfigDiff }
	| { ok: false; errors: BotConfigErrors };

export type BotConfigSummary = {
	chain: Chain;
	buy: string;
	copySells: string | null;
	copySellCap: boolean;
	zeroCopySell: boolean;
	targetCount: number;
};

export function createBotConfigForm(chain: Chain, amountType: AmountType, amount = '25'): BotConfigForm {
	return {
		chain,
		amount,
		amountType,
		buyGasMode: 'AUTO',
		buyCustomGas: '',
		sellGasMode: 'AUTO',
		sellCustomGas: '',
		buySlippage: '',
		sellSlippage: '',
		antiMev: false,
		buyAt: 'market',
		buyAtDipPercent: '',
		buyAtLimitPrice: '',
		sellTargets: [],
		copySells: false,
		buySizing: 'fixed',
		buyProportion: '1',
		buyBalancePct: '',
		sellSizing: 'proportion',
		sellProportion: '1',
		sellPositionPct: ''
	};
}

export function hydrateBotConfig(chain: Chain, config: BotChainConfig): BotConfigForm {
	const form = createBotConfigForm(chain, config.buy.amount?.type ?? 'USD');

	if (config.buy.amount) {
		form.amount = String(config.buy.amount.value);
		form.amountType = config.buy.amount.type;
	}

	if (config.buy.strategy.type === 'DIP') {
		form.buyAt = 'dip';
		form.buyAtDipPercent = String(config.buy.strategy.dipPct);
	} else if (config.buy.strategy.type === 'LIMIT') {
		form.buyAt = 'limit';
		form.buyAtLimitPrice = String(config.buy.strategy.priceUsd);
	}

	hydrateGas(config.trade.buyGas, (mode, custom) => {
		form.buyGasMode = mode;
		form.buyCustomGas = custom;
	});
	hydrateGas(config.trade.sellGas, (mode, custom) => {
		form.sellGasMode = mode;
		form.sellCustomGas = custom;
	});
	form.buySlippage = config.trade.buySlippagePct === 'AUTO' ? '' : String(config.trade.buySlippagePct);
	form.sellSlippage = config.trade.sellSlippagePct === 'AUTO' ? '' : String(config.trade.sellSlippagePct);
	form.antiMev = config.trade.antiMev;
	form.sellTargets = config.trade.targets.map(hydrateTarget);

	const sourceStrategy = config.sourceStrategy;
	if (sourceStrategy?.buy?.type === 'SOURCE_TRADE_PROPORTION') {
		form.buySizing = 'proportion';
		form.buyProportion = String(sourceStrategy.buy.proportion);
	} else if (sourceStrategy?.buy?.type === 'WALLET_BALANCE_PERCENT') {
		form.buySizing = 'balance_pct';
		form.buyBalancePct = String(sourceStrategy.buy.pct);
	}

	if (sourceStrategy?.sell?.type === 'SOURCE_TRADE_PROPORTION') {
		form.copySells = true;
		form.sellSizing = 'proportion';
		form.sellProportion = String(sourceStrategy.sell.proportion);
	} else if (sourceStrategy?.sell?.type === 'BOT_POSITION_PERCENT') {
		form.copySells = true;
		form.sellSizing = 'position_pct';
		form.sellPositionPct = String(sourceStrategy.sell.pct);
	}

	return form;
}

export function buildBotConfig(
	form: BotConfigForm,
	walletAddress: string,
	isWallet: boolean,
	mode: 'create' | 'update'
): BotConfigBuildResult {
	const errors: BotConfigErrors = {};
	const buyStrategy = buildBuyStrategy(form, errors);
	const targets = buildTargets(form.sellTargets, errors);
	const buyGas = parseGas(form.buyGasMode, form.buyCustomGas, 'buyCustomGas', errors);
	const sellGas = parseGas(form.sellGasMode, form.sellCustomGas, 'sellCustomGas', errors);
	const buySlippagePct = parseSlippage(form.buySlippage, 'buySlippage', errors);
	const sellSlippagePct = parseSlippage(form.sellSlippage, 'sellSlippage', errors);
	const sourceStrategy = isWallet ? buildSourceStrategy(form, errors) : undefined;
	let amount: BotChainConfigRequest['buy']['amount'];

	if (!isWallet || form.buySizing === 'fixed') {
		const parsed = parseDecimal(form.amount, { label: 'Buy amount', minExclusive: 0, maxScale: form.amountType === 'USD' ? 4 : 9 });
		if (parsed.error) errors.amount = parsed.error;
		else amount = { type: form.amountType, value: parsed.value! };
	}

	if (Object.keys(errors).length > 0 || !buyStrategy || !targets || buyGas === undefined || sellGas === undefined || buySlippagePct === undefined || sellSlippagePct === undefined) {
		return { ok: false, errors };
	}

	const trade = {
		antiMev: form.antiMev,
		buyGas,
		sellGas,
		buySlippagePct,
		sellSlippagePct,
		targets
	};

	if (mode === 'create') {
		const config: BotChainConfigRequest = {
			buy: { ...(amount ? { amount } : {}), strategy: buyStrategy },
			trade,
			walletAddress
		};
		if (sourceStrategy) config.sourceStrategy = sourceStrategy;
		return { ok: true, config };
	}

	const config: BotChainConfigDiff = {
		buy: {
			amount: amount ?? null,
			strategy: buyStrategy
		},
		trade,
		walletAddress,
		sourceStrategy: sourceStrategy ?? null
	};
	return { ok: true, config };
}

export function summarizeBotConfig(chain: Chain, config: BotChainConfig, isWallet: boolean): BotConfigSummary {
	const sourceStrategy = config.sourceStrategy;
	let buy = config.buy.amount
		? `${formatNumber(config.buy.amount.value)} ${config.buy.amount.type}`
		: 'Source-sized buy';

	if (sourceStrategy?.buy?.type === 'SOURCE_TRADE_PROPORTION') {
		buy = `${formatNumber(sourceStrategy.buy.proportion)}× source buy`;
	} else if (sourceStrategy?.buy?.type === 'WALLET_BALANCE_PERCENT') {
		buy = `${formatNumber(sourceStrategy.buy.pct)}% wallet balance`;
	}

	let copySells: string | null = null;
	let copySellCap = false;
	let zeroCopySell = false;
	if (isWallet) {
		if (sourceStrategy?.sell?.type === 'SOURCE_TRADE_PROPORTION') {
			copySells = `${formatNumber(sourceStrategy.sell.proportion)}× source sell`;
			copySellCap = true;
			zeroCopySell = sourceStrategy.sell.proportion === 0;
		} else if (sourceStrategy?.sell?.type === 'BOT_POSITION_PERCENT') {
			copySells = `${formatNumber(sourceStrategy.sell.pct)}% remaining position`;
			zeroCopySell = sourceStrategy.sell.pct === 0;
		} else {
			copySells = 'Disabled';
		}
	}

	return {
		chain,
		buy,
		copySells,
		copySellCap,
		zeroCopySell,
		targetCount: config.trade.targets.length
	};
}

export function getBotChain(bot: Bot): Chain | null {
	return (Object.keys(bot.chainConfigs)[0] as Chain | undefined) ?? null;
}

function hydrateGas(value: BotChainConfig['trade']['buyGas'], assign: (mode: GasMode, custom: string) => void) {
	if (typeof value === 'number') assign('CUSTOM', String(value));
	else assign(value, '');
}

function hydrateTarget(target: TradeTargetConfig): SellTargetRow {
	let kind: SellTargetKind;
	let triggerValue: string;
	if (target.trigger.type === 'MULTIPLIER') {
		kind = 'MULTIPLE';
		triggerValue = String(target.trigger.multiplier);
	} else if (target.trigger.type === 'PERCENT') {
		kind = 'PERCENTAGE';
		triggerValue = String(Math.abs(target.trigger.changePct));
	} else if (target.trigger.type === 'MARKET_CAP_USD') {
		kind = 'MARKETCAP';
		triggerValue = String(target.trigger.marketCapUsd);
	} else {
		kind = 'USD';
		triggerValue = String(target.trigger.priceUsd);
	}
	return {
		kind,
		triggerValue,
		sellPercent: String(target.sellPct),
		targetKind: target.kind,
		mode: target.kind === 'STOP_LOSS' ? target.mode ?? 'NORMAL' : 'NORMAL'
	};
}

function buildBuyStrategy(form: BotConfigForm, errors: BotConfigErrors): BotChainConfigRequest['buy']['strategy'] | null {
	if (form.buyAt === 'market') return { type: 'MARKET' };
	if (form.buyAt === 'dip') {
		const parsed = parseDecimal(form.buyAtDipPercent, { label: 'Dip percentage', minExclusive: 0, max: 100, maxScale: 3 });
		if (parsed.error) {
			errors.buyAtDipPercent = parsed.error;
			return null;
		}
		return { type: 'DIP', dipPct: parsed.value! };
	}

	const parsed = parseDecimal(form.buyAtLimitPrice, { label: 'Limit price', minExclusive: 0, maxScale: 12 });
	if (parsed.error) {
		errors.buyAtLimitPrice = parsed.error;
		return null;
	}
	return { type: 'LIMIT', priceUsd: parsed.value! };
}

function buildSourceStrategy(form: BotConfigForm, errors: BotConfigErrors): BotSourceStrategy | undefined {
	const strategy: BotSourceStrategy = {};
	if (form.buySizing === 'proportion') {
		const parsed = parseDecimal(form.buyProportion, { label: 'Buy proportion', min: 0, maxScale: 3 });
		if (parsed.error) errors.buyProportion = parsed.error;
		else strategy.buy = { type: 'SOURCE_TRADE_PROPORTION', proportion: parsed.value! };
	} else if (form.buySizing === 'balance_pct') {
		const parsed = parseDecimal(form.buyBalancePct, { label: 'Wallet balance percentage', min: 0, max: 100, maxScale: 3 });
		if (parsed.error) errors.buyBalancePct = parsed.error;
		else strategy.buy = { type: 'WALLET_BALANCE_PERCENT', pct: parsed.value! };
	}

	if (form.copySells && form.sellSizing === 'proportion') {
		const parsed = parseDecimal(form.sellProportion, { label: 'Sell proportion', min: 0, maxScale: 3 });
		if (parsed.error) errors.sellProportion = parsed.error;
		else strategy.sell = { type: 'SOURCE_TRADE_PROPORTION', proportion: parsed.value! };
	} else if (form.copySells) {
		const parsed = parseDecimal(form.sellPositionPct, { label: 'Position percentage', min: 0, max: 100, maxScale: 3 });
		if (parsed.error) errors.sellPositionPct = parsed.error;
		else strategy.sell = { type: 'BOT_POSITION_PERCENT', pct: parsed.value! };
	}

	return strategy.buy || strategy.sell ? strategy : undefined;
}

function parseGas(mode: GasMode, custom: string, field: 'buyCustomGas' | 'sellCustomGas', errors: BotConfigErrors): GasPreset | number | undefined {
	if (mode !== 'CUSTOM') return mode;
	const parsed = parseDecimal(custom, { label: field === 'buyCustomGas' ? 'Buy gas' : 'Sell gas', min: 0, maxScale: 12 });
	if (parsed.error) errors[field] = parsed.error;
	return parsed.value;
}

function parseSlippage(value: string, field: 'buySlippage' | 'sellSlippage', errors: BotConfigErrors): 'AUTO' | number | undefined {
	if (value.trim() === '') return 'AUTO';
	const parsed = parseDecimal(value, { label: field === 'buySlippage' ? 'Buy slippage' : 'Sell slippage', min: 0, max: 100, maxScale: 3 });
	if (parsed.error) errors[field] = parsed.error;
	return parsed.value;
}

function buildTargets(rows: SellTargetRow[], errors: BotConfigErrors): TradeTargetConfig[] | null {
	const targets: TradeTargetConfig[] = [];
	rows.forEach((row, index) => {
		const sellPct = parseDecimal(row.sellPercent, { label: 'Sell percentage', minExclusive: 0, max: 100, maxScale: 3 });
		if (sellPct.error) errors[`target.${index}.sellPercent`] = sellPct.error;

		let trigger: TradeTargetConfig['trigger'] | null = null;
		if (row.kind === 'MULTIPLE') {
			const parsed = parseDecimal(row.triggerValue, {
				label: 'Target multiplier',
				...(row.targetKind === 'TAKE_PROFIT' ? { minExclusive: 1 } : { minExclusive: 0, maxExclusive: 1 })
			});
			if (parsed.error) errors[`target.${index}.triggerValue`] = parsed.error;
			else trigger = { type: 'MULTIPLIER', multiplier: parsed.value! };
		} else if (row.kind === 'PERCENTAGE') {
			const parsed = parseDecimal(row.triggerValue, {
				label: 'Target percentage',
				minExclusive: 0,
				...(row.targetKind === 'STOP_LOSS' ? { maxExclusive: 100 } : {}),
				maxScale: 3
			});
			if (parsed.error) errors[`target.${index}.triggerValue`] = parsed.error;
			else trigger = { type: 'PERCENT', changePct: parsed.value! };
		} else {
			const parsed = parseDecimal(row.triggerValue, { label: row.kind === 'MARKETCAP' ? 'Market cap' : 'Price', minExclusive: 0, maxScale: 12 });
			if (parsed.error) errors[`target.${index}.triggerValue`] = parsed.error;
			else trigger = row.kind === 'MARKETCAP'
				? { type: 'MARKET_CAP_USD', marketCapUsd: parsed.value! }
				: { type: 'PRICE', priceUsd: parsed.value! };
		}

		if (!sellPct.error && trigger) {
			targets.push(row.targetKind === 'STOP_LOSS'
				? { kind: 'STOP_LOSS', sellPct: sellPct.value!, trigger, mode: row.mode }
				: { kind: 'TAKE_PROFIT', sellPct: sellPct.value!, trigger });
		}
	});
	return Object.keys(errors).some((field) => field.startsWith('target.')) ? null : targets;
}

function parseDecimal(
	raw: string,
	constraints: { label: string; min?: number; minExclusive?: number; max?: number; maxExclusive?: number; maxScale?: number }
): ParsedNumber {
	const value = raw.trim();
	if (!value) return { error: `${constraints.label} is required` };
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return { error: `${constraints.label} must be a finite number` };
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return { error: `${constraints.label} must be a finite number` };
	const scale = value.replace(/^[+-]/, '').split('.')[1]?.length ?? 0;
	if (constraints.maxScale !== undefined && scale > constraints.maxScale) {
		return { error: `${constraints.label} supports up to ${constraints.maxScale} decimal places` };
	}
	if (constraints.min !== undefined && parsed < constraints.min) return { error: `${constraints.label} must be at least ${constraints.min}` };
	if (constraints.minExclusive !== undefined && parsed <= constraints.minExclusive) return { error: `${constraints.label} must be greater than ${constraints.minExclusive}` };
	if (constraints.max !== undefined && parsed > constraints.max) return { error: `${constraints.label} must be at most ${constraints.max}` };
	if (constraints.maxExclusive !== undefined && parsed >= constraints.maxExclusive) return { error: `${constraints.label} must be less than ${constraints.maxExclusive}` };
	return { value: parsed };
}

function formatNumber(value: number): string {
	return String(value);
}
