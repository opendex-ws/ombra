import type { Handle } from '@sveltejs/kit';
import { ASYNC_CHUNK_FILES } from '$lib/generated/async-chunks';
import { API_BASE, API_PROXY } from '$lib/api/config';

// Same-origin proxy: only active when PUBLIC_API_PROXY is enabled (and
// PUBLIC_API_BASE is set). Forwards app API requests to the backend so the
// browser avoids CORS. In direct mode this no-ops and the browser calls the
// backend directly. See .env.example / src/lib/api/config.ts.
function getApiProxyUrl(url: URL): URL | null {
	if (!API_PROXY || !API_BASE) return null;
	const proxyPath =
		url.pathname === '/v2' ||
		url.pathname.startsWith('/v2/') ||
		url.pathname === '/polymarket' ||
		url.pathname.startsWith('/polymarket/') ||
		url.pathname === '/rpc/sol' ||
		url.pathname.startsWith('/rpc/sol/');
	if (!proxyPath) return null;
	const base = new URL(API_BASE);
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

	const init: RequestInit & { duplex?: 'half' } = {
		method: request.method,
		headers,
		body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
		redirect: 'manual'
	};
	if (init.body) init.duplex = 'half';
	return new Request(target, init);
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
		return fetch(createProxyRequest(event.request, target));
	}

	const response = await resolve(event, {
		preload: ({ type, path }) => shouldPreload(type, path)
	});
	if (!response.headers.get('content-type')?.includes('text/html')) return response;

	const headers = new Headers(response.headers);
	headers.set('cache-control', 'no-cache');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
