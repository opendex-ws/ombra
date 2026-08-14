import { env } from '$env/dynamic/public';

// Backend origin (scheme, no trailing slash). Required.
export const API_BASE = (env?.PUBLIC_API_BASE ?? '').replace(/\/$/, '');

// Proxy mode: when enabled, the browser talks to the backend **same-origin** and
// the dev server (vite) / production worker (hooks.server.ts) forward app API
// paths to API_BASE (avoids CORS). When disabled (default), the browser calls
// API_BASE directly and the proxy no-ops — adopters handle CORS on their backend.
export const API_PROXY = /^(1|true|yes)$/i.test(env?.PUBLIC_API_PROXY ?? '');

/**
 * Origin the browser should send API/image/websocket requests to.
 * - proxy mode: '' (same-origin root; the proxy rewrites to API_BASE)
 * - direct mode: API_BASE
 * On the server (no same-origin proxy) always use API_BASE directly.
 */
export function apiOrigin(): string {
	if (typeof window === 'undefined') return API_BASE; // SSR: always direct
	return API_PROXY ? '' : API_BASE;
}

/** Prefix a `/v2/...` path with the correct origin (proxy or direct). */
export function apiUrl(path: string): string {
	return `${apiOrigin()}${path}`;
}

/** Token image URL for a chain/address (proxy or direct origin). */
export function tokenImage(chain: string, address: string): string {
	return apiUrl(`/v2/token/image/${chain}/${address}`);
}

/** WebSocket base (ws/wss origin) for `/v2/ws`. */
export function wsBase(): string {
	if (typeof window === 'undefined') return API_BASE.replace(/^http/, 'ws');
	if (API_PROXY) {
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${window.location.host}`;
	}
	return API_BASE.replace(/^http/, 'ws');
}
