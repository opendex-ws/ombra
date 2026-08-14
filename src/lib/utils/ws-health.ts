export type WsConnectionState = 'closed' | 'connecting' | 'open' | 'recovering';
export type WsHealthTone = 'green' | 'yellow' | 'red';
export const WS_PROBE_INTERVAL_MS = 5_000;
export const WS_PONG_STALE_MS = WS_PROBE_INTERVAL_MS * 2;

export function getWsHealthTone(
	state: WsConnectionState,
	pongAgeMs: number | undefined,
	lastPongRttMs: number | undefined
): WsHealthTone {
	if (state === 'closed' || pongAgeMs === undefined || pongAgeMs > WS_PONG_STALE_MS) return 'red';
	if ((lastPongRttMs ?? 0) >= 500) return 'red';
	if (state === 'connecting' || state === 'recovering' || (lastPongRttMs ?? 0) >= 150) {
		return 'yellow';
	}
	return 'green';
}
