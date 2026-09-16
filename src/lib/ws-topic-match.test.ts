import { describe, expect, it } from 'vitest';
import { topicMatches } from '$lib/ws/client';

describe('topicMatches', () => {
	it('matches exact and hierarchical topics', () => {
		expect(topicMatches('token:SOL:abc', 'token:SOL:abc')).toBe(true);
		expect(topicMatches('token:SOL:abc', 'token:SOL:abc:price')).toBe(true);
		expect(topicMatches('token:SOL:abc:price', 'token:SOL:abc')).toBe(true);
		expect(topicMatches('token:SOL:abc', 'token:SOL:def')).toBe(false);
	});

	it('delivers labeled-wallet frames that echo a canonical filter suffix', () => {
		expect(topicMatches('wallets:feed', 'wallets:feed?minUsd=10')).toBe(true);
		expect(topicMatches('wallets:personal', 'wallets:personal?side=BUY&minUsd=10')).toBe(true);
	});

	it('keeps rooms isolated when both sides carry a suffix', () => {
		expect(topicMatches('wallets:feed?minUsd=10', 'wallets:feed?minUsd=10')).toBe(true);
		expect(topicMatches('wallets:feed?minUsd=10', 'wallets:feed?minUsd=500')).toBe(false);
	});

	it('does not match across different base topics that share a suffix', () => {
		expect(topicMatches('wallets:feed?minUsd=10', 'wallets:personal?minUsd=10')).toBe(false);
	});
});

describe('room-suffix topics', () => {
	// The server publishes each filtered room's frames under that room's own
	// canonical topic. A scoped subscriber must not swallow the unscoped room's
	// frames — dispatch routes `wallets:*` strictly on the acknowledged topic, so
	// these cases are handled there rather than by loose matching here.
	it('treats a scoped room and the bare topic as different rooms', () => {
		expect(topicMatches('wallets:thesis?tokenAddress=A', 'wallets:thesis?tokenAddress=A')).toBe(true);
		expect(topicMatches('wallets:thesis?tokenAddress=A', 'wallets:thesis?tokenAddress=B')).toBe(false);
	});

	it('still matches a bare subscription against its own bare frames', () => {
		expect(topicMatches('wallets:thesis', 'wallets:thesis')).toBe(true);
	});

	it('keeps personal and public rooms distinct at the base', () => {
		expect(topicMatches('wallets:thesis:personal', 'wallets:feed')).toBe(false);
	});
});
