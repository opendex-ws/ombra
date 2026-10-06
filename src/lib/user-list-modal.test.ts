import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserListModal from './components/UserListModal.svelte';

const { apiDelete, apiGet, apiPost, apiPut } = vi.hoisted(() => ({
	apiDelete: vi.fn(),
	apiGet: vi.fn(),
	apiPost: vi.fn(),
	apiPut: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
	api: { DELETE: apiDelete, GET: apiGet, POST: apiPost, PUT: apiPut }
}));

afterEach(cleanup);

beforeEach(() => {
	apiDelete.mockReset();
	apiGet.mockReset();
	apiPost.mockReset();
	apiPut.mockReset();
	apiGet.mockResolvedValue({
		data: { enabled: false, integrations: [] },
		response: { ok: true, status: 200 }
	});
});

describe('saved-list errors', () => {
	it('keeps a create draft open when openapi-fetch returns an error', async () => {
		apiPost.mockResolvedValue({ error: { message: 'Invalid integration source' } });
		const onsaved = vi.fn();
		render(UserListModal, { props: { show: true, onsaved } });

		await fireEvent.input(screen.getByLabelText('List Name'), { target: { value: 'My signals' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create List' }));

		expect(await screen.findByRole('alert')).toHaveTextContent('Invalid integration source');
		expect(screen.getByDisplayValue('My signals')).toBeVisible();
		expect(screen.getByRole('heading', { name: 'Create User List' })).toBeVisible();
		expect(onsaved).not.toHaveBeenCalled();
	});

	it('keeps an update draft open when openapi-fetch returns an error', async () => {
		apiPut.mockResolvedValue({ error: { message: 'Caller does not belong to integration' } });
		const onsaved = vi.fn();
		render(UserListModal, {
			props: {
				show: true,
				onsaved,
				editList: {
					type: 'LIST',
					id: 'list-id',
					name: 'Stored list',
					photoId: null,
					automation: { hasBot: false, bots: [] },
					sourceDetails: { tokenFilter: {}, sources: null }
				} as never
			}
		});

		await fireEvent.input(await screen.findByLabelText('List Name'), { target: { value: 'Edited list' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Update List' }));

		await waitFor(() => expect(apiPut).toHaveBeenCalledOnce());
		expect(await screen.findByRole('alert')).toHaveTextContent('Caller does not belong to integration');
		expect(screen.getByDisplayValue('Edited list')).toBeVisible();
		expect(screen.getByRole('heading', { name: 'Edit User List' })).toBeVisible();
		expect(onsaved).not.toHaveBeenCalled();
	});

	it('shows a selected caller identity that is not in the first catalog page', async () => {
		apiGet.mockImplementation((path: string) => {
			if (path.endsWith('/schema')) {
				return Promise.resolve({
					data: { revision: 1, fields: [], jsonSchema: {} },
					response: { ok: true, status: 200 }
				});
			}
			if (path.includes('/sources/integrations/')) {
				return Promise.resolve({
					data: {
						sources: [{
							type: 'INTEGRATION', id: 'other-caller', name: 'Other caller', photoId: null,
							integrationId: 'integration-id', integrationName: 'Signals desk', integrationPhotoId: null,
							automation: { hasBot: false, bots: [] }
						}]
					},
					response: { ok: true, status: 200 }
				});
			}
			return Promise.resolve({
				data: {
					enabled: true,
					integrations: [{ id: 'integration-id', name: 'Signals desk', photoId: null, enabled: true }]
				},
				response: { ok: true, status: 200 }
			});
		});
		render(UserListModal, {
			props: {
				show: true,
				editList: {
					type: 'LIST', id: 'list-id', name: 'Stored list', photoId: null,
					automation: { hasBot: false, bots: [] },
					sourceDetails: {
						tokenFilter: {},
						sources: {
							integrations: [{
								integration: { id: 'integration-id', name: 'Signals desk', photoId: null },
								callers: [{ id: 'selected-caller', name: 'Selected caller', photoId: 'caller.webp' }],
								metaFilter: []
							}]
						}
					}
				} as never
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
		const removeCaller = await screen.findByRole('button', { name: 'Remove Selected caller' });
		expect(within(removeCaller.parentElement!).getByText('Selected caller')).toBeVisible();
		expect(removeCaller).toBeVisible();
	});
});
