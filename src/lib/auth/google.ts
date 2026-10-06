import { API_BASE } from '$lib/api/config';
import { env } from '$env/dynamic/public';

export interface GoogleLoginConfig {
	enabled: boolean;
	mode: string;
	buttonLabel: string;
}

export function orgIdFromApiBase(): string | null {
	if (!API_BASE) return null;
	try {
		const host = new URL(API_BASE).hostname;
		const id = host.split('.')[0];
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
			return id;
		}
	} catch {
		return null;
	}
	return null;
}

export function authBackendUrl(): string {
	return (env.PUBLIC_AUTH_BACKEND_URL ?? '').replace(/\/$/, '');
}

export async function fetchGoogleLoginConfig(orgId: string): Promise<GoogleLoginConfig> {
	const empty = { enabled: false, mode: 'off', buttonLabel: '' };
	if (!orgId || !authBackendUrl()) return empty;
	try {
		const res = await fetch(`/auth/google/config?orgId=${encodeURIComponent(orgId)}`);
		if (!res.ok) return empty;
		const body = (await res.json()) as Partial<GoogleLoginConfig>;
		return {
			enabled: Boolean(body.enabled),
			mode: body.mode || 'off',
			buttonLabel: body.buttonLabel || ''
		};
	} catch {
		return empty;
	}
}

export function googleStartUrl(orgId: string): string {
	const base = authBackendUrl() || API_BASE;
	const redirectUri = `${window.location.origin}/auth/google/callback`;
	const url = new URL(`${base}/sso/google/start`);
	url.searchParams.set('orgId', orgId);
	url.searchParams.set('redirectUri', redirectUri);
	return url.toString();
}
