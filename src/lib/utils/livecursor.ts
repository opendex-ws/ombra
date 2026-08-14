export type CursorTriplet = {
	cursor?: string | null;
	prevCursor?: string | null;
	nextCursor?: string | null;
};

export type LiveCursorParams = {
	endCursor: string;
};

export type FixedCursorParams = {
	startCursor: string;
	endCursor: string;
};

export function liveAccumulatedParams(page: CursorTriplet | undefined | null): LiveCursorParams | undefined {
	return page?.cursor ? { endCursor: page.cursor } : undefined;
}

export function fixedExactParams(first: CursorTriplet, last: CursorTriplet): FixedCursorParams | undefined {
	if (!first.cursor || !last.cursor) return undefined;
	return { startCursor: first.cursor, endCursor: last.cursor };
}

export function fixedExpandedParams(first: CursorTriplet, last: CursorTriplet): FixedCursorParams | undefined {
	const startCursor = first.prevCursor ?? first.cursor;
	const endCursor = last.nextCursor ?? last.cursor;
	if (!startCursor || !endCursor) return undefined;
	return { startCursor, endCursor };
}
