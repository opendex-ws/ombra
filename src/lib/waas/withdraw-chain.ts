import type { WalletAsset, components } from '$lib/api/types';

export type WithdrawChain = 'SOL' | 'ETH' | 'BSC' | 'BASE' | 'RH';

type WalletWithdrawResponse = components['schemas']['WalletWithdrawResponse'];

export const EVM_WITHDRAW_CHAINS: readonly WithdrawChain[] = ['ETH', 'BSC', 'BASE', 'RH'];
export const WITHDRAW_CHAINS: readonly WithdrawChain[] = ['SOL', 'ETH', 'BSC', 'BASE', 'RH'];

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isWithdrawChain(chain: string): chain is WithdrawChain {
	return (WITHDRAW_CHAINS as readonly string[]).includes(chain);
}

export function isEvmChain(chain: string): boolean {
	return (EVM_WITHDRAW_CHAINS as readonly string[]).includes(chain);
}

export function withdrawChainName(chain: WithdrawChain): string {
	switch (chain) {
		case 'SOL':
			return 'Solana';
		case 'ETH':
			return 'Ethereum';
		case 'BSC':
			return 'BNB Chain';
		case 'BASE':
			return 'Base';
		case 'RH':
			return 'Robinhood';
	}
}

export function nativeSymbol(chain: WithdrawChain): string {
	switch (chain) {
		case 'SOL':
			return 'SOL';
		case 'BSC':
			return 'BNB';
		default:
			return 'ETH';
	}
}

export function withdrawAddressPlaceholder(chain: WithdrawChain): string {
	return isEvmChain(chain) ? '0x address' : 'Solana address';
}

export function withdrawSourceLabel(chain: WithdrawChain): string {
	return `From your managed ${withdrawChainName(chain)} wallet`;
}

export function invalidAddressMessage(chain: WithdrawChain): string {
	if (chain === 'SOL') return 'Enter a valid Solana address';
	return `Enter a valid ${withdrawChainName(chain)} address (0x and 40 hex characters)`;
}

function base58Length(text: string): number {
	if (text === '') return -1;
	const bytes: number[] = [];
	let leadingOnes = 0;
	for (const ch of text) {
		let carry = BASE58_ALPHABET.indexOf(ch);
		if (carry < 0) return -1;
		for (let i = 0; i < bytes.length; i++) {
			carry += bytes[i] * 58;
			bytes[i] = carry & 0xff;
			carry >>= 8;
		}
		while (carry > 0) {
			bytes.push(carry & 0xff);
			carry >>= 8;
		}
	}
	for (const ch of text) {
		if (ch !== '1') break;
		leadingOnes++;
	}
	return leadingOnes + bytes.length;
}

export function isValidWithdrawAddress(chain: WithdrawChain, address: string): boolean {
	const trimmed = address.trim();
	if (isEvmChain(chain)) return EVM_ADDRESS_PATTERN.test(trimmed);
	return base58Length(trimmed) === 32;
}

export function formatAtomic(atomic: string, decimals: number): string {
	if (!/^\d+$/.test(atomic) || !Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
		return atomic;
	}
	const digits = atomic.replace(/^0+/, '').padStart(decimals + 1, '0');
	const integer = digits.slice(0, digits.length - decimals);
	const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
	return fraction === '' ? integer : `${integer}.${fraction}`;
}

export function hasFeeInfo(prepared: WalletWithdrawResponse): boolean {
	return (
		prepared.funding != null ||
		(typeof prepared.networkFeeAtomic === 'string' && prepared.networkFeeAtomic !== '') ||
		(typeof prepared.sponsorFeeAtomic === 'string' && prepared.sponsorFeeAtomic !== '')
	);
}

export function describeWithdrawFee(
	prepared: WalletWithdrawResponse,
	chain: WithdrawChain,
	asset: WalletAsset,
	chainAssets: readonly WalletAsset[]
): string[] {
	const lines: string[] = [];
	const funding = prepared.funding;
	if (funding && funding.mode === 'sponsored') {
		const feeToken = [asset, ...chainAssets].find(
			(candidate) => candidate.token.address.toLowerCase() === funding.feeTokenAddress?.toLowerCase()
		);
		lines.push(
			feeToken
				? `Sponsor fee: ${formatAtomic(funding.feeAmountBaseUnits, feeToken.token.decimals)} ${feeToken.token.symbol}`
				: `Sponsor fee: ${funding.feeAmountBaseUnits} base units of ${funding.feeTokenAddress ?? 'the fee token'}`
		);
	}
	if (funding && funding.mode === 'wallet') {
		lines.push(`Network fee: paid in ${nativeSymbol(chain)} from your managed wallet`);
	}
	if (funding) {
		lines.push(
			`Recipient receives: ${formatAtomic(funding.recipientAmountBaseUnits, asset.token.decimals)} ${asset.token.symbol}`
		);
	}
	const networkFee = prepared.networkFeeAtomic;
	if (typeof networkFee === 'string' && networkFee !== '') {
		const feeAsset = prepared.networkFeeAsset ?? 'SOL';
		lines.push(
			feeAsset === 'SOL'
				? `Network fee: ${formatAtomic(networkFee, 9)} SOL`
				: `Network fee: ${networkFee} base units of ${feeAsset}`
		);
	}
	const sponsorFee = prepared.sponsorFeeAtomic;
	if (typeof sponsorFee === 'string' && sponsorFee !== '') {
		lines.push(`Sponsor fee: ${formatAtomic(sponsorFee, 6)} USDC`);
	}
	return lines;
}
