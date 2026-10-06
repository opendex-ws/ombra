import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CreateBotModal from './components/CreateBotModal.svelte';
import type { Bot } from './utils/bot-settings';

const { apiGet, apiPost, fetchManagedWallets, getManagedWalletForChain } = vi.hoisted(() => ({
	apiGet: vi.fn(),
	apiPost: vi.fn(),
	fetchManagedWallets: vi.fn(),
	getManagedWalletForChain: vi.fn()
}));

vi.mock('$lib/api/client', () => ({ api: { GET: apiGet, POST: apiPost } }));
vi.mock('$lib/stores/trade.svelte', () => ({ fetchManagedWallets, getManagedWalletForChain }));
vi.mock('$lib/stores/currency.svelte', () => ({ isUsd: () => true }));
vi.mock('$lib/stores/peg.svelte', () => ({ getPegPrices: () => ({ ETH: '3000', SOL: '150' }) }));

afterEach(cleanup);

beforeEach(() => {
	apiPost.mockReset();
	apiPost.mockResolvedValue({ data: {}, error: undefined });
	apiGet.mockReset();
	apiGet.mockImplementation((path: string) => {
		if (path.endsWith('/schema')) {
			return Promise.resolve({
				data: {
					revision: 1,
					fields: [{ key: 'followers', type: 'number', required: true, filterable: true, integerOnly: true }],
					jsonSchema: {}
				},
				response: { ok: true, status: 200 }
			});
		}
		return Promise.resolve({
			data: {
				sources: [{
					type: 'INTEGRATION', id: 'caller-id', name: 'Caller one', photoId: null,
					integrationId: 'integration-id', integrationName: 'Signals desk', integrationPhotoId: null,
					automation: { hasBot: false, bots: [] }
				}]
			},
			response: { ok: true, status: 200 }
		});
	});
	fetchManagedWallets.mockReset();
	getManagedWalletForChain.mockReset();
	getManagedWalletForChain.mockReturnValue({ address: '0x2222222222222222222222222222222222222222' });
});

function editableWalletBot(): Bot {
	return {
		id: 'bot-id',
		status: 'ACTIVE',
		createdAt: { timestamp: 0, timestampStr: '1970-01-01T00:00:00Z', ageSeconds: 0 },
		source: {
			id: 'wallet-source',
			type: 'WALLET',
			name: 'SOL whale',
			photoId: null,
			chain: 'SOL',
			walletAddress: '0x1111111111111111111111111111111111111111'
		},
		stats: { boughtUsd: 0, soldUsd: 0, profitUsd: 0, feesUsd: 0, wins: 0, losses: 0, trades: 0 },
		chainConfigs: {
			SOL: {
				walletAddress: '0x2222222222222222222222222222222222222222',
				buy: { strategy: { type: 'MARKET' } },
				sourceStrategy: {
					buy: { type: 'SOURCE_TRADE_PROPORTION', proportion: 1.25 },
					sell: { type: 'BOT_POSITION_PERCENT', pct: 25 }
				},
				trade: {
					antiMev: true,
					buyGas: 0,
					sellGas: 0.000012,
					buySlippagePct: 0,
					sellSlippagePct: 12.5,
					targets: [{ kind: 'STOP_LOSS', sellPct: 100, trigger: { type: 'PERCENT', changePct: 50 }, mode: 'NORMAL' }]
				}
			}
		}
	};
}

