import type { components } from '$lib/api/v2.d.ts';

export type TokenHook = components['schemas']['TokenMarketAudit']['hook'];

export type HookBadge = {
	/** Dot fill: green for no hook or a reviewed-safe one, yellow unreviewed, red can block sells. */
	dotClass: string;
	textClass: string;
	/** Hover text, carrying the hook program address when there is one. */
	title: string;
	/** A hook exists at all, so compact surfaces can skip the common no-hook case. */
	hasHook: boolean;
};

const LABEL: Record<TokenHook, string> = {
	NONE: 'No transfer hook',
	SAFE: 'Transfer hook: safe (sells cannot be blocked)',
	UNKNOWN: 'Transfer hook: not reviewed',
	UNSAFE: 'Transfer hook: unsafe (can block sells)'
};

export function hookBadge(
	hook: TokenHook | null | undefined,
	hookAddress: string | null | undefined
): HookBadge {
	// Older payloads predate the field; treat absence as no hook rather than alarming.
	const state: TokenHook = hook ?? 'NONE';
	const title = hookAddress ? `${LABEL[state]}\n${hookAddress}` : LABEL[state];
	// Full literal class names: Tailwind only emits classes it can read in source.
	const { dotClass, textClass } =
		state === 'UNSAFE'
			? { dotClass: 'bg-red', textClass: 'text-red' }
			: state === 'UNKNOWN'
				? { dotClass: 'bg-yel', textClass: 'text-yel' }
				: { dotClass: 'bg-grn', textClass: 'text-g8' };
	return { dotClass, textClass, title, hasHook: state !== 'NONE' };
}

/** The three `TokenSecurityFilter` hook criteria. Each is tri-state on the API. */
export type HookFilterKey = 'hooked' | 'unknownHook' | 'unsafeHook';

export const HOOK_FILTERS: { key: HookFilterKey; label: string; title: string }[] = [
	{ key: 'hooked', label: 'Has hook', title: 'Any Token-2022 transfer hook' },
	{ key: 'unknownHook', label: 'Unreviewed hook', title: 'Hook not reviewed yet' },
	{ key: 'unsafeHook', label: 'Unsafe hook', title: 'Hook can block sells (likely honeypot)' }
];

/** `true` keeps only matching tokens, `false` hides them, `null` adds no constraint. */
export type TriState = boolean | null;

/** Scanner filters persist as URL strings; anything else means "no constraint". */
export function triFromString(value: string | null | undefined): TriState {
	return value === 'true' ? true : value === 'false' ? false : null;
}

export function triToString(value: TriState): string {
	return value === null ? '' : String(value);
}

/** Only the criteria actually set, so an untouched filter sends nothing. */
export function hookSecurityFilter(
	values: Partial<Record<HookFilterKey, TriState>>
): Partial<Record<HookFilterKey, boolean>> {
	const out: Partial<Record<HookFilterKey, boolean>> = {};
	for (const { key } of HOOK_FILTERS) {
		const v = values[key];
		if (v === true || v === false) out[key] = v;
	}
	return out;
}
