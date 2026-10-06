import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScannerCustomSignalFilters from './components/ScannerCustomSignalFilters.svelte';
import IntegrationSourceControls from './components/IntegrationSourceControls.svelte';
import { CustomSignalSchemaCache } from './custom-signals/schema-cache';
import { createScannerIntegrationClause } from './scanner-custom-signals';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('$lib/api/client', () => ({ api: { GET: apiGet } }));

const INTEGRATION_A = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_B = '22222222-2222-4222-8222-222222222222';
const CALLER_A = '33333333-3333-4333-8333-333333333333';
const CALLER_B = '44444444-4444-4444-8444-444444444444';

afterEach(cleanup);

beforeEach(() => {
	apiGet.mockReset();
	apiGet.mockImplementation((path: string) => {
		if (path === '/v2/watchlist/integrations') {
			return Promise.resolve({
				data: {
					enabled: true,
					integrations: [
						{ id: INTEGRATION_A, name: 'Desk A', photoId: null, enabled: true },
						{ id: INTEGRATION_B, name: 'Desk B', photoId: null, enabled: true }
					]
				},
				response: { ok: true, status: 200 }
			});
		}
		if (path.endsWith('/schema')) {
			return Promise.resolve({
				data: {
					revision: 4,
					fields: [{ key: 'followers', type: 'number', required: false, filterable: true, integerOnly: true }],
					jsonSchema: {}
				},
				response: { ok: true, status: 200 }
			});
		}
		return Promise.resolve({
			data: {
				sources: [{
					type: 'INTEGRATION', id: CALLER_A, name: 'Research caller', photoId: null,
					integrationId: INTEGRATION_A, integrationName: 'Desk A', integrationPhotoId: null,
					automation: { hasBot: false, bots: [] }
				}]
			},
			response: { ok: true, status: 200 }
		});
	});
});

describe('scanner Custom Signal controls', () => {
	it('loads discovery, callers, and the active schema before it edits a clause', async () => {
		const onchange = vi.fn();
		render(ScannerCustomSignalFilters, {
			props: {
				clauses: [createScannerIntegrationClause({ id: INTEGRATION_A, name: 'Desk A', photoId: null })],
				onchange
			}
		});

		expect(await screen.findByRole('option', { name: 'Desk B' })).toBeVisible();
		const callerButton = await screen.findByRole('button', { name: /Research caller/ });
		expect(callerButton).toBeVisible();
		expect(callerButton.parentElement?.className.split(' ')).toContain('md:max-h-36');
		expect(callerButton.parentElement?.className.split(' ')).not.toContain('max-h-36');
		expect(callerButton.parentElement?.className.split(' ')).not.toContain('overflow-y-auto');
		expect(await screen.findByText('followers')).toBeVisible();
		expect(apiGet.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
			'/v2/watchlist/integrations',
			'/v2/watchlist/integrations/{integrationId}/schema',
			'/v2/watchlist/sources/integrations/{integrationId}'
		]));
		expect(onchange).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: /Research caller/ }));
		await waitFor(() => expect(onchange.mock.calls.some(([clauses]) => clauses[0]?.callerIds?.[0] === CALLER_A)).toBe(true));
	});

	it('adds a runtime-discovered integration and explains flat OR behavior', async () => {
		const onchange = vi.fn();
		render(ScannerCustomSignalFilters, { props: { clauses: [], onchange } });

		expect(await screen.findByText(/any integration clause matches/i)).toBeVisible();
		const addButton = screen.getByRole('button', { name: 'Add integration' });
		await waitFor(() => expect(addButton).toBeEnabled());
		await fireEvent.click(addButton);
		expect(onchange).toHaveBeenCalledWith([
			expect.objectContaining({ integrationId: INTEGRATION_A, callerIds: [], metaFilter: [] })
		]);
	});

	it('clears an obsolete load-more state when the selected integration changes', async () => {
		let resolveOldPage: ((value: unknown) => void) | undefined;
		const oldPage = new Promise((resolve) => { resolveOldPage = resolve; });
		apiGet.mockImplementation((path: string, options?: { params?: { path?: { integrationId?: string }; query?: { cursor?: string } } }) => {
			if (!path.includes('/sources/integrations/')) throw new Error(`Unexpected request: ${path}`);
			const integrationId = options?.params?.path?.integrationId;
			if (options?.params?.query?.cursor) return oldPage;
			const caller = integrationId === INTEGRATION_A
				? { id: CALLER_A, name: 'Caller A' }
				: { id: CALLER_B, name: 'Caller B' };
			return Promise.resolve({
				data: {
					sources: [{
						type: 'INTEGRATION', ...caller, photoId: null,
						integrationId, integrationName: integrationId === INTEGRATION_A ? 'Desk A' : 'Desk B',
						integrationPhotoId: null, automation: { hasBot: false, bots: [] }
					}],
					nextCursor: integrationId === INTEGRATION_A ? 'a-next' : 'b-next'
				},
				response: { ok: true, status: 200 }
			});
		});
		const integrations = [
			{ id: INTEGRATION_A, name: 'Desk A', photoId: null, enabled: true },
			{ id: INTEGRATION_B, name: 'Desk B', photoId: null, enabled: true }
		];
		const schemaCache = new CustomSignalSchemaCache(async () => ({ revision: 1, fields: [], jsonSchema: {} }));
		const callbacks = {
			onintegrationchange: vi.fn(),
			oncalleridschange: vi.fn(),
			onfilterchange: vi.fn()
		};
		const view = render(IntegrationSourceControls, {
			props: {
				integrations,
				integrationId: INTEGRATION_A,
				callerIds: [],
				metaFilter: [],
				schemaCache,
				...callbacks
			}
		});

		await fireEvent.click(await screen.findByRole('button', { name: 'Load more callers' }));
		expect(await screen.findByRole('button', { name: 'Loading…' })).toBeDisabled();
		await view.rerender({
			integrations,
			integrationId: INTEGRATION_B,
			callerIds: [],
			metaFilter: [],
			schemaCache,
			...callbacks
		});

		expect(await screen.findByRole('button', { name: /Caller B/ })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Load more callers' })).toBeEnabled();
		resolveOldPage?.({ data: { sources: [] }, response: { ok: true, status: 200 } });
	});
});
