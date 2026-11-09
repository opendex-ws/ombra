import type { Address, Hex } from 'viem';
import { sha256, toHex, utf8Encode } from './bytes';
import { toBaseUnits } from './withdraw-params';
import { formatAtomic, type WithdrawChain } from './withdraw-chain';
import type { components } from '$lib/api/types';
import {
	OwnerProofError,
	readOwnerProofPreview,
	type OwnerProof,
	type OwnerProofKind,
	type OwnerProofPreview
} from './owner-proof';

type WalletWithdrawResponse = components['schemas']['WalletWithdrawResponse'];
type WalletWithdrawSignatureModel = components['schemas']['WalletWithdrawSignatureModel'];

export type PreparedWithdrawal = Omit<WalletWithdrawResponse, 'signatureModel'> & {
	signatureModel: WalletWithdrawSignatureModel | 'owner_proof';
	ownerProof?: unknown;
};

export interface WithdrawOwnerProof extends OwnerProofPreview {
	kind: OwnerProofKind;
}

export type OwnerProofConfirmProof =
	| { kind: 'wallet'; signature: string; ts: number }
	| { kind: 'google'; idToken: string; ts: number };

export interface OwnerProofConfirmBody {
	transactionToSign: string;
	previewId: string;
	ownerProof: OwnerProofConfirmProof;
}

export function readWithdrawOwnerProof(prepared: PreparedWithdrawal): WithdrawOwnerProof | null {
	if (prepared.signatureModel !== 'owner_proof') return null;
	const raw = prepared.ownerProof;
	if (!raw || typeof raw !== 'object') throw new OwnerProofError('OWNER_PROOF_PREVIEW_INVALID');
	const kind = (raw as Record<string, unknown>).kind;
	if (kind !== 'wallet' && kind !== 'google') throw new OwnerProofError('OWNER_PROOF_PREVIEW_INVALID');
	const preview = readOwnerProofPreview(raw);
	return {
		message: preview.message,
		ts: preview.ts,
		validUntil: preview.validUntil,
		ref: preview.ref,
		previewId: preview.previewId,
		kind
	};
}

export function ownerProofConfirmBody(transactionToSign: string, proof: OwnerProof, previewId: string): OwnerProofConfirmBody {
	if (!/^pv2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(previewId)) throw new OwnerProofError('OWNER_PROOF_PREVIEW_INVALID');
	if (proof.kind === 'wallet') {
		return { transactionToSign, previewId, ownerProof: { kind: 'wallet', signature: proof.sig, ts: proof.ts } };
	}
	return { transactionToSign, previewId, ownerProof: { kind: 'google', idToken: proof.id_token, ts: proof.ts } };
}


export interface WithdrawReviewInput {
	chain: WithdrawChain;
	amount: string;
	decimals: number;
	tokenAddress: string;
	destinationAddress: string;
	symbol: string;
	userId: string;
	orgId: string;
}

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new OwnerProofError('WITHDRAWAL_REVIEW_MISMATCH');
	return value as Record<string, unknown>;
}

function canonical(value: unknown): string {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
	}
	return JSON.stringify(value);
}

