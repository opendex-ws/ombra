import { describe, expect, it } from 'vitest';
import type { WalletLabelSummary } from '$lib/api/types';
import { mergeLabelSuggestions } from '$lib/utils/wallet-labels';
import { dedupeSourceItems } from '$lib/utils/list-sources';

const label = (over: Partial<WalletLabelSummary>): WalletLabelSummary => ({
	label: 'jack',
	photoId: null,
	source: 'KOL',
	walletCount: 1,
	...over
});

describe('mergeLabelSuggestions', () => {
	it('collapses a label carried on more than one source', () => {
		const out = mergeLabelSuggestions([
			label({ source: 'KOL', walletCount: 3 }),
			label({ source: 'PUMPFUN', walletCount: 2 })
		]);
		expect(out).toHaveLength(1);
		expect(out[0].label).toBe('jack');
	});

	it('produces unique keys so the dropdown can key by label', () => {
		const out = mergeLabelSuggestions([
			label({ source: 'KOL' }),
			label({ source: 'FOMO' }),
			label({ label: 'jackpot', source: 'KOL' })
		]);
		expect(new Set(out.map((l) => l.label)).size).toBe(out.length);
	});

	it('sums wallet counts across sources', () => {
		const out = mergeLabelSuggestions([
			label({ source: 'KOL', walletCount: 3 }),
			label({ source: 'PUMPFUN', walletCount: 2 })
		]);
		expect(out[0].walletCount).toBe(5);
	});

	it('drops the source mark when merged rows disagree', () => {
		const out = mergeLabelSuggestions([
			label({ source: 'KOL' }),
			label({ source: 'PUMPFUN' })
		]);
		expect(out[0].source).toBeNull();
	});

	it('keeps the source mark when every row agrees', () => {
		const out = mergeLabelSuggestions([
			label({ source: 'FOMO', walletCount: 1 }),
			label({ source: 'FOMO', walletCount: 4 })
		]);
		expect(out[0].source).toBe('FOMO');
		expect(out[0].walletCount).toBe(5);
	});

	it('keeps the first available photo', () => {
		const out = mergeLabelSuggestions([
			label({ photoId: null }),
			label({ source: 'FOMO', photoId: 'pic' })
		]);
		expect(out[0].photoId).toBe('pic');
	});

	it('leaves distinct labels untouched and preserves order', () => {
		const out = mergeLabelSuggestions([
			label({ label: 'jack' }),
			label({ label: 'jackpot' })
		]);
		expect(out.map((l) => l.label)).toEqual(['jack', 'jackpot']);
	});

	it('ignores entries with no label', () => {
		const out = mergeLabelSuggestions([label({ label: '' }), label({ label: 'jack' })]);
		expect(out.map((l) => l.label)).toEqual(['jack']);
	});
});

describe('dedupeSourceItems', () => {
	it('collapses a thesis author returned once per platform', () => {
		const out = dedupeSourceItems([
			{ id: 'Wa11et', name: 'jack', source: 'PUMPFUN' },
			{ id: 'Wa11et', name: 'jack', source: 'FOMO' }
		]);
		expect(out).toHaveLength(1);
		expect(out[0].source).toBeNull();
	});

	it('absorbs a row repeated across cursor pages', () => {
		const page1 = [{ id: 'a', source: 'FOMO' }, { id: 'b', source: 'FOMO' }];
		const page2 = [{ id: 'b', source: 'FOMO' }, { id: 'c', source: 'FOMO' }];
		const out = dedupeSourceItems([...page1, ...page2]);
		expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
		expect(out[1].source).toBe('FOMO');
	});

	it('yields unique ids so the list can be keyed by id', () => {
		const out = dedupeSourceItems([{ id: 'a' }, { id: 'a' }, { id: 'b' }]);
		expect(new Set(out.map((i) => i.id)).size).toBe(out.length);
	});

	it('drops rows with no id', () => {
		const out = dedupeSourceItems([{ id: null }, { id: 'a' }]);
		expect(out.map((i) => i.id)).toEqual(['a']);
	});
});
