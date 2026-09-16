import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const KEY = 'ombra_fe_settings';

async function loadStore() {
	vi.resetModules();
	return await import('$lib/stores/feSettings.svelte');
}

describe('feSettings migration', () => {
	beforeEach(() => localStorage.clear());

	it('defaults the social feed to swaps', async () => {
		const s = await loadStore();
		s.initFeSettings();
		expect(s.getSocialFeedTab()).toBe('swaps');
	});

	it('drops a pre-v2 social tab persisted under the old default', async () => {
		localStorage.setItem(KEY, JSON.stringify({ socialFeedTab: 'x', watchlistOpen: false }));
		const s = await loadStore();
		s.initFeSettings();
		expect(s.getSocialFeedTab()).toBe('swaps');
		// unrelated persisted settings must survive the migration
		expect(s.getWatchlistOpen()).toBe(false);
	});

	it('keeps an explicit pick made after the migration', async () => {
		localStorage.setItem(KEY, JSON.stringify({ socialFeedTab: 'x', settingsVersion: 2 }));
		const s = await loadStore();
		s.initFeSettings();
		expect(s.getSocialFeedTab()).toBe('x');
	});
});

describe('swap feed filters', () => {
	beforeEach(() => localStorage.clear());

	it('defaults to the safe floor with no filters', async () => {
		const s = await loadStore();
		s.initFeSettings();
		expect(s.getSwapFeedFilters()).toEqual({
			feedMode: 'all', side: '', minUsd: 10, maxUsd: null, labels: [], sources: []
		});
	});

	it('round-trips a configured filter set across a reload', async () => {
		let s = await loadStore();
		s.initFeSettings();
		s.setSwapFeedFilters({ feedMode: 'mine', side: 'BUY', minUsd: 500, labels: ['kol'] });

		s = await loadStore();
		s.initFeSettings();
		expect(s.getSwapFeedFilters()).toMatchObject({
			feedMode: 'mine', side: 'BUY', minUsd: 500, labels: ['kol']
		});
	});

	it('merges partial updates instead of dropping the other filters', async () => {
		const s = await loadStore();
		s.initFeSettings();
		s.setSwapFeedFilters({ sources: ['FOMO'] });
		s.setSwapFeedFilters({ minUsd: 25 });
		expect(s.getSwapFeedFilters()).toMatchObject({ sources: ['FOMO'], minUsd: 25 });
	});
});

describe('swap feed row density', () => {
	beforeEach(() => localStorage.clear());

	it('defaults to full rows', async () => {
		const s = await loadStore();
		s.initFeSettings();
		expect(s.getSwapFeedCompact()).toBe(false);
	});

	it('persists compact rows across a reload', async () => {
		let s = await loadStore();
		s.initFeSettings();
		s.toggleSwapFeedCompact();
		expect(s.getSwapFeedCompact()).toBe(true);

		s = await loadStore();
		s.initFeSettings();
		expect(s.getSwapFeedCompact()).toBe(true);
	});
});
