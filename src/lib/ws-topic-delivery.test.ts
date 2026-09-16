import { describe, expect, it } from 'vitest';

/**
 * Mirrors noteTopicDelivery() in ws/client. The point of the counter is to tell
 * apart the two ways a live feed goes quiet: frames stop arriving, or frames
 * arrive and get dropped by routing/window gating.
 */
type Entry = {
	received: number;
	delivered: number;
	rejectedWindow: number;
	unmatched: number;
	lastReceivedAtMs?: number;
	lastDeliveredAtMs?: number;
};

function note(map: Map<string, Entry>, topic: string, delivered: number, rejectedWindow: number, now: number) {
	const key = topic.includes('?') ? topic.slice(0, topic.indexOf('?')) : topic;
	let e = map.get(key);
	if (!e) {
		e = { received: 0, delivered: 0, rejectedWindow: 0, unmatched: 0 };
		map.set(key, e);
	}
	e.received++;
	e.lastReceivedAtMs = now;
	e.rejectedWindow += rejectedWindow;
	if (delivered > 0) {
		e.delivered++;
		e.lastDeliveredAtMs = now;
	} else if (rejectedWindow === 0) {
		e.unmatched++;
	}
}

describe('topic delivery accounting', () => {
	it('separates "arrived and dropped" from "never arrived"', () => {
		const m = new Map<string, Entry>();
		// healthy
		for (let i = 0; i < 5; i++) note(m, 'watchlist:callers', 1, 0, 1000 + i);
		// then frames keep arriving but window gating rejects them
		for (let i = 0; i < 3; i++) note(m, 'watchlist:callers', 0, 1, 2000 + i);
		const e = m.get('watchlist:callers')!;
		expect(e.received).toBe(8);
		expect(e.delivered).toBe(5);
		expect(e.rejectedWindow).toBe(3);
		// the tell: received kept climbing after delivered stopped
		expect(e.lastReceivedAtMs).toBeGreaterThan(e.lastDeliveredAtMs!);
	});

	it('counts frames that match no subscription as unmatched, not rejected', () => {
		const m = new Map<string, Entry>();
		note(m, 'wallets:thesis', 0, 0, 1);
		const e = m.get('wallets:thesis')!;
		expect(e.unmatched).toBe(1);
		expect(e.rejectedWindow).toBe(0);
		expect(e.lastDeliveredAtMs).toBeUndefined();
	});

	it('groups a filtered room under its base topic', () => {
		const m = new Map<string, Entry>();
		note(m, 'wallets:feed?minUsd=100000', 1, 0, 1);
		note(m, 'wallets:feed', 1, 0, 2);
		expect(m.get('wallets:feed')!.received).toBe(2);
		expect([...m.keys()]).toEqual(['wallets:feed']);
	});
});
