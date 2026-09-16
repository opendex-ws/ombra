import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const KEY = 'ombra_fe_settings';

/** A fresh module is the only honest way to reproduce a page reload. */
async function loadStore() {
	vi.resetModules();
	return await import('$lib/stores/feSettings.svelte');
}

describe('memescope per-column filters', () => {
	beforeEach(() => localStorage.clear());

	it('defaults every column to unfiltered', async () => {
		const s = await loadStore();
		for (const phase of ['new', 'graduating', 'graduated'] as const) {
			expect(s.getMemescopeFilters(phase)).toEqual({ filters: {}, platforms: [], chain: 'All' });
		}
	});

	it('keeps each column independent', async () => {
		const s = await loadStore();
		s.setMemescopeFilters('new', {
			filters: { minLiquidity: '5000' },
			platforms: ['PUMPFUN'],
			chain: 'SOL'
		});
		expect(s.getMemescopeFilters('new').filters).toEqual({ minLiquidity: '5000' });
		expect(s.getMemescopeFilters('graduating')).toEqual({ filters: {}, platforms: [], chain: 'All' });
		expect(s.getMemescopeFilters('graduated')).toEqual({ filters: {}, platforms: [], chain: 'All' });
	});

	it('survives a reload without anyone calling initFeSettings', async () => {
		const first = await loadStore();
		first.setMemescopeFilters('graduated', {
			filters: { maxAgeHours: '24' },
			platforms: [],
			chain: 'All'
		});

		// A route component reads at init, before the layout mounts, so hydration
		// must already have happened on import.
		const reloaded = await loadStore();
		expect(reloaded.getMemescopeFilters('graduated').filters).toEqual({ maxAgeHours: '24' });
	});

	it('round-trips platforms, which cannot persist as a Set', async () => {
		const first = await loadStore();
		first.setMemescopeFilters('graduating', {
			filters: {},
			platforms: ['PUMPFUN', 'FOMO'],
			chain: 'All'
		});
		const reloaded = await loadStore();
		expect(new Set(reloaded.getMemescopeFilters('graduating').platforms)).toEqual(
			new Set(['PUMPFUN', 'FOMO'])
		);
	});

	it('keeps a per-column chain across a reload', async () => {
		const first = await loadStore();
		first.setMemescopeFilters('new', { filters: {}, platforms: [], chain: 'SOL' });
		const reloaded = await loadStore();
		expect(reloaded.getMemescopeFilters('new').chain).toBe('SOL');
		expect(reloaded.getMemescopeFilters('graduated').chain).toBe('All');
	});

	it('falls back when a stored blob predates the field', async () => {
		localStorage.setItem(KEY, JSON.stringify({ expandPositions: true, settingsVersion: 2 }));
		const s = await loadStore();
		expect(s.getMemescopeFilters('new')).toEqual({ filters: {}, platforms: [], chain: 'All' });
	});

	it('leaves other columns alone when one is written', async () => {
		const first = await loadStore();
		first.setMemescopeFilters('new', { filters: { minLiquidity: '1' }, platforms: [], chain: 'All' });
		first.setMemescopeFilters('graduated', { filters: { maxAgeHours: '2' }, platforms: [], chain: 'All' });
		const reloaded = await loadStore();
		expect(reloaded.getMemescopeFilters('new').filters).toEqual({ minLiquidity: '1' });
		expect(reloaded.getMemescopeFilters('graduated').filters).toEqual({ maxAgeHours: '2' });
		expect(reloaded.getMemescopeFilters('graduating').filters).toEqual({});
	});
});
