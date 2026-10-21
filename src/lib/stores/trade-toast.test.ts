import { describe, expect, it } from 'vitest';
import { nextSwapSuccessToast, type SwapToastSlot } from './trade-toast';

const BOUGHT = 'Bought 285.54 IGNITION for 0.0000 ETH ($0.10)';
const SWAP_ID = 408034;

function play(events: Array<{ kind: 'SWAP_FINALIZED' | 'SWAP_CONFIRMED'; message: string }>) {
	const book = new Map<number, SwapToastSlot>();
	const ops: string[] = [];
	let nextId = 1;
	for (const event of events) {
		const step = nextSwapSuccessToast(book.get(SWAP_ID), event.message);
		if (step.op === 'add') {
			ops.push('add');
			book.set(SWAP_ID, { toastId: nextId++, message: step.message });
		} else {
			ops.push('update');
			book.set(SWAP_ID, { toastId: step.toastId, message: step.message });
		}
	}
	return { ops, message: book.get(SWAP_ID)?.message };
}

describe('one success toast per swap id', () => {
	it('FINALIZED then CONFIRMED with the same Bought line adds once then updates', () => {
		const result = play([
			{ kind: 'SWAP_FINALIZED', message: BOUGHT },
			{ kind: 'SWAP_CONFIRMED', message: BOUGHT }
		]);
		expect(result.ops).toEqual(['add', 'update']);
		expect(result.message).toBe(BOUGHT);
	});

	it('CONFIRMED Buy confirmed then FINALIZED Bought stores the Bought line', () => {
		const result = play([
			{ kind: 'SWAP_CONFIRMED', message: 'Buy confirmed' },
			{ kind: 'SWAP_FINALIZED', message: BOUGHT }
		]);
		expect(result.message).toBe(BOUGHT);
	});

	it('FINALIZED Bought then CONFIRMED Buy confirmed keeps the Bought line', () => {
		const result = play([
			{ kind: 'SWAP_FINALIZED', message: BOUGHT },
			{ kind: 'SWAP_CONFIRMED', message: 'Buy confirmed' }
		]);
		expect(result.message).toBe(BOUGHT);
	});
});
