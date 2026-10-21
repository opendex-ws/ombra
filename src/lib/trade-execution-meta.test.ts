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

	test('renders FOMO app attribution with the double-eyes mark', () => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					executionProgram: {
						id: 'AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51',
						name: 'FOMO',
						kind: 'INTERFACE'
					}
				}
			}
		});
		expect(screen.getByText('FOMO')).toBeVisible();
		expect(container.querySelector('[data-funding-icon="fomo"] svg')).toBeTruthy();
		expect(container.querySelector('img')).toBeNull();
	});

	test('renders PumpFun app attribution from the program and co-signer', () => {
		for (const id of [
			'6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB',
			'FHpcNSe6tb2n15bAdq4BkeYWGyZKFD7yLYrH92ng7wCT'
		]) {
			const { container, unmount } = render(TradeExecutionMeta, {
				props: {
					trade: {
						executionProgram: { id, name: 'PUMPFUN', kind: 'INTERFACE' }
					}
				}
			});
			expect(screen.getByText('PUMPFUN')).toBeVisible();
			expect(container.querySelector('img')?.getAttribute('src')).toBe(
				'/entity-icons/pumpfun.webp'
			);
			unmount();
		}
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

		render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					executionProgram: {
						id: '0x65050A9b7E5075A2bA5cED7b1b64EE66262c40Dc',
						name: 'OTHER',
						kind: 'UNKNOWN'
					}
				}
			}
		});
		expect(screen.getByText('GMGN')).toBeVisible();
	});

	test('labels confirmed Robinhood Uniswap routers when the API still says OTHER', () => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					executionProgram: {
						id: '0x204FAca1764B154221e35c0d20aBb3c525710498',
						name: 'OTHER',
						kind: 'UNKNOWN'
					}
				}
			}
		});

		expect(screen.getByText('UNISWAP')).toBeVisible();
		expect(screen.getByLabelText('Execution via UNISWAP')).toBeVisible();
		expect(container.querySelector('img')?.getAttribute('src')).toBe('/entity-icons/uniswap.svg');
		expect(screen.queryByText('OTHER')).not.toBeInTheDocument();
	});

	test('names the Robinhood ERC-4337 entry point', () => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					executionProgram: {
						id: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
						name: 'OTHER',
						kind: 'UNKNOWN'
					}
				}
			}
		});

		expect(screen.getByText('ENTRYPOINT')).toBeVisible();
		expect(container.querySelector('img')?.getAttribute('src')).toBe('/entity-icons/entrypoint.svg');
		expect(screen.queryByText('OTHER')).not.toBeInTheDocument();
	});

	test.each([
		['0xb300000b72DEAEb607a12d5f54773D1C19c7028d', 'BINANCE', '/entity-icons/binance.webp'],
		['0xCcC88a9d1B4ED6b0EABA998850414b24f1c315bE', 'RELAY', '/entity-icons/relay.webp'],
		['0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', 'KYBER', '/entity-icons/kyber.webp'],
		['0x0000000000001fF3684f28c67538d4D072C22734', '0x', '/entity-icons/zerox.svg'],
		['0x6A000F20005980200259B80c5102003040001068', 'VELORA', '/entity-icons/velora.svg'],
		['0x07964f135f276412b3182a3B2407b8dd45000000', 'TRANSIT', '/entity-icons/transit.webp'],
		['0x69460570c93f9DE5E2edbC3052bf10125f0Ca22d', 'RANGO', '/entity-icons/rango.webp'],
		['0x5A705DE8982235a7fa45bB83dCaCf03a211389C7', '1INCH', '/entity-icons/1inch.svg'],
		['0x5399d94D2CaB7C252a6034042E1917A0E5E17a18', 'INTENT', '/entity-icons/intent.svg'],
		['0x25681C0eCD4E3107f2eCEbfE667E9AdBc3DC77ba', 'WRAPPER', '/entity-icons/wrapper.svg'],
		['0xB33D122f3B13DFf688c429614228d5EE2A41C341', 'WRAPPER', '/entity-icons/wrapper.svg'],
		['0x055dE4ce27753AAB185EB4387851Ea12B00Bb341', 'UNI V4', '/entity-icons/uni-v4.svg'],
		['0x543282f890f93E6961a6d3CBCd9e003cC88dcb3C', 'UNI V4', '/entity-icons/uni-v4.svg'],
		['0xe394bA9Ff1B3d7337E01f89537A5C4980AF1e439', 'UNI V4', '/entity-icons/uni-v4.svg'],
		['0x7680eCC68eC6dBc017B6de97B481C64724be101b', 'UNI MIX', '/entity-icons/uni-mix.svg'],
		['0xFe39a07Ae25861539BA9ac2EE176D62a66d935Cf', 'UNI MIX', '/entity-icons/uni-mix.svg'],
		['0xd8e14Fa29bb6A05637eD98cfdFbFb1A9Da9Df229', 'UNI V3', '/entity-icons/uni-v3.svg'],
		['0x520ed467860d840eC6Ca20F1Dacb9c0Fa5168AA7', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0x47AfF0BDa5713de49519f9347CcE9c0B8cD8f5A0', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0xa8f012FaAc1c999fa6EE47E4b00C1eEa62D35ecB', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0x103b52a624dE94BDF0B9739aE5B5971ff1071809', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0x7A27535b4A7eCAafBCC0074b24a09be00F30583C', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0x7dEc8663bC55f3419a130FaC7A7209b959eD8d90', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0xFE2d8976F600879ab2d886d6470AE6f9b9b07405', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0x3E20E4B668772acB0245e15e8393CA29cDCbF831', 'UNI POOL', '/entity-icons/uni-pool.svg'],
		['0xD26C8cFce843F4122753425dD6613D7576777eC8', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0x7FeB3eCbacBd0Cc23Ec46659d541636D58749A97', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0x80e49eD118b932d9538ec817eF8b29fbAc31e080', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0xa28F468CB898CC407c981e26a521DFb2e2774174', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0x80114879f80d156C8003676557324c518BAbD194', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0x8C7b36c84D7Ddf623DdC126f2A7019B1581A8De5', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0xf533B2c4BaC658b02b1e20afc588041d8c0ae500', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0xd298Bd39421eec1d0Dc430A8965d38ba56ec037f', 'UNI ROUTER', '/entity-icons/uni-router.svg'],
		['0xDa753f6c941A7dA5b1B1BBf50fA74FC4D554A81b', 'UNIWALL', '/entity-icons/uniwall.svg'],
		['0xe492912F37C2A4eCa45D42DC67548F4C6Cd7ce2B', 'ROUTE', '/entity-icons/rh-route.svg'],
		['0x4262efBd176F02824af27010bEa218429c33c7E8', 'SWAPSHELL', '/entity-icons/swapshell.svg'],
		['0x278d858f05b94576C1E6f73285886876ff6eF8D2', 'FWD', '/entity-icons/rh-fwd.svg'],
		['0xD6D35B56237a05aFd4Cd7e441226fefC3f78c4E6', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0x75379D5D2eA4C98aeAa57F32E233707550aB03F0', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0x9d13Ec5dD8094bfce573FaCE1D6dB5df6805A345', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0x1cbaF24D53fe930fCe8EFF149fA797D2611Da149', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0x04E974D2De1c12414068Faf6768D18574CEB5bb5', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0x582080752F92041686e6DB162387bda4A8B22B90', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0xF5307745c61DE69bF033EDfE6A8771256275a323', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0xc33AcC93942105c57602e59E8E448C20ba718a85', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0x39b37fE004B9bCDa781784345d2fFc84ef4B8cE6', 'ROUTER', '/entity-icons/rh-router.svg'],
		['0x673F40eDFA3f4692Cf0ad141b020F17F6A0EcB5B', 'OMBRA', '/entity-icons/ombra.webp'],
		['0x2550441874098B3d6C7D588D5345D9047976e7Ef', 'OMBRA', '/entity-icons/ombra.webp']
	])('labels %s as %s with its official icon when the API says OTHER', (id, name, src) => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					executionProgram: { id, name: 'OTHER', kind: 'UNKNOWN' }
				}
			}
		});

		expect(screen.getByText(name)).toBeVisible();
		expect(container.querySelector('img')?.getAttribute('src')).toBe(src);
		expect(screen.queryByText('OTHER')).not.toBeInTheDocument();
	});

	test('names the Robinhood ERC-4337 entry point v0.6', () => {
		const { container } = render(TradeExecutionMeta, {
			props: {
				trade: {
					txPlacePercent: undefined,
					isBuilder: false,
					executionProgram: {
						id: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
						name: 'OTHER',
						kind: 'UNKNOWN'
					}
				}
			}
		});

		expect(screen.getByText('ENTRYPOINT')).toBeVisible();
		expect(container.querySelector('img')?.getAttribute('src')).toBe('/entity-icons/entrypoint.svg');
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
