import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';
import TradeFeeAmount from './components/TradeFeeAmount.svelte';

afterEach(cleanup);

describe('trade fee amount', () => {
	test('overlays a compact MEV subline without changing layout flow', () => {
		const view = render(TradeFeeAmount, {
			props: {
				fees: { gas: 0.01, mev: 0.03, platform: 0, creator: 0, cashback: 0, total: 0.04, net: 0.04 },
				showMev: true
			}
		});

		expect(screen.getByLabelText('Total fee $0.0400')).toBeVisible();
		expect(view.container.querySelector('[data-mev-fee]')).toHaveTextContent('MEV $0.0300');
		expect(view.container.querySelector('[data-mev-fee]')).toHaveClass('absolute');
	});

	test('keeps priority fees in total without claiming MEV', () => {
		const view = render(TradeFeeAmount, {
			props: {
				fees: { gas: 0.01, mev: 0.03, platform: 0, creator: 0, cashback: 0, total: 0.04, net: 0.04 }
			}
		});

		expect(screen.getByLabelText('Total fee $0.0400')).toBeVisible();
		expect(view.container.querySelector('[data-mev-fee]')).toBeNull();
		expect(screen.getByText('Priority/Jito')).toBeInTheDocument();
	});

	test('renders gross total and negative net when cashback exceeds fees', () => {
		render(TradeFeeAmount, {
			props: {
				fees: { gas: 0.01, mev: 0, platform: 0.02, creator: 0, cashback: 0.05, total: 0.03, net: -0.02 }
			}
		});

		expect(screen.getByLabelText('Total fee $0.0300')).toBeVisible();
		expect(screen.getByText('Gross total')).toBeInTheDocument();
		expect(screen.getByText('Net')).toBeInTheDocument();
		expect(screen.getByText('$-0.02')).toBeInTheDocument();
	});
});
