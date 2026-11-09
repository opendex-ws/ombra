import { concatBytes, fromHex, utf8Decode, utf8Encode } from './bytes';

export type ExportBundleErrorCode =
	| 'BUNDLE_FORMAT_INVALID'
	| 'BUNDLE_SIGNER_UNKNOWN'
	| 'BUNDLE_SIGNATURE_INVALID'
	| 'BUNDLE_DECRYPT_FAILED';

export class ExportBundleError extends Error {
	constructor(readonly code: ExportBundleErrorCode) {
		super(code);
		this.name = 'ExportBundleError';
	}
}

const KEM_SUITE = concatBytes(utf8Encode('KEM'), new Uint8Array([0x00, 0x10]));
const HPKE_SUITE = concatBytes(utf8Encode('HPKE'), new Uint8Array([0x00, 0x10, 0x00, 0x01, 0x00, 0x02]));
const HPKE_V1 = utf8Encode('HPKE-v1');
const EMPTY = new Uint8Array(0);

function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return new Uint8Array(bytes);
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const keyBytes = copy(key), dataBytes = copy(data);
	try {
		const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		return new Uint8Array(await crypto.subtle.sign('HMAC', k, dataBytes));
	} finally {
		keyBytes.fill(0);
		dataBytes.fill(0);
	}
}

function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
	return hmac(salt.length ? salt : new Uint8Array(32), ikm);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
	const out = new Uint8Array(length);
	let prev: Uint8Array = EMPTY;
	let filled = 0;
	for (let i = 1; filled < length; i++) {
		const input = concatBytes(prev, info, new Uint8Array([i]));
		prev.fill(0);
		try { prev = await hmac(prk, input); } finally { input.fill(0); }
		const take = Math.min(prev.length, length - filled);
		out.set(prev.subarray(0, take), filled);
		filled += take;
	}
	prev.fill(0);
	return out;
}

async function labeledExtract(suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array): Promise<Uint8Array> {
	const input = concatBytes(HPKE_V1, suite, utf8Encode(label), ikm);
	try { return await hkdfExtract(salt, input); } finally { input.fill(0); }
}

async function labeledExpand(
	suite: Uint8Array,
	prk: Uint8Array,
	label: string,
	info: Uint8Array,
	length: number
): Promise<Uint8Array> {
	const input = concatBytes(new Uint8Array([length >> 8, length & 255]), HPKE_V1, suite, utf8Encode(label), info);
	try { return await hkdfExpand(prk, input, length); } finally { input.fill(0); }
}

function derToRaw(der: Uint8Array): Uint8Array {
	if (der.length < 8 || der[0] !== 0x30 || der[1] >= 0x80 || der[1] !== der.length - 2) throw new Error('DER');
	let pos = 2;
	const out = new Uint8Array(64);
	for (let part = 0; part < 2; part++) {
		if (der[pos] !== 0x02) throw new Error('DER');
		const len = der[pos + 1];
		pos += 2;
		if (len === undefined || len === 0 || len >= 0x80 || pos + len > der.length) throw new Error('DER');
		let int = der.subarray(pos, pos + len);
		pos += len;
		let start = 0;
		while (start < int.length && int[start] === 0) start++;
		int = int.subarray(start);
		if (int.length > 32) throw new Error('DER');
		out.set(int, part * 32 + 32 - int.length);
	}
	if (pos !== der.length) throw new Error('DER');
	return out;
}

