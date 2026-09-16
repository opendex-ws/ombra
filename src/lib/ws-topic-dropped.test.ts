import { describe, expect, it } from 'vitest';

/**
 * Mirrors handleTopicDropped()'s toast throttling. `topic_dropped` can repeat for
 * the same topic, and the socket stays open — so the feed goes quiet without any
 * other signal. One toast per topic per cooldown, never a stack of identical ones.
 */
const COOLDOWN_MS = 30_000;

function makeDropToaster() {
	const recent = new Map<string, number>();
	const toasts: string[] = [];
	return {
		toasts,
		drop(topic: string, now: number) {
			const name = topic || 'a live feed';
			const last = recent.get(name);
			if (last !== undefined && now - last < COOLDOWN_MS) return;
			recent.set(name, now);
			toasts.push(name);
		}
	};
}

describe('topic_dropped toasts', () => {
	it('shows one toast per topic, not one per repeat', () => {
		const t = makeDropToaster();
		t.drop('watchlist:callers', 0);
		t.drop('watchlist:callers', 1_000);
		t.drop('watchlist:callers', 29_999);
		expect(t.toasts).toEqual(['watchlist:callers']);
	});

	it('warns again once the cooldown passes', () => {
		const t = makeDropToaster();
		t.drop('watchlist:callers', 0);
		t.drop('watchlist:callers', 30_001);
		expect(t.toasts).toHaveLength(2);
	});

	it('tracks each topic independently', () => {
		const t = makeDropToaster();
		t.drop('watchlist:callers', 0);
		t.drop('wallets:feed', 10);
		t.drop('token:SOL:abc:swaps', 20);
		expect(t.toasts).toEqual(['watchlist:callers', 'wallets:feed', 'token:SOL:abc:swaps']);
	});

	it('still names something when the server omits the topic', () => {
		const t = makeDropToaster();
		t.drop('', 0);
		expect(t.toasts).toEqual(['a live feed']);
	});
});
