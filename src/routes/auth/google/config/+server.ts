import { env } from '$env/dynamic/public';
import { json, type RequestHandler } from '@sveltejs/kit';

const empty = { enabled: false, mode: 'off', buttonLabel: '' };

export const GET: RequestHandler = async ({ url, fetch }) => {
	const base = (env.PUBLIC_AUTH_BACKEND_URL ?? '').replace(/\/$/, '');
	const orgId = url.searchParams.get('orgId') ?? '';
	if (!base || !orgId) return json(empty);
	try {
		const res = await fetch(
			`${base}/sso/google/config?orgId=${encodeURIComponent(orgId)}`
		);
		if (!res.ok) return json(empty);
		return json(await res.json());
	} catch {
		return json(empty);
	}
};