export async function reviewRhWithdrawal(prepared: PreparedWithdrawal, input: WithdrawReviewInput) {
	try {
		const preview = readWithdrawOwnerProof(prepared);
		if (!preview || input.chain !== 'RH' || !input.userId || !input.orgId) throw new Error();
		const wrapper = exactRecord(JSON.parse(prepared.transactionToSign), ['version','kind','turnkeyBody','intent']);
		if (wrapper.version !== 2 || wrapper.kind !== 'rh_sponsored_withdrawal' || typeof wrapper.turnkeyBody !== 'string') throw new Error();
		const i = exactRecord(wrapper.intent, ['kind','chain_id','user','executor','token','recipient','amount','fee_token','fee_recipient','fee_amount','nonce','deadline','owner_action_hash']);
		if (i.kind !== wrapper.kind || i.chain_id !== 4663) throw new Error();
		for (const key of ['user','executor','token','recipient','fee_token','fee_recipient']) {
			if (typeof i[key] !== 'string' || !/^0x[0-9a-f]{40}$/.test(i[key] as string)) throw new Error();
		}
		for (const key of ['amount','fee_amount','nonce','deadline']) {
			if (typeof i[key] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(i[key] as string) || BigInt(i[key] as string) >= 2n ** 256n) throw new Error();
		}
		const a = i as Record<string, string>;
		if (a.recipient !== input.destinationAddress || a.token !== input.tokenAddress || a.amount !== toBaseUnits(input.amount,input.decimals) || BigInt(a.amount) === 0n ||
			a.fee_token !== '0x5fc5360d0400a0fd4f2af552add042d716f1d168' || a.fee_recipient === a.user || /^0x0{40}$/.test(a.fee_recipient)) throw new Error();
		const params = {wallet:a.user,...Object.fromEntries(Object.entries(i).filter(([key]) => !['kind','user','owner_action_hash'].includes(key)))};
		const commitment = toHex(await sha256(utf8Encode(canonical({v:2,action:'social_withdraw',org_id:input.orgId,user_id:input.userId,params}))));
		if (a.owner_action_hash !== '0x' + commitment) throw new Error();
		const { hashTypedData } = await import('viem/utils');
		const digest = hashTypedData({domain:{name:'OpenDEX Robinhood Withdraw',version:'2',chainId:4663,verifyingContract:a.user as Address},primaryType:'SponsoredWithdrawal',types:{SponsoredWithdrawal:[{name:'executor',type:'address'},{name:'token',type:'address'},{name:'recipient',type:'address'},{name:'amount',type:'uint256'},{name:'feeToken',type:'address'},{name:'feeRecipient',type:'address'},{name:'feeAmount',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'},{name:'ownerActionHash',type:'bytes32'}]},message:{executor:a.executor as Address,token:a.token as Address,recipient:a.recipient as Address,amount:BigInt(a.amount),feeToken:a.fee_token as Address,feeRecipient:a.fee_recipient as Address,feeAmount:BigInt(a.fee_amount),nonce:BigInt(a.nonce),deadline:BigInt(a.deadline),ownerActionHash:a.owner_action_hash as Hex}});
		const raw = exactRecord(JSON.parse(wrapper.turnkeyBody), ['type','organizationId','timestampMs','parameters']);
		const parameters = exactRecord(raw.parameters,['signWith','payload','encoding','hashFunction']);
		if (raw.type !== 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2' || (typeof raw.organizationId !== 'string' || (raw.organizationId !== 'waas:' + input.userId && !(raw.organizationId.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.organizationId)))) || typeof raw.timestampMs !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw.timestampMs) ||
			parameters.signWith !== a.user || parameters.payload !== digest.slice(2) || parameters.encoding !== 'PAYLOAD_ENCODING_HEXADECIMAL' || parameters.hashFunction !== 'HASH_FUNCTION_NO_OP') throw new Error();
		const principalDisplay = formatAtomic(a.amount,input.decimals) + ' ' + input.symbol;
		const feeDisplay = formatAtomic(a.fee_amount,6) + ' USDG';
		const iso = (ts: number) => new Date(ts*1000).toISOString().replace('.000Z','Z');
		const message = `Withdraw\nSend ${principalDisplay}\nNetwork fee ${feeDisplay} (gas sponsored)\nfrom ${a.user}\nto   ${a.recipient}\nChain Robinhood (4663)\nPrincipal token ${a.token}\nPrincipal amount ${a.amount} raw units\nFee token ${a.fee_token}\nFee recipient ${a.fee_recipient}\nFee amount ${a.fee_amount} raw units\nExecutor ${a.executor}\nShared nonce ${a.nonce}\nExecution deadline ${a.deadline}\nOwner action v2\nIssued at ${preview.ts} (${iso(preview.ts)})\nValid until ${preview.validUntil} (${iso(preview.validUntil)})\nCommitment SHA-256 ${commitment}\nRef ${commitment.slice(0,8)}`;
		if (preview.message !== message) throw new Error();
		const funding = prepared.funding;
		if (funding && (funding.feeTokenAddress !== a.fee_token || funding.feeAmountBaseUnits !== a.fee_amount || funding.recipientAmountBaseUnits !== a.amount || String(funding.expiresAt) !== a.deadline)) throw new Error();
		const now = BigInt(Math.floor(Date.now()/1000));
		if (now >= BigInt(a.deadline) || Date.now() < preview.ts*1000 || Date.now() > preview.validUntil*1000) throw new OwnerProofError('PROOF_EXPIRED');
		if (BigInt(a.deadline) > now + 300n) throw new Error();
		return {recipient:a.recipient,principalAtomic:a.amount,principalDisplay,feeAtomic:a.fee_amount,feeDisplay,feeRecipient:a.fee_recipient,executor:a.executor,nonce:a.nonce,deadline:a.deadline,chainId:4663};
	} catch (cause) {
		if (cause instanceof OwnerProofError && cause.code === 'PROOF_EXPIRED') throw cause;
		throw new OwnerProofError('WITHDRAWAL_REVIEW_MISMATCH');
	}
}
