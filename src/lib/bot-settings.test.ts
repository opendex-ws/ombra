import { describe, expect, test } from 'vitest';
import {
	buildBotConfig,
	createBotConfigForm,
	hydrateBotConfig,
	summarizeBotConfig,
	type BotChainConfig,
	type BotChainConfigDiff,
	type BotChainConfigRequest
} from './utils/bot-settings';

function validWalletForm() {
	return createBotConfigForm('ETH', 'USD');
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
		const form = hydrateBotConfig('ETH', responseConfig({
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
});
