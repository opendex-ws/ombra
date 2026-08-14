import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';
import TradeExecutionMeta from './components/TradeExecutionMeta.svelte';

afterEach(cleanup);

describe('trade execution metadata', () => {
	test('renders position and builder badges with accessible explanations', () => {
		render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: 37,
					isBuilder: true,
					fees: { mevFeeUsd: 0.42, mevFeeUsdStr: '0.42' }
				}
			}
		});

		expect(screen.getByLabelText('Trade execution metadata')).toBeVisible();
		expect(screen.getByText('37%')).toBeVisible();
		expect(screen.getByLabelText('Transaction position: 37% through block')).toBeVisible();
		expect(screen.getByText('$0.4200')).toBeVisible();
		expect(screen.queryByText(/MEV|Builder/)).not.toBeInTheDocument();
		expect(screen.getByLabelText(/Builder or Jito activity detected/)).toBeVisible();
	});

	test('renders recognized execution attribution without the pair router', () => {
		render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					platformType: 'RAYDIUM',
					executionProgram: {
						id: 'AxiomfHaWDemCFBLBayqnEnNwE6b7B2Qz3UmzMpgbMG6',
						name: 'AXIOM',
						kind: 'INTERFACE'
					}
				}
			}
		});

		expect(screen.getByText('AXIOM')).toBeVisible();
		expect(screen.queryByText('RAY')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Venue: Raydium')).not.toBeInTheDocument();
		expect(screen.getByLabelText('Execution via AXIOM')).toBeVisible();
	});

	test('uses the canonical program ID for the venue asset', () => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					executionProgram: {
						id: 'FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9',
						name: 'Renamed execution venue',
						kind: 'INTERFACE'
					}
				}
			}
		});

		expect(container.querySelector('img')?.getAttribute('src')).toBe('/entity-icons/axiom.webp');
		expect(container.querySelector('img')?.getAttribute('loading')).toBe('eager');
		expect(container.querySelector('img')?.getAttribute('decoding')).toBe('sync');
	});

	test('renders an unbranded execution bot with the local robot asset', () => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					executionProgram: {
						id: 'execQYVfDRoioKs242MQmKVa9FkTm4EEcHkbvt4hdKt',
						name: 'GENERIC BOT',
						kind: 'INTERFACE'
					}
				}
			}
		});

		expect(screen.getByText('GENERIC')).toBeVisible();
		expect(screen.queryByText('GENERIC BOT')).not.toBeInTheDocument();
		expect(container.querySelector('img')?.getAttribute('src')).toBe('/entity-icons/generic-bot.svg');
	});

	test('renders direct execution with its local icon', () => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					executionProgram: {
						id: 'direct-dex-program',
						name: 'DIRECT',
						kind: 'DEX'
					}
				}
			}
		});

		expect(screen.getByText('DIRECT')).toBeVisible();
		expect(container.querySelector('img')?.getAttribute('src')).toBe('/entity-icons/direct.svg');
	});

	test('separates attribution from block and fee details', () => {
		const trade = {
			txPlacePercent: 37,
			isBuilder: true,
			platformType: 'RAYDIUM' as const,
			executionProgram: {
				id: 'AxiomfHaWDemCFBLBayqnEnNwE6b7B2Qz3UmzMpgbMG6',
				name: 'AXIOM',
				kind: 'INTERFACE' as const
			},
			fees: { mevFeeUsd: 0.42, mevFeeUsdStr: '0.42' }
		};
		const attribution = render(TradeExecutionMeta, { props: { trade, section: 'attribution' } });
		expect(screen.getByText('AXIOM')).toBeVisible();
		expect(screen.queryByText('RAY')).not.toBeInTheDocument();
		expect(screen.queryByText('37%')).not.toBeInTheDocument();
		expect(screen.queryByText('$0.4200')).not.toBeInTheDocument();
		attribution.unmount();

		render(TradeExecutionMeta, { props: { trade, section: 'details' } });
		expect(screen.getByText('37%')).toBeVisible();
		expect(screen.getByText('$0.4200')).toBeVisible();
		expect(screen.queryByText('RAY')).not.toBeInTheDocument();
		expect(screen.queryByText('AXIOM')).not.toBeInTheDocument();
	});

	test('hides pair routers and unknown execution programs', () => {
		render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					platformType: 'RAYDIUM'
				}
			}
		});
		expect(screen.queryByLabelText('Trade execution metadata')).not.toBeInTheDocument();

		render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					platformType: 'RAYDIUM',
					executionProgram: { id: 'unknown', name: 'OTHER', kind: 'UNKNOWN' }
				}
			}
		});
		expect(screen.queryByText('OTHER')).not.toBeInTheDocument();
		expect(screen.queryByText('RAY')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Trade execution metadata')).not.toBeInTheDocument();
	});

	test('renders a broader priority or MEV signal without claiming builder attribution', () => {
		render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					fees: { mevFeeUsd: 0.03, mevFeeUsdStr: '0.03' }
				}
			}
		});

		expect(screen.getByText('$0.0300')).toBeVisible();
		expect(screen.queryByText(/MEV/)).not.toBeInTheDocument();
		expect(screen.getByLabelText('Priority or Jito fee: $0.0300')).toBeVisible();
	});

	test('renders nothing when a rolling old publisher omitted both optional fields', () => {
		render(TradeExecutionMeta, { props: { trade: { txPlacePercent: undefined, isBuilder: undefined } } });

		expect(screen.queryByLabelText('Trade execution metadata')).not.toBeInTheDocument();
	});
});
