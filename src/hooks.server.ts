import type { Handle } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { ASYNC_CHUNK_FILES } from '$lib/generated/async-chunks';
import { API_BASE, API_PROXY } from '$lib/api/config';

// Optional API-key mode. Instead of pointing at a per-tenant whitelabel URL, the
// proxy can talk to the shared API host and authenticate with a key. The key is
// read from PRIVATE env and injected server-side only, so it is never shipped to
// the browser — which is why this requires proxy mode and has no direct-mode
// equivalent. Leave API_KEY unset to keep the whitelabel-URL behaviour.
const API_KEY = privateEnv?.API_KEY ?? '';
const DEFAULT_API_KEY_ORIGIN = 'https://api-backend-new.opendex.ws';
const API_KEY_ORIGIN = (privateEnv?.API_KEY_ORIGIN ?? DEFAULT_API_KEY_ORIGIN).replace(/\/$/, '');

/** Origin the proxy forwards to: the shared host in key mode, else the whitelabel base. */
function proxyOrigin(): string {
	return API_KEY ? API_KEY_ORIGIN : API_BASE;
}

// Same-origin proxy: only active when PUBLIC_API_PROXY is enabled (and
// PUBLIC_API_BASE is set). Forwards app API requests to the backend so the
// browser avoids CORS. In direct mode this no-ops and the browser calls the
// backend directly. See .env.example / src/lib/api/config.ts.
function getApiProxyUrl(url: URL): URL | null {
	const origin = proxyOrigin();
	if (!API_PROXY || !origin) return null;
	const proxyPath =
		url.pathname === '/v2' ||
		url.pathname.startsWith('/v2/') ||
		url.pathname === '/rpc/sol' ||
		url.pathname.startsWith('/rpc/sol/');
	if (!proxyPath) return null;
	const base = new URL(origin);
	const target = new URL(url);
	target.protocol = base.protocol;
	target.host = base.host;
	target.port = base.port;
	return target;
}

function createProxyRequest(request: Request, target: URL): Request {
	const headers = new Headers(request.headers);
	headers.delete('host');
	headers.delete('origin');
	headers.delete('referer');
	// Attached here so the key stays on the server; a browser never sees it.
	if (API_KEY) headers.set('X-API-Key', API_KEY);

	const init: RequestInit & { duplex?: 'half' } = {
		method: request.method,
		headers,
		body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
		redirect: 'manual'
	};
	if (init.body) init.duplex = 'half';
	return new Request(target, init);
}

function apiConnectSrc(): string {
	const parts = ["'self'", 'https:', 'wss:'];
	// In key mode the browser only ever talks same-origin, so the upstream host
	// does not belong in connect-src.
	if (!API_BASE || API_KEY) return parts.join(' ');
	try {
		const origin = new URL(API_BASE).origin;
		parts.push(origin, origin.replace(/^http/i, 'ws'));
	} catch {
		// PUBLIC_API_BASE is optional in direct/dev setups.
	}
	return parts.join(' ');
}

function contentSecurityPolicy(): string {
	return [
		"frame-ancestors 'none'",
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		`connect-src ${apiConnectSrc()}`,
		"img-src 'self' data: https: blob:",
		"media-src 'self' https: blob:",
		"style-src 'self' 'unsafe-inline'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'"
	].join('; ');
}

function applySecurityHeaders(headers: Headers): void {
	headers.set('Content-Security-Policy', contentSecurityPolicy());
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
	headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function withSecurityHeaders(response: Response, cacheControl?: string): Response {
	const headers = new Headers(response.headers);
	applySecurityHeaders(headers);
	if (cacheControl) headers.set('cache-control', cacheControl);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function shouldPreload(type: 'js' | 'css' | 'font' | 'asset', path: string): boolean {
	if (type === 'font' || type === 'asset') return false;
	if (type === 'css') {
		return !/WatchlistPanel|TwitterFeed|ThemeBuilder|MobileConnect|MobileScan|FloatingToken|TraderOverview|TraderPortfolio|PnlShare|CreateBot|UserList/i.test(
			path
		);
	}
	if (type !== 'js') return false;
	const file = path.split('/').pop() ?? path;
	if (ASYNC_CHUNK_FILES.has(file)) return false;
	return true;
}

export const handle: Handle = async ({ event, resolve }) => {
	const target = getApiProxyUrl(event.url);
	if (target) {
		return withSecurityHeaders(await fetch(createProxyRequest(event.request, target)));
	}

	const response = await resolve(event, {
		preload: ({ type, path }) => shouldPreload(type, path)
	});
	const isHtml = response.headers.get('content-type')?.includes('text/html');
	return withSecurityHeaders(response, isHtml ? 'no-cache' : undefined);
};
