export type LoginMethod = 'wallet' | 'google';

const KEY = 'ombra_login_method';

export function getLoginMethod(): LoginMethod | null {
	if (typeof window === 'undefined') return null;
	try {
		const value = localStorage.getItem(KEY);
		return value === 'wallet' || value === 'google' ? value : null;
	} catch {
		return null;
	}
}

export function setLoginMethod(method: LoginMethod | null): void {
	if (typeof window === 'undefined') return;
	try {
		if (method === null) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, method);
	} catch {}
}