describe('create bot modal wallet settings', () => {
	test('creates an integration bot with an optional caller and native metadata filter', async () => {
		render(CreateBotModal, {
			props: {
				show: true,
				source: {
					type: 'INTEGRATION',
					integrationId: 'integration-id',
					integrationName: 'Signals desk',
					integrationPhotoId: null,
					integrationEnabled: true,
					metaFilter: [],
					name: 'Signals desk'
				}
			}
		});

		await fireEvent.click(await screen.findByRole('button', { name: /Caller one/ }));
		await fireEvent.input(screen.getByLabelText('Filter value'), { target: { value: '1000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }));

		await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
		expect(apiPost.mock.calls[0][1].body.source).toEqual({
			type: 'INTEGRATION',
			integrationId: 'integration-id',
			callerId: 'caller-id',
			metaFilter: [{ field: 'followers', op: 'eq', value: 1000 }]
		});
	});

	test('locks the wallet chain and submits a valid zero position sell without fallback coercion', async () => {
		render(CreateBotModal, {
			props: {
				show: true,
				source: {
					id: 'wallet-source',
					type: 'WALLET',
					name: 'SOL whale',
					chain: 'SOL'
				}
			}
		});

		expect(screen.getByText('Source chain').parentElement).toHaveTextContent('SOL');

		await fireEvent.click(screen.getByRole('button', { name: 'Toggle copy sells' }));
		await fireEvent.click(screen.getByRole('button', { name: '% Position' }));
		await fireEvent.input(screen.getByPlaceholderText('100'), { target: { value: '0' } });
		expect(screen.getByText(/Zero submits no swap/)).toBeVisible();

		await fireEvent.click(screen.getByRole('button', { name: 'Create Copy Trade Bot' }));
		await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
		expect(apiPost.mock.calls[0][0]).toBe('/v2/bots/create');
		expect(apiPost.mock.calls[0][1].body).toMatchObject({
			source: { id: 'wallet-source', type: 'WALLET' },
			chainConfigs: {
				SOL: {
					sourceStrategy: { sell: { type: 'BOT_POSITION_PERCENT', pct: 0 } }
				}
			}
		});
	});

	test('hydrates and preserves source rules, custom gas, slippage, and targets on edit', async () => {
		const bot = editableWalletBot();
		if (bot.source.type !== 'WALLET') throw new Error('Expected wallet bot source');
		render(CreateBotModal, {
			props: {
				show: true,
				source: { id: bot.source.id, type: 'WALLET', name: bot.source.name, chain: 'SOL' },
				editBot: bot
			}
		});

		const sellGas = screen.getByText('Sell Gas').parentElement!;
		expect(within(sellGas).getByDisplayValue('0.000012')).toBeVisible();
		expect(screen.getByDisplayValue('1.25')).toBeVisible();
		expect(screen.getByDisplayValue('25')).toBeVisible();
		expect(screen.getByDisplayValue('12.5')).toBeVisible();
		// Badge is abbreviated in the compact target card; the click-to-cycle title
		// is what actually names the kind.
		expect(screen.getByTitle('Click to change target type')).toHaveTextContent('SL');

		await fireEvent.click(screen.getByRole('button', { name: 'Update Bot' }));
		await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
		expect(apiPost.mock.calls[0][0]).toBe('/v2/bots/{id}/update');
		expect(apiPost.mock.calls[0][1].body).toMatchObject({
			chainConfigs: {
				SOL: {
					sourceStrategy: {
						buy: { type: 'SOURCE_TRADE_PROPORTION', proportion: 1.25 },
						sell: { type: 'BOT_POSITION_PERCENT', pct: 25 }
					},
					trade: { buyGas: 0, sellGas: 0.000012, buySlippagePct: 0, sellSlippagePct: 12.5 }
				}
			}
		});
	});

	test('keeps backend validation errors visible with the entered settings', async () => {
		apiPost.mockResolvedValueOnce({ data: undefined, error: { message: 'Rejected by backend' } });
		render(CreateBotModal, {
			props: {
				show: true,
				source: { id: 'wallet-source', type: 'WALLET', name: 'SOL whale', chain: 'SOL' }
			}
		});

		const amount = screen.getByPlaceholderText('0.00');
		await fireEvent.input(amount, { target: { value: '42' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create Copy Trade Bot' }));

		expect(await screen.findByText('Rejected by backend')).toBeVisible();
		expect(screen.getByDisplayValue('42')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Create Copy Trade Bot' })).toBeVisible();
	});
});
