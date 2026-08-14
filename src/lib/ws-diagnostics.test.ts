import { describe, expect, test, vi } from 'vitest';
import { observeWsDiagnostics } from './ws/client';

describe('reactive WebSocket diagnostics', () => {
	test('publishes an initial snapshot and returns an unsubscribe handle', () => {
		const listener = vi.fn();
		const stop = observeWsDiagnostics(listener);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0][0]).toMatchObject({
			state: 'closed',
			reconnectScheduled: false
		});
		expect(stop()).toBe(true);
	});
});
