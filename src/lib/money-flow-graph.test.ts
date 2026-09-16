import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MoneyFlowGraph from '$lib/components/MoneyFlowGraph.svelte';
import type { FlowSwap } from '$lib/utils/money-flow';

vi.mock('$lib/api/config', () => ({ tokenImage: () => 'https://example.test/t.png' }));

afterEach(cleanup);

const swaps: FlowSwap[] = [
	{ id: 'a', walletAddress: 'W1', chain: 'SOL', token: { address: 'T1', symbol: 'AAA' }, side: 'BUY', amountUsd: 500, timestamp: 2 },
	{ id: 'b', walletAddress: 'W2', chain: 'SOL', token: { address: 'T1', symbol: 'AAA' }, side: 'SELL', amountUsd: 200, timestamp: 3 },
	{ id: 'c', walletAddress: 'W3', chain: 'SOL', token: { address: 'T2', symbol: 'BBB' }, side: 'BUY', amountUsd: 900, timestamp: 4 }
];

function pointer(type: string, x: number, y: number) {
	const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
	Object.assign(e, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0 });
	return e;
}

describe('MoneyFlowGraph', () => {
	it('does not capture the pointer on a click, so the token stays clickable', async () => {
		const selected: unknown[] = [];
		const { container } = render(MoneyFlowGraph, { props: { swaps, onselect: (n: unknown) => selected.push(n) } });
		const svg = container.querySelector('svg')! as SVGSVGElement & { setPointerCapture: unknown };
		let captures = 0;
		svg.setPointerCapture = () => { captures++; };
		svg.releasePointerCapture = () => {};

		// press and release without moving: a plain click
		svg.dispatchEvent(pointer('pointerdown', 20, 20));
		svg.dispatchEvent(pointer('pointerup', 20, 20));
		expect(captures).toBe(0);

		const node = container.querySelector('g.mf-node') as SVGGElement;
		node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(selected).toHaveLength(1);
	});

	it('captures only once a real drag starts', async () => {
		const { container } = render(MoneyFlowGraph, { props: { swaps } });
		const svg = container.querySelector('svg')! as SVGSVGElement & { setPointerCapture: unknown };
		let captures = 0;
		svg.setPointerCapture = () => { captures++; };
		svg.releasePointerCapture = () => {};

		svg.dispatchEvent(pointer('pointerdown', 20, 20));
		svg.dispatchEvent(pointer('pointermove', 22, 21));
		expect(captures).toBe(0);
		svg.dispatchEvent(pointer('pointermove', 90, 60));
		expect(captures).toBe(1);
		svg.dispatchEvent(pointer('pointerup', 90, 60));
	});
});

describe('MoneyFlowGraph drag', () => {
	it('pans without throwing, even when pointer capture is unavailable', async () => {
		const { container } = render(MoneyFlowGraph, { props: { swaps } });
		const svg = container.querySelector('svg')!;
		expect(svg).toBeTruthy();

		const errors: unknown[] = [];
		const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
		window.addEventListener('error', onError);

		svg.dispatchEvent(pointer('pointerdown', 10, 10));
		svg.dispatchEvent(pointer('pointermove', 60, 40));
		svg.dispatchEvent(pointer('pointerup', 60, 40));

		await new Promise((r) => requestAnimationFrame(() => r(null)));
		window.removeEventListener('error', onError);
		expect(errors).toEqual([]);

		const panned = container.querySelector('g[transform^="translate"]');
		expect(panned?.getAttribute('transform')).toBe('translate(50 30) scale(1)');
	});
});
