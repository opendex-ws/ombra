import { API_BASE } from '$lib/api/config';
import { authBackendUrl } from '$lib/auth/google';

export function authBackendBase(): string {
	return authBackendUrl() || API_BASE;
}
