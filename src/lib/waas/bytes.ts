export function toHex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

export function fromHex(hex: string): Uint8Array {
	if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('HEX_INVALID');
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

export function b64uEncode(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(text: string): Uint8Array {
	const body = text.replace(/=+$/, '');
	if (body.length === 0 || !/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('B64U_INVALID');
	let bin: string;
	try {
		bin = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
	} catch {
		throw new Error('B64U_INVALID');
	}
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function utf8Encode(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}
