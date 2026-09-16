import { describe, expect, it } from 'vitest';

const DEFAULT_MIN = 10;

/** Mirrors loadMarkerPrefs() in TokenChart.svelte. */
function loadMarkerPrefs(raw: string | null) {
	const fallback = { user: true, calls: true, kols: true, theses: true, tweets: true, minUsd: DEFAULT_MIN, maxUsd: null as number | null, curated: false };
	if (!raw) return fallback;
	try {
		const v = JSON.parse(raw);
		const minUsd = Number.isFinite(v.minUsd) && v.minUsd >= 0 ? v.minUsd : DEFAULT_MIN;
		const maxUsd = Number.isFinite(v.maxUsd) && v.maxUsd >= minUsd ? v.maxUsd : null;
		return { user: v.user !== false, calls: v.calls !== false, kols: v.kols !== false, theses: v.theses !== false, tweets: v.tweets !== false, minUsd, maxUsd, curated: v.curated === true };
	} catch {
		return fallback;
	}
}

/** Mirrors markerFilterParams() in TokenChart.svelte. */
function markerFilterParams(minUsd: number, maxUsd: number | null, curatedActive: boolean) {
	const params: { minUsd: string; maxUsd?: string; curated?: boolean } = { minUsd: String(minUsd) };
	if (maxUsd !== null) params.maxUsd = String(maxUsd);
	if (curatedActive) params.curated = true;
	return params;
}

describe('chart marker WS filter params', () => {
	it('sends the bounds as decimal strings, not numbers', () => {
		expect(markerFilterParams(10, 5000, false)).toMatchObject({ minUsd: '10', maxUsd: '5000' });
	});

	it('omits an unset filter rather than spelling it out', () => {
		expect(markerFilterParams(10, null, false)).toEqual({ minUsd: '10' });
	});

	it('keeps decimal bounds intact', () => {
		expect(markerFilterParams(10.5, 99.99, false)).toMatchObject({ minUsd: '10.5', maxUsd: '99.99' });
	});

	it('only asks for curated markers when signed in, since the socket refuses it otherwise', () => {
		expect(markerFilterParams(10, null, true).curated).toBe(true);
		expect(markerFilterParams(10, null, false).curated).toBeUndefined();
	});
});

describe('chart marker curated filter', () => {
	it('defaults off, so a signed-out session never sends it', () => {
		expect(loadMarkerPrefs(null).curated).toBe(false);
		expect(loadMarkerPrefs(JSON.stringify({ minUsd: 50 })).curated).toBe(false);
	});

	it('round-trips when enabled', () => {
		expect(loadMarkerPrefs(JSON.stringify({ curated: true })).curated).toBe(true);
	});

	it('only accepts a real boolean', () => {
		expect(loadMarkerPrefs(JSON.stringify({ curated: 'yes' })).curated).toBe(false);
	});
});

describe('chart marker prefs', () => {
	it('defaults minUsd to the server default', () => {
		expect(loadMarkerPrefs(null).minUsd).toBe(10);
		expect(loadMarkerPrefs(null).maxUsd).toBeNull();
	});

	it('keeps visibility toggles working for blobs written before the size filter', () => {
		const prefs = loadMarkerPrefs(JSON.stringify({ user: false, calls: true, kols: false }));
		expect(prefs).toEqual({ user: false, calls: true, kols: false, theses: true, tweets: true, minUsd: 10, maxUsd: null, curated: false });
	});

	it('round-trips a stored size filter', () => {
		expect(loadMarkerPrefs(JSON.stringify({ minUsd: 500, maxUsd: 5000 }))).toMatchObject({ minUsd: 500, maxUsd: 5000 });
	});

	it('rejects a ceiling below the floor rather than sending an invalid pair', () => {
		expect(loadMarkerPrefs(JSON.stringify({ minUsd: 1000, maxUsd: 100 })).maxUsd).toBeNull();
	});

	it('keeps decimal bounds — the API takes `10.5`, not just integers', () => {
		expect(loadMarkerPrefs(JSON.stringify({ minUsd: 10.5, maxUsd: 99.99 }))).toMatchObject({
			minUsd: 10.5,
			maxUsd: 99.99
		});
	});

	it('falls back on corrupt or negative values', () => {
		expect(loadMarkerPrefs('{oops').minUsd).toBe(10);
		expect(loadMarkerPrefs(JSON.stringify({ minUsd: -5 })).minUsd).toBe(10);
		expect(loadMarkerPrefs(JSON.stringify({ minUsd: 'x' })).minUsd).toBe(10);
	});
});

describe('thesis and tweet marker visibility', () => {
	it('defaults both on, like the other kinds', () => {
		expect(loadMarkerPrefs(null)).toMatchObject({ theses: true, tweets: true });
	});

	it('respects an explicit off', () => {
		const prefs = loadMarkerPrefs(JSON.stringify({ theses: false, tweets: false }));
		expect(prefs.theses).toBe(false);
		expect(prefs.tweets).toBe(false);
	});

	it('leaves a blob written before these existed on', () => {
		const prefs = loadMarkerPrefs(JSON.stringify({ user: false, calls: true, kols: true }));
		expect(prefs).toMatchObject({ user: false, theses: true, tweets: true });
	});

	it('does not let them leak into the server-side size filter', () => {
		expect(markerFilterParams(10, null, false)).toEqual({ minUsd: '10' });
	});
});
