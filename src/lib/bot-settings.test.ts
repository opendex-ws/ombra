import { describe, expect, test } from 'vitest';
import {
	buildBotConfig,
	createBotConfigForm,
	hydrateBotConfig,
	hydrateBotLimits,
	summarizeBotConfig,
	summarizeBotLimits,
	type BotChainConfig,
	type BotChainConfigDiff,
	type BotChainConfigRequest
} from './utils/bot-settings';

function validWalletForm() {
	return createBotConfigForm('SOL', 'USD');
}

function responseConfig(overrides: Partial<BotChainConfig> = {}): BotChainConfig {
	return {
		walletAddress: '0x1111111111111111111111111111111111111111',
		buy: { amount: { type: 'USD', value: 25 }, strategy: { type: 'MARKET' } },
		trade: {
			antiMev: false,
			buyGas: 'AUTO',
			sellGas: 'AUTO',
			buySlippagePct: 'AUTO',
			sellSlippagePct: 'AUTO',
			targets: []
		},
		...overrides
	};
}

describe('bot settings adapter', () => {
	test('serializes fixed buys with a sell-only position strategy', () => {
		const form = validWalletForm();
		form.copySells = true;
		form.sellSizing = 'position_pct';
		form.sellPositionPct = '25';

		const result = buildBotConfig(form, 'wallet', true, 'create');
		expect(result.ok).toBe(true);
		const config = (result as { ok: true; config: BotChainConfigRequest }).config;
		expect(config.buy.amount).toEqual({ type: 'USD', value: 25 });
		expect(config.sourceStrategy).toEqual({ sell: { type: 'BOT_POSITION_PERCENT', pct: 25 } });
	});

	test('omits an empty source strategy on create', () => {
		const result = buildBotConfig(validWalletForm(), 'wallet', true, 'create');
		expect(result.ok).toBe(true);
		expect((result as { ok: true; config: BotChainConfigRequest }).config).not.toHaveProperty('sourceStrategy');
	});

	test('serializes source buy and sell proportions together', () => {
		const form = validWalletForm();
		form.buySizing = 'proportion';
		form.buyProportion = '1.25';
		form.copySells = true;
		form.sellSizing = 'proportion';
		form.sellProportion = '0.5';

		const result = buildBotConfig(form, 'wallet', true, 'create');
		expect(result).toMatchObject({
			ok: true,
			config: {
				buy: { strategy: { type: 'MARKET' } },
				sourceStrategy: {
					buy: { type: 'SOURCE_TRADE_PROPORTION', proportion: 1.25 },
					sell: { type: 'SOURCE_TRADE_PROPORTION', proportion: 0.5 }
				}
			}
		});
	});

	test('uses whole-object replacement semantics when copied sells are disabled', () => {
		const sourceBuy = validWalletForm();
		sourceBuy.buySizing = 'balance_pct';
		sourceBuy.buyBalancePct = '10';
		const sourceResult = buildBotConfig(sourceBuy, 'wallet', true, 'update');
		expect(sourceResult.ok).toBe(true);
		expect((sourceResult as { ok: true; config: BotChainConfigDiff }).config.sourceStrategy).toEqual({
			buy: { type: 'WALLET_BALANCE_PERCENT', pct: 10 }
		});

		const fixedResult = buildBotConfig(validWalletForm(), 'wallet', true, 'update');
		expect(fixedResult.ok).toBe(true);
		expect((fixedResult as { ok: true; config: BotChainConfigDiff }).config.sourceStrategy).toBeNull();
	});

	test('round-trips custom gas and numeric slippage without coercion', () => {
		const form = hydrateBotConfig('SOL', responseConfig({
			trade: {
				antiMev: true,
				buyGas: 0,
				sellGas: 0.000012,
				buySlippagePct: 0,
				sellSlippagePct: 12.5,
				targets: []
			}
		}));
		expect(form).toMatchObject({
			buyGasMode: 'CUSTOM',
			buyCustomGas: '0',
			sellGasMode: 'CUSTOM',
			sellCustomGas: '0.000012',
			buySlippage: '0',
			sellSlippage: '12.5'
		});

		const result = buildBotConfig(form, 'wallet', true, 'update');
		expect(result).toMatchObject({
			ok: true,
			config: { trade: { buyGas: 0, sellGas: 0.000012, buySlippagePct: 0, sellSlippagePct: 12.5 } }
		});
	});

	test('sends positive stop-loss percentages and validates trigger bounds', () => {
		const form = validWalletForm();
		form.sellTargets = [{
			kind: 'PERCENTAGE',
			triggerValue: '50',
			sellPercent: '100',
			targetKind: 'STOP_LOSS',
			mode: 'NORMAL'
		}];
		const result = buildBotConfig(form, 'wallet', true, 'create');
		expect(result).toMatchObject({
			ok: true,
			config: { trade: { targets: [{ kind: 'STOP_LOSS', trigger: { type: 'PERCENT', changePct: 50 } }] } }
		});

		form.sellTargets[0].triggerValue = '100';
		const invalid = buildBotConfig(form, 'wallet', true, 'create');
		expect(invalid).toMatchObject({ ok: false, errors: { 'target.0.triggerValue': 'Target percentage must be less than 100' } });
	});

	test('serializes every target trigger shape and trailing stop mode', () => {
		const form = validWalletForm();
		form.sellTargets = [
			{ kind: 'MULTIPLE', triggerValue: '2', sellPercent: '25', targetKind: 'TAKE_PROFIT', mode: 'NORMAL' },
			{ kind: 'MULTIPLE', triggerValue: '0.5', sellPercent: '100', targetKind: 'STOP_LOSS', mode: 'TRAILING' },
			{ kind: 'MARKETCAP', triggerValue: '500000', sellPercent: '25', targetKind: 'TAKE_PROFIT', mode: 'NORMAL' },
			{ kind: 'USD', triggerValue: '0.001', sellPercent: '25', targetKind: 'TAKE_PROFIT', mode: 'NORMAL' }
		];
		const result = buildBotConfig(form, 'wallet', true, 'create');
		expect(result).toMatchObject({
			ok: true,
			config: {
				trade: {
					targets: [
						{ kind: 'TAKE_PROFIT', sellPct: 25, trigger: { type: 'MULTIPLIER', multiplier: 2 } },
						{ kind: 'STOP_LOSS', sellPct: 100, trigger: { type: 'MULTIPLIER', multiplier: 0.5 }, mode: 'TRAILING' },
						{ kind: 'TAKE_PROFIT', sellPct: 25, trigger: { type: 'MARKET_CAP_USD', marketCapUsd: 500000 } },
						{ kind: 'TAKE_PROFIT', sellPct: 25, trigger: { type: 'PRICE', priceUsd: 0.001 } }
					]
				}
			}
		});
	});

	test('preserves valid zero source values and rejects invalid precision', () => {
		const form = validWalletForm();
		form.buySizing = 'proportion';
		form.buyProportion = '0';
		form.copySells = true;
		form.sellSizing = 'position_pct';
		form.sellPositionPct = '0';
		const result = buildBotConfig(form, 'wallet', true, 'create');
		expect(result).toMatchObject({
			ok: true,
			config: {
				sourceStrategy: {
					buy: { proportion: 0 },
					sell: { pct: 0 }
				}
			}
		});

		form.sellPositionPct = '0.0001';
		const invalid = buildBotConfig(form, 'wallet', true, 'create');
		expect(invalid).toMatchObject({ ok: false, errors: { sellPositionPct: 'Position percentage supports up to 3 decimal places' } });
	});

	test('rejects empty, non-finite, negative, and over-bound values', () => {
		const form = validWalletForm();
		form.buySizing = 'balance_pct';
		form.buyBalancePct = '101';
		form.copySells = true;
		form.sellProportion = '-1';
		form.buyGasMode = 'CUSTOM';
		form.buyCustomGas = 'Infinity';
		form.sellSlippage = '101';
		const result = buildBotConfig(form, 'wallet', true, 'create');
		expect(result).toMatchObject({
			ok: false,
			errors: {
				buyBalancePct: 'Wallet balance percentage must be at most 100',
				sellProportion: 'Sell proportion must be at least 0',
				buyCustomGas: 'Buy gas must be a finite number',
				sellSlippage: 'Sell slippage must be at most 100'
			}
		});
	});

	test('formats copied sells separately from position targets', () => {
		const summary = summarizeBotConfig('SOL', responseConfig({
			sourceStrategy: { sell: { type: 'SOURCE_TRADE_PROPORTION', proportion: 0 } },
			trade: {
				antiMev: false,
				buyGas: 'AUTO',
				sellGas: 'AUTO',
				buySlippagePct: 'AUTO',
				sellSlippagePct: 'AUTO',
				targets: [{ kind: 'TAKE_PROFIT', sellPct: 50, trigger: { type: 'MULTIPLIER', multiplier: 2 } }]
			}
		}), true);
		expect(summary).toEqual({
			chain: 'SOL',
			buy: '25 USD',
			copySells: '0× source sell',
			copySellCap: true,
			zeroCopySell: true,
			targetCount: 1
		});
	});

	test('omits limits entirely when every field is blank', () => {
		const result = buildBotConfig(validWalletForm(), 'wallet', true, 'create');
		expect(result.ok).toBe(true);
		expect(result).not.toHaveProperty('limits');
	});

	test('summarizes configured limits into display chips', () => {
		expect(summarizeBotLimits(undefined)).toEqual([]);
		expect(summarizeBotLimits(null)).toEqual([]);
		expect(summarizeBotLimits({})).toEqual([]);
		expect(summarizeBotLimits({
			cooldownSecs: 7200,
			maxOpenPositions: 10,
			dailySpendUsd: 50,
			lifetimeSpendUsd: 1500,
			maxExposureUsd: 250.5
		})).toEqual(['Cooldown 2h', 'Max 10 positions', '$50.00/day', '$1.50K total', '$250.50 open max']);
	});

	test('serializes configured limits and round-trips them through hydration', () => {
		const form = validWalletForm();
		form.limitsCooldownSecs = '300';
		form.limitsDailySpendUsd = '50';
		form.limitsLifetimeSpendUsd = '1000';
		form.limitsMaxExposureUsd = '250.5';
		form.limitsMaxOpenPositions = '10';
		const result = buildBotConfig(form, 'wallet', true, 'create');
		expect(result).toMatchObject({
			ok: true,
			limits: {
				cooldownSecs: 300,
				dailySpendUsd: 50,
				lifetimeSpendUsd: 1000,
				maxExposureUsd: 250.5,
				maxOpenPositions: 10
			}
		});

		const hydrated = validWalletForm();
		hydrateBotLimits(hydrated, (result as { ok: true; limits: { cooldownSecs?: number; dailySpendUsd?: number; lifetimeSpendUsd?: number; maxExposureUsd?: number; maxOpenPositions?: number } }).limits);
		expect(hydrated).toMatchObject({
			limitsCooldownSecs: '300',
			limitsDailySpendUsd: '50',
			limitsLifetimeSpendUsd: '1000',
			limitsMaxExposureUsd: '250.5',
			limitsMaxOpenPositions: '10'
		});

		const cleared = validWalletForm();
		hydrateBotLimits(cleared, null);
		expect(cleared).toMatchObject({
			limitsCooldownSecs: '',
			limitsDailySpendUsd: '',
			limitsLifetimeSpendUsd: '',
			limitsMaxExposureUsd: '',
			limitsMaxOpenPositions: ''
		});
	});

	test('rejects out-of-bound and non-integer limit values', () => {
		const form = validWalletForm();
		form.limitsCooldownSecs = '0';
		form.limitsMaxOpenPositions = '2.5';
		form.limitsDailySpendUsd = '-5';
		form.limitsLifetimeSpendUsd = '10.123';
		form.limitsMaxExposureUsd = 'abc';
		expect(buildBotConfig(form, 'wallet', true, 'create')).toMatchObject({
			ok: false,
			errors: {
				limitsCooldownSecs: 'Cooldown must be at least 1',
				limitsMaxOpenPositions: 'Max open positions must be a whole number',
				limitsDailySpendUsd: 'Daily budget must be greater than 0',
				limitsLifetimeSpendUsd: 'Total budget supports up to 2 decimal places',
				limitsMaxExposureUsd: 'Max exposure must be a finite number'
			}
		});

		const overBound = validWalletForm();
		overBound.limitsCooldownSecs = '604801';
		overBound.limitsMaxOpenPositions = '1001';
		expect(buildBotConfig(overBound, 'wallet', true, 'update')).toMatchObject({
			ok: false,
			errors: {
				limitsCooldownSecs: 'Cooldown must be at most 604800',
				limitsMaxOpenPositions: 'Max open positions must be at most 1000'
			}
		});
	});
});
