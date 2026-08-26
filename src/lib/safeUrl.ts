const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'tg:']);

/** Allow http(s) and Telegram deep links; reject javascript:/data:/vbscript:/file: etc. */
export function safeUrl(raw: string | null | undefined): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	try {
		const url = new URL(trimmed);
		if (!ALLOWED_PROTOCOLS.has(url.protocol.toLowerCase())) return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

export function openSafeUrl(raw: string | null | undefined): void {
	const url = safeUrl(raw);
	if (url) window.open(url, '_blank', 'noopener,noreferrer');
}
