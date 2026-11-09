import { parseSigners } from './signers';

export type FrameEnv = {
	ASSETS: { fetch(request: Request): Promise<Response> };
	EXPORT_SIGNER_PUBKEYS?: string;
};

/**
 * Static origin for the export frame. auth-backend proxies `/auth/wallet-export/*` here and
 * serves the frame from the auth origin with its own frame-ancestors, so
 * this worker refuses to be framed directly.
 */
export function frameCsp(): string {
	return "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
}

function secure(headers: Headers): Headers {
	headers.set('Content-Security-Policy', frameCsp());
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('Cache-Control', 'no-store');
	return headers;
}

function plain(status: number, body: string): Response {
	const headers = secure(new Headers());
	headers.set('content-type', 'text/plain');
	return new Response(body, { status, headers });
}

const SIGNER_META = /<meta name="export-signer-pubkeys" content="[^"]*">/;

export default {
	async fetch(request: Request, env: FrameEnv): Promise<Response> {
		if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Method Not Allowed');
		const signers = parseSigners(env.EXPORT_SIGNER_PUBKEYS);
		if (signers === null) return plain(500, 'EXPORT_SIGNER_PUBKEYS is invalid');
		const res = await env.ASSETS.fetch(request);
		const headers = secure(new Headers(res.headers));
		if ((res.headers.get('content-type') ?? '').startsWith('text/html')) {
			const text = (await res.text()).replace(
				SIGNER_META,
				() => `<meta name="export-signer-pubkeys" content="${signers.join(',')}">`
			);
			headers.delete('content-length');
			return new Response(request.method === 'HEAD' ? null : text, { status: res.status, headers });
		}
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
	}
};
