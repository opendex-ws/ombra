import { describe, expect, test, vi } from 'vitest';
import { CHUNK_RELOAD_COOLDOWN_MS, recoverFromChunkLoadError } from './utils/chunk-recovery';

describe('async chunk recovery', () => {
	test('prevents the rejected import and reloads once', () => {
		const event = new Event('vite:preloadError', { cancelable: true });
		const storage = new Map<string, string>();
		const reload = vi.fn();

		const result = recoverFromChunkLoadError(event, {
			now: () => 100_000,
			storage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => storage.set(key, value)
			},
			reload
		});

		expect(result).toBe('reloaded');
		expect(event.defaultPrevented).toBe(true);
		expect(reload).toHaveBeenCalledOnce();
	});

	test('suppresses a reload loop when the new chunk still cannot load', () => {
		const reload = vi.fn();
		const event = new Event('vite:preloadError', { cancelable: true });
		const result = recoverFromChunkLoadError(event, {
			now: () => 100_000 + CHUNK_RELOAD_COOLDOWN_MS - 1,
			storage: {
				getItem: () => '100000',
				setItem: vi.fn()
			},
			reload
		});

		expect(result).toBe('suppressed');
		expect(event.defaultPrevented).toBe(true);
		expect(reload).not.toHaveBeenCalled();
	});
});
