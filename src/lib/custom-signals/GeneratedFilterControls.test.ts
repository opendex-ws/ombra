import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomSignalFieldDefinition } from './contracts';
import GeneratedFilterControls from './GeneratedFilterControls.svelte';

afterEach(cleanup);

const fields: CustomSignalFieldDefinition[] = [
	{ key: 'followers', type: 'number', required: true, filterable: true, integerOnly: true, min: '1', max: '5000' },
	{ key: 'supply', type: 'number', required: true, filterable: true, integerOnly: true, min: '1', max: '99999999999999999999' },
	{ key: 'tags', type: 'list', required: false, filterable: true, itemType: 'string' }
];

describe('generated custom signal filter controls', () => {
	it('uses raw keys and derives only approved operators', async () => {
		render(GeneratedFilterControls, { props: { fields, revision: 1 } });
		const field = screen.getByLabelText('Field');
		expect(within(field).getByRole('option', { name: 'followers' })).toBeInTheDocument();
		expect(within(field).getByRole('option', { name: 'tags' })).toBeInTheDocument();
		const condition = screen.getByLabelText('Condition');
		await waitFor(() => expect(within(condition).getByRole('option', { name: 'equals' })).toBeInTheDocument());
		expect(within(condition).queryByRole('option', { name: 'presence' })).toBeNull();

		await fireEvent.change(field, { target: { value: 'tags' } });
		expect(within(condition).getByRole('option', { name: 'item count equals' })).toBeInTheDocument();
		expect(within(condition).getByRole('option', { name: 'presence' })).toBeInTheDocument();
	});

	it('adds a validated ordinary JSON number predicate', async () => {
		const onchange = vi.fn();
		render(GeneratedFilterControls, { props: { fields, revision: 1, onchange } });
		await waitFor(() => expect(screen.getByLabelText('Field')).toHaveValue('followers'));
		await fireEvent.input(screen.getByLabelText('Filter value'), { target: { value: '1000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
		await waitFor(() => expect(onchange).toHaveBeenCalledWith([
			{ field: 'followers', op: 'eq', value: 1000 }
		]));
		expect(screen.getByText('followers equals 1000')).toBeVisible();
	});

	it('preserves an integer beyond JavaScript safe precision as an exact JSON number', async () => {
		const onchange = vi.fn();
		render(GeneratedFilterControls, { props: { fields, revision: 1, onchange } });
		await fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'supply' } });
		await fireEvent.input(screen.getByLabelText('Filter value'), { target: { value: '9007199254740993' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(JSON.stringify(onchange.mock.calls.at(-1)?.[0])).toBe('[{"field":"supply","op":"eq","value":9007199254740993}]');
		expect(screen.getByText('supply equals 9007199254740993')).toBeVisible();
	});

	it('shows constraint errors instead of creating invalid predicates', async () => {
		const onchange = vi.fn();
		render(GeneratedFilterControls, { props: { fields, revision: 1, onchange } });
		await waitFor(() => expect(screen.getByLabelText('Field')).toHaveValue('followers'));
		await fireEvent.input(screen.getByLabelText('Filter value'), { target: { value: '0' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
		expect(screen.getByRole('alert')).toHaveTextContent('cannot be less than 1');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('keeps removed-field predicates as removable read-only legacy rows', async () => {
		const onchange = vi.fn();
		const existing = [{ field: 'followers', op: 'gte', value: 1000 }] as const;
		const view = render(GeneratedFilterControls, {
			props: { fields, revision: 1, value: [...existing], onchange }
		});
		await view.rerender({
			fields: fields.filter((field) => field.key !== 'followers'),
			revision: 2,
			historicalFields: [{ key: 'followers', type: 'number', everOptional: false }],
			value: [...existing],
			onchange
		});
		await waitFor(() => expect(screen.getByText('Legacy')).toBeVisible());
		expect(screen.getByText('followers at least 1000')).toBeVisible();
		expect(within(screen.getByLabelText('Field')).queryByRole('option', { name: 'followers' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove followers filter' }));
		expect(onchange).toHaveBeenLastCalledWith([]);
	});

	it('does not emit a new predicate that contradicts a legacy predicate', async () => {
		const onchange = vi.fn();
		render(GeneratedFilterControls, {
			props: {
				fields: [{ key: 'followers', type: 'number', required: true, filterable: true, integerOnly: true }],
				revision: 2,
				historicalFields: [{ key: 'followers', type: 'number', everOptional: true }],
				value: [{ field: 'followers', op: 'exists', value: false }],
				onchange
			}
		});
		await waitFor(() => expect(screen.getByText('Legacy')).toBeVisible());
		await fireEvent.input(screen.getByLabelText('Filter value'), { target: { value: '1' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
		expect(screen.getByRole('alert')).toHaveTextContent('Contradictory predicates');
		expect(onchange).not.toHaveBeenCalled();
	});
});
