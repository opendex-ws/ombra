import type { components } from '$lib/api/v2.d.ts';

export type PoolAssessment = components['schemas']['PoolAssessmentProjection'];

export type PoolSafetyView = {
	label: string;
	reviewState: components['schemas']['PoolReviewState'];
	hookPresence: components['schemas']['PoolHookPresence'];
	hookLabel: string;
	blocksTrade: false;
	dotClass: string;
	chipClass: string;
	title: string;
	details: { label: string; value: string }[];
};

const REVIEW_LABEL: Record<PoolSafetyView['reviewState'], string> = {
	UNKNOWN: 'Unassessed pool component',
	REVIEWED: 'Reviewed pool component',
	UNSAFE: 'Unsafe pool component'
};

const HOOK_LABEL: Record<PoolSafetyView['hookPresence'], string> = {
	UNKNOWN: 'Pool hook: unknown',
	NONE: 'Pool hook: none observed',
	PRESENT: 'Pool hook: present'
};

const REASON_LABEL: Record<components['schemas']['PoolReviewReason'], string> = {
	UNASSESSED: 'No current review',
	IDENTITY_UNVERIFIED: 'Component identity could not be verified',
	IDENTITY_CHANGED: 'Review revoked: component identity changed',
	IDENTITY_STALE: 'Review stale: identity observation expired'
};

function identityDetails(
	label: string,
	identity: components['schemas']['ComponentIdentity'] | null | undefined
): PoolSafetyView['details'] {
	return [
		{ label, value: identity?.address ?? 'Unknown' },
		{ label: `${label} code hash`, value: identity?.codeHash ?? 'Unknown' },
		{ label: `${label} implementation`, value: identity?.implementation ?? 'Not recorded' },
		{ label: `${label} implementation code hash`, value: identity?.implementationCodeHash ?? 'Not recorded' },
		{ label: `${label} configuration hash`, value: identity?.configHash ?? 'Unknown' }
	];
}

export function poolSafetyView(assessment: PoolAssessment | null | undefined): PoolSafetyView {
	const reviewState = assessment?.reason || !assessment?.identityVerified
		? 'UNKNOWN'
		: assessment.reviewState === 'REVIEWED' || assessment.reviewState === 'UNSAFE'
			? assessment.reviewState
			: 'UNKNOWN';
	const hookPresence = assessment?.hookPresence === 'PRESENT' || assessment?.hookPresence === 'NONE'
		? assessment.hookPresence
		: 'UNKNOWN';
	const label = REVIEW_LABEL[reviewState];
	const hookLabel = HOOK_LABEL[hookPresence];
	const pool = assessment?.pool;
	const stamp = assessment?.stamp;
	const details: PoolSafetyView['details'] = [
		{ label: 'Review state', value: reviewState },
		{ label: 'Hook presence', value: hookLabel },
		{ label: 'Chain', value: pool ? String(pool.chainId) : 'Unknown' },
		{ label: 'Pool', value: pool?.poolId ?? 'Unknown' },
		{ label: 'Manager', value: pool?.manager ?? 'Unknown' },
		{ label: 'Protocol', value: pool?.protocol ?? 'Unknown' }
	];
	if (pool) {
		if (pool.factory) details.push({ label: 'Factory', value: pool.factory });
		if (pool.poolAddress) details.push({ label: 'Pool address', value: pool.poolAddress });
		details.push({ label: 'Token 0', value: pool.token0 }, { label: 'Token 1', value: pool.token1 });
	}
	details.push(
		...identityDetails('Observed component', assessment?.component),
		{ label: 'Identity verified', value: assessment?.identityVerified ? 'Yes' : 'No' },
		{ label: 'Review source', value: assessment?.reviewSource ?? 'Not recorded' },
		{ label: 'Review version', value: assessment?.reviewVersion == null ? 'Not recorded' : String(assessment.reviewVersion) },
		...identityDetails('Reviewed component', assessment?.reviewedIdentity)
	);
	if (assessment?.reason) {
		details.push({ label: 'Review reason', value: REASON_LABEL[assessment.reason] ?? 'Unknown review reason' });
	} else if (reviewState === 'UNKNOWN') {
		details.push({ label: 'Review reason', value: assessment?.identityVerified ? 'No current review' : 'Assessment or verified identity unavailable' });
	}
	if (stamp) {
		details.push(
			{ label: 'Observed block', value: String(stamp.blockNumber) },
			{ label: 'Block hash', value: stamp.blockHash },
			{ label: 'Transaction', value: stamp.transactionHash },
			{ label: 'Log index', value: String(stamp.logIndex) },
			{ label: 'Event time (Unix seconds)', value: String(stamp.eventTime) },
			{ label: 'Observed at (Unix seconds)', value: String(stamp.observedAt) }
		);
	}
	details.push({
		label: 'Scope',
		value: 'This review applies to this pool component and recorded identity only. Execution capability is checked separately.'
	});
	return {
		label,
		reviewState,
		hookPresence,
		hookLabel,
		blocksTrade: false,
		dotClass: reviewState === 'UNSAFE' ? 'bg-red' : reviewState === 'REVIEWED' ? 'bg-grn' : 'bg-yel',
		chipClass: reviewState === 'UNSAFE' ? 'bg-red/10 text-red' : reviewState === 'REVIEWED' ? 'bg-grn/10 text-grn' : 'bg-yel/10 text-yel',
		title: [label, ...details.map((detail) => `${detail.label}: ${detail.value}`)].join('\n'),
		details
	};
}
