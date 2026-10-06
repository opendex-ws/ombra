export type ExactJsonNumber = Readonly<{ rawJSON: string }>;
export type JsonNumber = number | ExactJsonNumber;

type JsonWithRawNumbers = typeof JSON & {
	rawJSON: (text: string) => ExactJsonNumber;
	isRawJSON: (value: unknown) => boolean;
};

const json = JSON as JsonWithRawNumbers;

export function canonicalDecimalFromNumber(value: number): string {
	if (!Number.isFinite(value)) throw new Error('A finite JSON number is required');
	return canonicalDecimalFromText(String(Object.is(value, -0) ? 0 : value));
}

export function canonicalDecimalFromText(value: string): string {
	const source = value.trim().toLowerCase();
	const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/.exec(source);
	if (!match) throw new Error('A valid JSON number is required');
	const exponent = Number(match[5] ?? '0');
	if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
		throw new Error('Number is outside the supported range');
	}
	const negative = match[1] === '-';
	const whole = match[2] ?? '0';
	const fraction = match[3] ?? match[4] ?? '';
	const digits = `${whole}${fraction}`;
	const decimalAt = whole.length + exponent;
	let integer: string;
	let decimals: string;
	if (decimalAt <= 0) {
		integer = '0';
		decimals = `${'0'.repeat(-decimalAt)}${digits}`;
	} else if (decimalAt >= digits.length) {
		integer = `${digits}${'0'.repeat(decimalAt - digits.length)}`;
		decimals = '';
	} else {
		integer = digits.slice(0, decimalAt);
		decimals = digits.slice(decimalAt);
	}
	integer = integer.replace(/^0+(?=\d)/, '');
	decimals = decimals.replace(/0+$/, '');
	const normalized = decimals ? `${integer}.${decimals}` : integer;
	return /^0(?:\.0*)?$/.test(normalized) ? '0' : `${negative ? '-' : ''}${normalized}`;
}

export function isExactJsonNumber(value: unknown): value is ExactJsonNumber {
	return supportsExactJsonNumbers() && json.isRawJSON(value);
}

export function supportsExactJsonNumbers(): boolean {
	return typeof json.rawJSON === 'function' && typeof json.isRawJSON === 'function';
}

export function canonicalDecimalFromJsonNumber(value: JsonNumber): string {
	return isExactJsonNumber(value) ? canonicalDecimalFromText(value.rawJSON) : canonicalDecimalFromNumber(value);
}

export function jsonNumberFromText(value: string): JsonNumber {
	const canonical = canonicalDecimalFromText(value);
	const approximate = Number(canonical);
	if (Number.isFinite(approximate) && canonicalDecimalFromNumber(approximate) === canonical) {
		return Object.is(approximate, -0) ? 0 : approximate;
	}
	if (!supportsExactJsonNumbers()) throw new Error('Exact JSON numbers are not supported by this browser');
	return json.rawJSON(canonical);
}
