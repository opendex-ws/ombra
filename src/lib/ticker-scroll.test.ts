import { describe, expect, it } from 'vitest';

/**
 * Mirrors the favourites-ticker scroll decision. The measurement must not depend
 * on the state it controls: measuring the duplicated list made "just fits" flip
 * on and off every frame, which showed up as a 1–2px horizontal shake.
 */
function needScroll(contentW: number, available: number, scrolling: boolean) {
	return scrolling ? contentW > available - 2 : contentW > available + 2;
}

describe('favourites ticker scroll decision', () => {
	it('does not oscillate when the list almost exactly fits', () => {
		const available = 1000;
		let scrolling = false;
		const seen: boolean[] = [];
		// content sits right on the boundary, jittering by a sub-pixel each frame
		for (const contentW of [1000, 1001, 999.5, 1000.4, 1001, 999]) {
			scrolling = needScroll(contentW, available, scrolling);
			seen.push(scrolling);
		}
		expect(new Set(seen).size).toBe(1);
		expect(scrolling).toBe(false);
	});

	it('still scrolls when the list genuinely overflows', () => {
		expect(needScroll(1200, 1000, false)).toBe(true);
		expect(needScroll(1200, 1000, true)).toBe(true);
	});

	it('stops scrolling once the list clearly fits again', () => {
		expect(needScroll(600, 1000, true)).toBe(false);
	});

	it('holds its current state inside the hysteresis band', () => {
		// within ±2px the decision sticks, whichever way it was
		expect(needScroll(1001, 1000, false)).toBe(false);
		expect(needScroll(999, 1000, true)).toBe(true);
	});
});
