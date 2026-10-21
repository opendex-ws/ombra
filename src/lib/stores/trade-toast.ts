export type SwapToastSlot = {
	toastId: number;
	message: string;
};

export type SwapToastStep =
	| { op: 'add'; message: string }
	| { op: 'update'; toastId: number; message: string };

function isFilledSwapLine(message: string): boolean {
	return message.startsWith('Bought') || message.startsWith('Sold');
}

function isConfirmPlaceholder(message: string): boolean {
	return message === 'Buy confirmed' || message === 'Sell confirmed';
}

/**
 * Message to store for this success event. A later "Buy confirmed" or
 * "Sell confirmed" does not replace a line that already reports the fill.
 * An earlier placeholder still upgrades to the Bought or Sold line.
 */
export function swapToastMessage(current: string | undefined, incoming: string): string {
	if (current && isFilledSwapLine(current) && isConfirmPlaceholder(incoming)) return current;
	return incoming;
}

/**
 * One swap id has one success toast. The first event adds it. A later
 * SWAP_FINALIZED or SWAP_CONFIRMED updates that same toast.
 */
export function nextSwapSuccessToast(
	existing: SwapToastSlot | undefined,
	incoming: string
): SwapToastStep {
	const message = swapToastMessage(existing?.message, incoming);
	if (!existing) return { op: 'add', message };
	return { op: 'update', toastId: existing.toastId, message };
}
