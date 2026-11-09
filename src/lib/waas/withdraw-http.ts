import { OwnerProofError } from './owner-proof';
import { WithdrawParamsError } from './withdraw-params';

export const WITHDRAW_SYNCING_MESSAGE = 'Wallet policy is still syncing. Wait a few seconds and try again.';

export class WithdrawHttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | null,
		message: string,
		readonly retryable: boolean,
		readonly retryAfterSeconds: number | null
	) {
		super(message);
		this.name = 'WithdrawHttpError';
	}
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function readWithdrawResponse<T>(response: Response): Promise<T> {
	const text = await response.text().catch(() => '');
	let payload: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			payload = parsed as Record<string, unknown>;
		}
	} catch {
		payload = null;
	}
	if (response.ok) {
		if (payload !== null) return payload as T;
		throw new WithdrawHttpError(
			response.status,
			'INVALID_RESPONSE',
			'Withdrawal failed: the server sent an invalid response',
			false,
			null
		);
	}
	const code = nonEmptyString(payload?.code) ?? nonEmptyString(payload?.error);
	const retryAfterHeader = response.headers.get('Retry-After')?.trim() ?? '';
	const retryAfterSeconds = /^\d+$/.test(retryAfterHeader) ? Number.parseInt(retryAfterHeader, 10) : null;
	if (response.status === 503) {
		// Only the policy-syncing 503 gets the syncing text; any other 503 shows the server's reason.
		const serverMessage = nonEmptyString(payload?.message) ?? nonEmptyString(payload?.error);
		const syncing = !serverMessage || /still syncing/i.test(serverMessage);
		const message = syncing ? WITHDRAW_SYNCING_MESSAGE : `${serverMessage}. Try again.`;
		throw new WithdrawHttpError(503, code, message, true, retryAfterSeconds);
	}
	const message =
		nonEmptyString(payload?.message) ??
		nonEmptyString(payload?.error) ??
		`Withdrawal failed (HTTP ${response.status})`;
	const retryable = payload?.retryable === true || response.status >= 500;
	throw new WithdrawHttpError(response.status, code, message, retryable, retryAfterSeconds);
}

export function withdrawErrorMessage(cause: unknown): string {
	if (cause instanceof WithdrawHttpError) return cause.message;
	if (cause instanceof OwnerProofError || cause instanceof WithdrawParamsError) return cause.code;
	if (cause instanceof Error) return cause.message;
	return 'Withdrawal failed';
}
