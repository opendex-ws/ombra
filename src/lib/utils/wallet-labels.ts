import type { WalletLabelSummary } from '$lib/api/types';

/**
 * `/v2/wallets/labels` returns one row per label *per source*, so a label
 * carried on both KOL and PUMPFUN arrives twice. The typeahead filters by label
 * string alone, so those rows are interchangeable — collapse them, or the
 * dropdown throws `each_key_duplicate` on its `(sug.label)` key.
 *
 * Counts sum across sources. The source mark is kept only when every row agrees
 * on it, so a merged multi-source label is not mislabelled as one platform.
 */
export function mergeLabelSuggestions(labels: WalletLabelSummary[]): WalletLabelSummary[] {
	const byLabel = new Map<string, WalletLabelSummary>();
	const conflicted = new Set<string>();

	for (const entry of labels) {
		if (!entry?.label) continue;
		const existing = byLabel.get(entry.label);
		if (!existing) {
			byLabel.set(entry.label, { ...entry });
			continue;
		}
		existing.walletCount += entry.walletCount ?? 0;
		existing.photoId ??= entry.photoId;
		if (existing.source !== entry.source) conflicted.add(entry.label);
	}

	for (const label of conflicted) {
		const merged = byLabel.get(label);
		if (merged) merged.source = null;
	}

	return [...byLabel.values()];
}
