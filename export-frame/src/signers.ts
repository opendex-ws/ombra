export const DEFAULT_EXPORT_SIGNER_PUBKEYS: readonly string[] = [
	'04ae830a23e513b16cdce0b3e3f040ae4bfca6adca13814a83d16fa526b0b9650231804a6c4001efcb3e9bfa41d7c048477d2a5646566289359e092705eb4b52e6'
];

const SIGNER_PUBKEY = /^04[0-9a-f]{128}$/;

export function parseSigners(value: string | null | undefined): string[] | null {
	if (value === null || value === undefined || value.trim() === '') return [...DEFAULT_EXPORT_SIGNER_PUBKEYS];
	const items = value.split(',').map((item) => item.trim().toLowerCase());
	return items.every((item) => SIGNER_PUBKEY.test(item)) ? items : null;
}
