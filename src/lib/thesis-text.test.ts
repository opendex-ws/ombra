import { describe, expect, it } from 'vitest';
import { parseThesisText } from '$lib/utils/thesis';

describe('parseThesisText', () => {
	it('renders the display name and drops the id', () => {
		expect(parseThesisText('gm @[cwuhn4](517c0b82-cb40-467a-9e95-e67f350b028c) wen')).toEqual([
			{ kind: 'text', value: 'gm ' },
			{ kind: 'mention', value: 'cwuhn4' },
			{ kind: 'text', value: ' wen' }
		]);
	});

	it('handles several mentions, including adjacent ones', () => {
		expect(parseThesisText('@[a](1)@[b](2)')).toEqual([
			{ kind: 'mention', value: 'a' },
			{ kind: 'mention', value: 'b' }
		]);
	});

	it('handles a mention at either end', () => {
		expect(parseThesisText('@[a](1) hi')[0]).toEqual({ kind: 'mention', value: 'a' });
		expect(parseThesisText('hi @[a](1)').at(-1)).toEqual({ kind: 'mention', value: 'a' });
	});

	it('leaves plain text and lookalikes untouched', () => {
		expect(parseThesisText('email me @ home')).toEqual([{ kind: 'text', value: 'email me @ home' }]);
		expect(parseThesisText('a [b](c) d')).toEqual([{ kind: 'text', value: 'a [b](c) d' }]);
		expect(parseThesisText('@[unclosed(1)')).toEqual([{ kind: 'text', value: '@[unclosed(1)' }]);
	});

	it('never loses characters', () => {
		const text = 'buy @[whale](x) now, @[other](y)!';
		const rebuilt = parseThesisText(text)
			.map((s) => (s.kind === 'mention' ? `@[${s.value}](` : s.value))
			.join('');
		expect(rebuilt).toContain('buy ');
		expect(parseThesisText(text).filter((s) => s.kind === 'mention')).toHaveLength(2);
	});

	it('tolerates an empty id and empty input', () => {
		expect(parseThesisText('@[solo]()')).toEqual([{ kind: 'mention', value: 'solo' }]);
		expect(parseThesisText('')).toEqual([]);
	});

	it('is reusable — the shared regex must not carry lastIndex between calls', () => {
		const text = '@[a](1) tail';
		expect(parseThesisText(text)).toEqual(parseThesisText(text));
	});
});
