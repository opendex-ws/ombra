import type { WalletAsset } from '$lib/api/types';
import type { WithdrawChain } from './withdraw-chain';

export type WithdrawParamsErrorCode =
	| 'AMOUNT_INVALID'
	| 'AMOUNT_PRECISION'
	| 'DECIMALS_INVALID';

export class WithdrawParamsError extends Error {
	constructor(readonly code: WithdrawParamsErrorCode) {
		super(code);
		this.name = 'WithdrawParamsError';
	}
}

const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function toBaseUnits(amount: string, decimals: number): string {
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
		throw new WithdrawParamsError('DECIMALS_INVALID');
	}
	if (!AMOUNT_PATTERN.test(amount)) throw new WithdrawParamsError('AMOUNT_INVALID');
	const dot = amount.indexOf('.');
	const integer = dot === -1 ? amount : amount.slice(0, dot);
	const fraction = (dot === -1 ? '' : amount.slice(dot + 1)).replace(/0+$/, '');
	if (fraction.length > decimals) throw new WithdrawParamsError('AMOUNT_PRECISION');
	const units = (integer + fraction.padEnd(decimals, '0')).replace(/^0+/, '');
	return units === '' ? '0' : units;
}

/**
 * Mirrors backend api/src/routes/v2/user/withdraw.rs: WITHDRAWAL_FEE_LAMPORTS (the managed
 * wallet pays one 5000-lamport signature fee, no priority fee) and the rent-exempt minimum
 * of a 0-byte account (getMinimumBalanceForRentExemption([0])).
 */
export const SOL_WITHDRAWAL_FEE_LAMPORTS = 5_000n;
export const SOL_RENT_EXEMPT_MINIMUM_LAMPORTS = 890_880n;
const SOL_DECIMALS = 9;

export function fromBaseUnits(units: bigint, decimals: number): string {
	const digits = units.toString().padStart(decimals + 1, '0');
	const integer = digits.slice(0, digits.length - decimals);
	const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
	return fraction === '' ? integer : `${integer}.${fraction}`;
}

function isNativeSol(chain: WithdrawChain, asset: WalletAsset): boolean {
	return chain === 'SOL' && asset.isNative;
}

function solBalanceLamports(asset: WalletAsset): bigint | null {
	try {
		return BigInt(toBaseUnits(asset.tokensBalanceStr.trim(), SOL_DECIMALS));
	} catch {
		return null;
	}
}

/**
 * The lamports the backend will actually transfer for a native SOL request
 * (owner_paid_native_amount, and sponsored_native_amount when the balance cannot pay the
 * fee). null when the backend rejects the request anyway (zero or above the balance).
 */
export function solTransferLamports(balance: bigint, requested: bigint): bigint | null {
	if (requested <= 0n || requested > balance) return null;
	const spendable = balance - SOL_WITHDRAWAL_FEE_LAMPORTS;
	if (spendable <= 0n) {
		const remaining = balance - requested;
		return remaining > 0n && remaining < SOL_RENT_EXEMPT_MINIMUM_LAMPORTS ? balance : requested;
	}
	const remaining = spendable > requested ? spendable - requested : 0n;
	if (requested >= spendable || (remaining > 0n && remaining < SOL_RENT_EXEMPT_MINIMUM_LAMPORTS)) return spendable;
	return requested;
}

/** Amount the Max button fills in: what the backend can send in full, fee already kept back. */
export function maxWithdrawAmount(chain: WithdrawChain, asset: WalletAsset): string {
	if (!isNativeSol(chain, asset)) return asset.tokensBalanceStr;
	const balance = solBalanceLamports(asset);
	if (balance === null || balance <= 0n) return asset.tokensBalanceStr;
	const lamports = solTransferLamports(balance, balance);
	return lamports === null ? asset.tokensBalanceStr : fromBaseUnits(lamports, SOL_DECIMALS);
}

export interface WithdrawAmount {
	amount: string;
	/** The backend would send a different amount, so this one replaces what was typed. */
	adjusted: boolean;
}

/**
 * The amount to send: the backend transfers this exact amount. Only native SOL is ever
 * adjusted; any amount the backend rejects anyway is returned unchanged.
 */
export function effectiveWithdrawAmount(chain: WithdrawChain, asset: WalletAsset, amount: string): WithdrawAmount {
	const unchanged = { amount, adjusted: false };
	if (!isNativeSol(chain, asset)) return unchanged;
	const balance = solBalanceLamports(asset);
	if (balance === null) return unchanged;
	let requested: bigint;
	try {
		requested = BigInt(toBaseUnits(amount.trim(), SOL_DECIMALS));
	} catch {
		return unchanged;
	}
	const lamports = solTransferLamports(balance, requested);
	if (lamports === null || lamports === requested) return unchanged;
	return { amount: fromBaseUnits(lamports, SOL_DECIMALS), adjusted: true };
}
