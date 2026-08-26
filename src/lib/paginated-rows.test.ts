import { describe, expect, it } from 'vitest';
import { mergeUniqueById, totalAtLeastLoaded, unseenCursor } from './utils/paginated-rows';

describe('cursor-paginated rows', () => {
	it('keeps one updated row when adjacent pages overlap', () => {
		expect(
			mergeUniqueById(
				[
					{ id: 'one', value: 1 },
					{ id: 'two', value: 2 }
				],
				[
					{ id: 'two', value: 20 },
					{ id: 'three', value: 3 }
				]
			)
		).toEqual([
			{ id: 'one', value: 1 },
			{ id: 'two', value: 20 },
			{ id: 'three', value: 3 }
		]);
	});

	it('stops a repeated cursor and never reports a total below loaded rows', () => {
		const seen = new Set(['cursor-2']);
		expect(unseenCursor('cursor-2', seen)).toBeUndefined();
		expect(unseenCursor('cursor-3', seen)).toBe('cursor-3');
		expect(totalAtLeastLoaded(2, 3)).toBe(3);
	});
});
