import { describe, expect, it, vi } from 'vitest';
import type { CustomMetaFilter } from './contracts';
import { isExactJsonNumber, jsonNumberFromText } from './json-number';
import { decodeRestMetaFilter, encodeRestMetaFilter, nativeMetaFilter, setRestMetaFilter } from './transport';

const filter: CustomMetaFilter = [
	{ field: 'followers', op: 'gte', value: 1000 },
	{ field: 'tags', op: 'containsAll', value: ['college', 'dog'] }
];

describe('custom signal filter transport', () => {
	it('uses one JSON-text REST parameter and omits an empty filter', () => {
		const params = setRestMetaFilter(new URLSearchParams('chain=SOL&metaFilter=old'), filter);
		expect(params.getAll('metaFilter')).toEqual([JSON.stringify(filter)]);
		expect(params.toString()).toContain('metaFilter=%5B%7B');
		expect(encodeRestMetaFilter([])).toBeUndefined();
		expect(setRestMetaFilter(params, []).has('metaFilter')).toBe(false);
	});

	it('returns an independent native array for WebSocket, list, and bot payloads', () => {
		const native = nativeMetaFilter(filter);
		expect(native).toEqual(filter);
		expect(native).not.toBe(filter);
		expect(native[1].value).not.toBe(filter[1].value);
	});

	it('decodes one URL value and rejects ambiguous or invalid URL state', () => {
		expect(decodeRestMetaFilter(new URLSearchParams({ metaFilter: JSON.stringify(filter) }))).toEqual(filter);
		expect(decodeRestMetaFilter(new URLSearchParams())).toBeUndefined();
		expect(() => decodeRestMetaFilter(new URLSearchParams('metaFilter=[]&metaFilter=[]'))).toThrow('Only one');
		expect(() => decodeRestMetaFilter(new URLSearchParams('metaFilter='))).toThrow('must not be empty');
		expect(() => decodeRestMetaFilter(new URLSearchParams('metaFilter=not-json'))).toThrow('valid JSON');
		expect(() => decodeRestMetaFilter(new URLSearchParams('metaFilter=%7B%7D'))).toThrow('JSON array');
	});

	it('round-trips exact numeric operands as JSON numbers', () => {
		const exact = [{ field: 'supply', op: 'gte' as const, value: jsonNumberFromText('9007199254740993') }];
		const encoded = encodeRestMetaFilter(exact);
		expect(encoded).toBe('[{"field":"supply","op":"gte","value":9007199254740993}]');
		const decoded = decodeRestMetaFilter(new URLSearchParams({ metaFilter: encoded! })) as CustomMetaFilter;
		expect(isExactJsonNumber(decoded[0].value)).toBe(true);
		expect(JSON.stringify(decoded)).toBe(encoded);
		expect(JSON.stringify(nativeMetaFilter(decoded))).toBe(encoded);
	});

	it('fails closed without exact JSON runtime support', () => {
		const nativeParse = JSON.parse;
		const parseWithoutSource = ((text: string, reviver?: (key: string, value: unknown) => unknown) =>
			nativeParse(text, reviver ? (key, value) => reviver(key, value) : undefined)
		) as typeof JSON.parse;
		const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(parseWithoutSource);
		try {
			expect(() => decodeRestMetaFilter(new URLSearchParams({
				metaFilter: '[{"field":"supply","op":"gte","value":9007199254740993}]'
			}))).toThrow('cannot preserve exact JSON numbers');
		} finally {
			parseSpy.mockRestore();
		}

		const rawJsonDescriptor = Object.getOwnPropertyDescriptor(JSON, 'rawJSON');
		expect(rawJsonDescriptor).toBeDefined();
		if (!rawJsonDescriptor) return;
		Object.defineProperty(JSON, 'rawJSON', { ...rawJsonDescriptor, value: undefined });
		try {
			expect(() => decodeRestMetaFilter(new URLSearchParams({
				metaFilter: '[{"field":"supply","op":"gte","value":9007199254740993}]'
			}))).toThrow('cannot preserve exact JSON numbers');
		} finally {
			Object.defineProperty(JSON, 'rawJSON', rawJsonDescriptor);
		}
	});

	it('enforces count and byte limits in every transport helper', () => {
		const tooMany = Array.from({ length: 33 }, (_, index) => ({
			field: 'note', op: 'contains' as const, value: `value-${index}`
		}));
		const tooLarge = [{ field: 'note', op: 'contains' as const, value: 'x'.repeat(8_192) }];
		expect(() => encodeRestMetaFilter(tooMany)).toThrow('at most 32 predicates');
		expect(() => setRestMetaFilter(new URLSearchParams(), tooMany)).toThrow('at most 32 predicates');
		expect(() => nativeMetaFilter(tooMany)).toThrow('at most 32 predicates');
		expect(() => encodeRestMetaFilter(tooLarge)).toThrow('8192 bytes');
		expect(() => setRestMetaFilter(new URLSearchParams(), tooLarge)).toThrow('8192 bytes');
		expect(() => nativeMetaFilter(tooLarge)).toThrow('8192 bytes');
	});
});
