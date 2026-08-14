import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';
import BotConfigSummary from './components/BotConfigSummary.svelte';
import type { Bot } from './utils/bot-settings';

afterEach(cleanup);

function walletBot(): Bot {
	return {
		id: 'bot-id',
		status: 'ACTIVE',
		createdAt: { timestamp: 0, timestampStr: '1970-01-01T00:00:00Z', ageSeconds: 0 },
		source: {
			id: 'source-id',
			type: 'WALLET',
			name: 'Tracked wallet',
			photoId: null,
			chain: 'ETH',
			walletAddress: '0x1111111111111111111111111111111111111111'
		},
		stats: { boughtUsd: 0, soldUsd: 0, profitUsd: 0, feesUsd: 0, wins: 0, losses: 0, trades: 0 },
		chainConfigs: {
			ETH: {
				walletAddress: '0x2222222222222222222222222222222222222222',
				buy: { strategy: { type: 'MARKET' } },
				sourceStrategy: {
					buy: { type: 'SOURCE_TRADE_PROPORTION', proportion: 1.25 },
					sell: { type: 'BOT_POSITION_PERCENT', pct: 0 }
				},
				trade: {
					antiMev: false,
					buyGas: 'AUTO',
					sellGas: 'AUTO',
					buySlippagePct: 'AUTO',
					sellSlippagePct: 'AUTO',
					targets: [
						{ kind: 'TAKE_PROFIT', sellPct: 50, trigger: { type: 'MULTIPLIER', multiplier: 2 } },
						{ kind: 'STOP_LOSS', sellPct: 100, trigger: { type: 'PERCENT', changePct: 50 }, mode: 'NORMAL' }
					]
				}
			}
		}
	};
}

describe('bot configuration summary', () => {
	test('shows wallet buy sizing, copied sells, zero behavior, and independent targets', () => {
		render(BotConfigSummary, { props: { bot: walletBot() } });
		expect(screen.getByText('ETH')).toBeVisible();
		expect(screen.getByText('1.25× source buy')).toBeVisible();
		expect(screen.getByText('0% remaining position')).toBeVisible();
		expect(screen.getByText(/No swap; copy-sell tracking ends/)).toBeVisible();
		expect(screen.getByText('2 configured')).toBeVisible();
		expect(screen.getByText('Independent from copied sells')).toBeVisible();
	});

	test('shows disabled copied sells for wallet bots', () => {
		const bot = walletBot();
		delete bot.chainConfigs.ETH.sourceStrategy;
		render(BotConfigSummary, { props: { bot } });
		expect(screen.getByText('Disabled')).toBeVisible();
	});

	test('shows the remaining-position cap for proportional copied sells', () => {
		const bot = walletBot();
		bot.chainConfigs.ETH.sourceStrategy = {
			sell: { type: 'SOURCE_TRADE_PROPORTION', proportion: 0.5 }
		};
		render(BotConfigSummary, { props: { bot } });
		expect(screen.getByText('0.5× source sell')).toBeVisible();
		expect(screen.getByText('Capped by the remaining position')).toBeVisible();
	});

	test('omits copied-sell language for non-wallet bots', () => {
		const bot = walletBot();
		bot.source = { id: 'source-id', type: 'CALLER', name: 'Caller', photoId: null };
		render(BotConfigSummary, { props: { bot } });
		expect(screen.queryByText('Copied sells')).not.toBeInTheDocument();
		expect(screen.getByText('2 configured')).toBeVisible();
	});
});
