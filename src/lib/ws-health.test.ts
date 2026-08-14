import { describe, expect, test } from 'vitest';
import { getWsHealthTone, WS_PONG_STALE_MS, WS_PROBE_INTERVAL_MS } from './utils/ws-health';

describe('WebSocket status rail health', () => {
	test('marks missing or old application pongs as degraded', () => {
		expect(getWsHealthTone('open', undefined, undefined)).toBe('red');
		expect(WS_PROBE_INTERVAL_MS).toBe(5_000);
		expect(WS_PONG_STALE_MS).toBe(10_000);
		expect(getWsHealthTone('open', WS_PONG_STALE_MS + 1, 20)).toBe('red');
		expect(getWsHealthTone('closed', 10, 20)).toBe('red');
	});

	test('uses recovery and latency thresholds for warning states', () => {
		expect(getWsHealthTone('recovering', 1_000, 20)).toBe('yellow');
		expect(getWsHealthTone('connecting', 1_000, 20)).toBe('yellow');
		expect(getWsHealthTone('open', 1_000, 150)).toBe('yellow');
		expect(getWsHealthTone('open', 1_000, 500)).toBe('red');
	});

	test('reports a stable open connection when pong latency is low', () => {
		expect(getWsHealthTone('open', 1_000, 42)).toBe('green');
	});
});
