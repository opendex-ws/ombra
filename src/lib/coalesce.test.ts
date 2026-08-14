import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoalescer } from './utils/coalesce';

describe('createCoalescer', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('flushes individual pushes once on the next animation frame', () => {
		let frame: FrameRequestCallback | undefined;
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			frame = callback;
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		const flushed: number[][] = [];
		const coalescer = createCoalescer<number>((batch) => flushed.push(batch));

		coalescer.push(1);
		coalescer.push(2);
		coalescer.push(3);

		expect(flushed).toEqual([]);
		expect(coalescer.size()).toBe(3);
		frame?.(0);
		expect(flushed).toEqual([[1, 2, 3]]);
		expect(coalescer.size()).toBe(0);
	});

	it('retains the newest bounded batch in arrival order', () => {
		let frame: FrameRequestCallback | undefined;
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			frame = callback;
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		const flushed: number[][] = [];
		const coalescer = createCoalescer<number>((batch) => flushed.push(batch), { maxBatch: 3 });

		coalescer.pushMany([1, 2, 3, 4, 5]);

		expect(coalescer.size()).toBe(3);
		frame?.(0);
		expect(flushed).toEqual([[3, 4, 5]]);
	});
});
