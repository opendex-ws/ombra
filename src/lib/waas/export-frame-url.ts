import { authBackendBase } from './auth-base';
import { ownerOrigins } from './owner-protocol';

/** The export frame is served by auth-backend at `<auth origin>/auth/wallet-export/`. */
function configuredFrame(): { frameUrl: string; frame: string } | null {
	try {
		const auth = new URL(authBackendBase()).origin;
		const app = typeof location === 'undefined' ? 'https://owner-config.invalid' : location.origin;
		return ownerOrigins(app, `${auth}/`, `${auth}/auth/wallet-export/`);
	} catch {
		return null;
	}
}

export function exportFrameUrl(): string {
	return configuredFrame()?.frameUrl ?? '';
}

export function exportFrameOrigin(): string {
	return configuredFrame()?.frame ?? '';
}
