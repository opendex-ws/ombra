import { describe, expect, test, vi, afterEach } from 'vitest';
import { openSafeUrl, safeUrl } from './safeUrl';

describe('safeUrl', () => {
	test('allows http, https, and tg deep links', () => {
		expect(safeUrl('https://x.com/foo')).toBe('https://x.com/foo');
		expect(safeUrl('http://example.com/path')).toBe('http://example.com/path');
		expect(safeUrl('tg://resolve?domain=foo')).toBe('tg://resolve?domain=foo');
		expect(safeUrl('  HTTPS://Example.COM/a  ')).toBe('https://example.com/a');
	});

	test('rejects dangerous and relative schemes', () => {
		expect(safeUrl('javascript:alert(1)')).toBeUndefined();
		expect(safeUrl('JAVASCRIPT:alert(1)')).toBeUndefined();
		expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
		expect(safeUrl('vbscript:msgbox(1)')).toBeUndefined();
		expect(safeUrl('file:///etc/passwd')).toBeUndefined();
		expect(safeUrl('//evil.com')).toBeUndefined();
		expect(safeUrl('/relative')).toBeUndefined();
		expect(safeUrl('')).toBeUndefined();
		expect(safeUrl(null)).toBeUndefined();
		expect(safeUrl(undefined)).toBeUndefined();
	});
});

describe('openSafeUrl', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test('opens only allowlisted urls', () => {
		const open = vi.fn();
		vi.stubGlobal('open', open);
		openSafeUrl('javascript:alert(1)');
		openSafeUrl('https://t.me/foo');
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith('https://t.me/foo', '_blank', 'noopener,noreferrer');
	});
});