async function hpkeOpen(
	enc: Uint8Array,
	ciphertext: Uint8Array,
	targetPrivateKey: CryptoKey,
	pkR: Uint8Array,
	assertCurrent: () => void
): Promise<string> {
	const wipe: Uint8Array[] = [];
	try {
		const pkE = await crypto.subtle.importKey('raw', copy(enc), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
		assertCurrent();
		const dh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pkE }, targetPrivateKey, 256));
		wipe.push(dh);
		assertCurrent();
		const eaePrk = await labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dh);
		wipe.push(eaePrk);
		assertCurrent();
		const kemContext = concatBytes(enc, pkR);
		wipe.push(kemContext);
		const shared = await labeledExpand(KEM_SUITE, eaePrk, 'shared_secret', kemContext, 32);
		wipe.push(shared);
		assertCurrent();
		const pskIdHash = await labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY);
		wipe.push(pskIdHash);
		assertCurrent();
		const infoHash = await labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', utf8Encode('turnkey_hpke'));
		wipe.push(infoHash);
		assertCurrent();
		const context = concatBytes(new Uint8Array([0x00]), pskIdHash, infoHash);
		wipe.push(context);
		const secret = await labeledExtract(HPKE_SUITE, shared, 'secret', EMPTY);
		wipe.push(secret);
		assertCurrent();
		const key = await labeledExpand(HPKE_SUITE, secret, 'key', context, 32);
		wipe.push(key);
		assertCurrent();
		const nonce = await labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, 12);
		wipe.push(nonce);
		assertCurrent();
		const keyBytes = copy(key), nonceBytes = copy(nonce), aadBytes = copy(kemContext), cipherBytes = copy(ciphertext);
		wipe.push(keyBytes, nonceBytes, aadBytes, cipherBytes);
		const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
		assertCurrent();
		const plain = new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: nonceBytes, additionalData: aadBytes, tagLength: 128 },
				aesKey,
				cipherBytes
			)
		);
		wipe.push(plain);
		assertCurrent();
		return utf8Decode(plain);
	} catch {
		throw new ExportBundleError('BUNDLE_DECRYPT_FAILED');
	} finally {
		for (const bytes of wipe) bytes.fill(0);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export async function decryptExportBundle(
	bundle: string,
	targetPrivateKey: CryptoKey,
	targetPublicKey: Uint8Array,
	pinnedSigners?: readonly string[],
	assertCurrent: () => void = () => {}
): Promise<string> {
	let outer: unknown;
	try {
		outer = JSON.parse(bundle);
	} catch {
		throw new ExportBundleError('BUNDLE_FORMAT_INVALID');
	}
	if (
		!isRecord(outer) ||
		outer.version !== 'v1.0.0' ||
		typeof outer.data !== 'string' ||
		typeof outer.dataSignature !== 'string' ||
		typeof outer.enclaveQuorumPublic !== 'string'
	) {
		throw new ExportBundleError('BUNDLE_FORMAT_INVALID');
	}
	const { data, dataSignature, enclaveQuorumPublic } = outer as {
		data: string;
		dataSignature: string;
		enclaveQuorumPublic: string;
	};

	let signerKey: CryptoKey;
	try {
		if (!/^04[0-9a-fA-F]{128}$/.test(enclaveQuorumPublic)) throw new Error('SIGNER');
		const signerHex = enclaveQuorumPublic.toLowerCase();
		if (pinnedSigners && !pinnedSigners.some((p) => p.toLowerCase() === signerHex)) throw new Error('SIGNER');
		signerKey = await crypto.subtle.importKey(
			'raw',
			copy(fromHex(enclaveQuorumPublic)),
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify']
		);
	} catch {
		throw new ExportBundleError('BUNDLE_SIGNER_UNKNOWN');
	}

	assertCurrent();
	let dataBytes: Uint8Array;
	try {
		dataBytes = fromHex(data);
	} catch {
		throw new ExportBundleError('BUNDLE_FORMAT_INVALID');
	}

	let raw: Uint8Array = EMPTY;
	let enc: Uint8Array = EMPTY;
	let ciphertext: Uint8Array = EMPTY;
	try {
		try {
			raw = derToRaw(fromHex(dataSignature));
		} catch {
			throw new ExportBundleError('BUNDLE_SIGNATURE_INVALID');
		}
		let verified = false;
		try {
			verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signerKey, copy(raw), copy(dataBytes));
		} catch {
			verified = false;
		}
		assertCurrent();
		if (!verified) throw new ExportBundleError('BUNDLE_SIGNATURE_INVALID');

		try {
			const inner: unknown = JSON.parse(utf8Decode(dataBytes));
			if (!isRecord(inner) || typeof inner.encappedPublic !== 'string' || typeof inner.ciphertext !== 'string') {
				throw new Error('FORMAT');
			}
			enc = fromHex(inner.encappedPublic);
			ciphertext = fromHex(inner.ciphertext);
			if (enc.length !== 65 || enc[0] !== 0x04 || ciphertext.length < 16) throw new Error('FORMAT');
		} catch {
			throw new ExportBundleError('BUNDLE_FORMAT_INVALID');
		}

		return await hpkeOpen(enc, ciphertext, targetPrivateKey, targetPublicKey, assertCurrent);
	} finally {
		enc.fill(0);
		ciphertext.fill(0);
		dataBytes.fill(0);
		raw.fill(0);
	}
}
