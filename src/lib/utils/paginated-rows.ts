export function mergeUniqueById<T extends { id: string | number }>(
	current: T[],
	incoming: T[]
): T[] {
	const rows = new Map(current.map((row) => [row.id, row]));
	for (const row of incoming) rows.set(row.id, row);
	return [...rows.values()];
}

export function unseenCursor(
	nextCursor: string | null | undefined,
	seen: ReadonlySet<string>
): string | undefined {
	return nextCursor && !seen.has(nextCursor) ? nextCursor : undefined;
}

export function totalAtLeastLoaded(total: number | null | undefined, loadedCount: number): number {
	return Math.max(total ?? 0, loadedCount);
}
