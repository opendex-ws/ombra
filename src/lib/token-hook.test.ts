import { describe, expect, it } from 'vitest';
import { HOOK_FILTERS, hookBadge, hookSecurityFilter, triFromString, triToString } from '$lib/utils/token-hook';

const HOOK = 'HookProgram1111111111111111111111111111111';

describe('hookBadge', () => {
	it('is green for no hook and for a reviewed-safe hook', () => {
		expect(hookBadge('NONE', null).dotClass).toBe('bg-grn');
		expect(hookBadge('SAFE', HOOK).dotClass).toBe('bg-grn');
	});

	it('is yellow when the hook has not been reviewed', () => {
		expect(hookBadge('UNKNOWN', HOOK).dotClass).toBe('bg-yel');
	});

	it('is red when the hook can block sells', () => {
		const b = hookBadge('UNSAFE', HOOK);
		expect(b.dotClass).toBe('bg-red');
		expect(b.textClass).toBe('text-red');
	});

	it('puts the hook program address in the hover text', () => {
		expect(hookBadge('UNSAFE', HOOK).title).toContain(HOOK);
		expect(hookBadge('NONE', null).title).toBe('No transfer hook');
	});

	it('treats a payload without the field as no hook', () => {
		const b = hookBadge(undefined, undefined);
		expect(b.dotClass).toBe('bg-grn');
		expect(b.hasHook).toBe(false);
	});

	it('flags every hooked state, so compact surfaces can show them', () => {
		expect(hookBadge('SAFE', HOOK).hasHook).toBe(true);
		expect(hookBadge('UNKNOWN', HOOK).hasHook).toBe(true);
		expect(hookBadge('UNSAFE', HOOK).hasHook).toBe(true);
	});
});

describe('hook filters', () => {
	it('covers exactly the three spec criteria', () => {
		expect(HOOK_FILTERS.map((f) => f.key)).toEqual(['hooked', 'unknownHook', 'unsafeHook']);
	});

	it('sends only the criteria that are set, preserving false', () => {
		expect(hookSecurityFilter({ hooked: true, unknownHook: null, unsafeHook: false })).toEqual({
			hooked: true,
			unsafeHook: false
		});
	});

	it('sends nothing when untouched', () => {
		expect(hookSecurityFilter({})).toEqual({});
		expect(hookSecurityFilter({ hooked: null, unknownHook: null, unsafeHook: null })).toEqual({});
	});

	it('round-trips the URL string form', () => {
		for (const v of [true, false, null] as const) expect(triFromString(triToString(v))).toBe(v);
		expect(triFromString('garbage')).toBeNull();
	});
});
