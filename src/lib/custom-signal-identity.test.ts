import { describe, expect, it } from 'vitest';
import { avatarInitial, callerMetaDisplayEntries, integrationCallerMarkerKey, integrationSourcePresentation, isIntegrationSource, sourceBadge, tokenCallSourceBadge, typeBadge } from '$lib/utils/format';
import { makeWatchlistCallerSelection } from '$lib/stores/watchlist.svelte';

const integrationCaller = {
	type: 'INTEGRATION' as const,
	id: 'caller-uuid',
	name: 'Same public name',
	photoId: 'caller-photo',
	integrationId: 'integration-a',
	integrationName: 'Signal desk',
	integrationPhotoId: 'integration-photo'
};

describe('custom signal identity', () => {
	it('preserves the built-in caller selection shape', () => {
		expect(makeWatchlistCallerSelection('built-in-caller')).toEqual({
			id: 'built-in-caller',
			sourceType: 'CALLER'
		});
		expect(integrationCallerMarkerKey({ type: 'CALLER', id: 'built-in-caller', name: 'Alpha' })).toBeNull();
	});

	it('keeps the integration scope in a pending caller selection', () => {
		expect(makeWatchlistCallerSelection('caller-uuid', 'INTEGRATION', 'integration-a')).toEqual({
			id: 'caller-uuid',
			sourceType: 'INTEGRATION',
			integrationId: 'integration-a'
		});
	});

	it('groups chart markers by opaque caller and integration IDs, not display name', () => {
		expect(integrationCallerMarkerKey(integrationCaller)).toBe('integration:integration-a:caller-uuid');
		expect(integrationCallerMarkerKey({
			...integrationCaller,
			id: 'other-caller-uuid'
		})).not.toBe(integrationCallerMarkerKey(integrationCaller));
		expect(integrationCallerMarkerKey({
			...integrationCaller,
			integrationId: 'integration-b'
		})).not.toBe(integrationCallerMarkerKey(integrationCaller));
	});

	it('builds chart identity presentation from managed avatar IDs', () => {
		expect(isIntegrationSource(integrationCaller)).toBe(true);
		expect(integrationSourcePresentation(integrationCaller)).toEqual({
			callerName: 'Same public name',
			callerPhotoUrl: '/v2/avatar/caller-photo',
			integrationName: 'Signal desk',
			integrationPhotoUrl: '/v2/avatar/integration-photo'
		});
	});

	it('rejects incomplete integration identities instead of hiding contract errors', () => {
		const { integrationName: _integrationName, ...missingIntegrationName } = integrationCaller;
		expect(isIntegrationSource(missingIntegrationName)).toBe(false);
		expect(integrationSourcePresentation(missingIntegrationName)).toBeNull();
	});

	it('keeps emoji-leading caller and integration avatar fallbacks grapheme-safe', () => {
		const noPhotoIdentity = {
			...integrationCaller,
			name: '👩🏽‍💻 Caller',
			photoId: null,
			integrationName: '🚀 Signals',
			integrationPhotoId: null
		};
		const presentation = integrationSourcePresentation(noPhotoIdentity);
		expect(presentation?.callerPhotoUrl).toBeNull();
		expect(presentation?.integrationPhotoUrl).toBeNull();
		expect(avatarInitial(presentation?.callerName)).toBe('👩🏽‍💻');
		expect(avatarInitial(presentation?.integrationName)).toBe('🚀');
	});

	it('uses locale-independent uppercase initials', () => {
		expect(avatarInitial('istanbul')).toBe('I');
	});

	it('uses the integration badge styles', () => {
		expect(typeBadge('INTEGRATION')).toContain('text-pnk');
		expect(sourceBadge('INTEGRATION')).toContain('text-pnk');
		expect(tokenCallSourceBadge('INTEGRATION')).toContain('text-pnk');
	});

	it.each(['CALLER', 'TG', 'LIST', 'WALLET', 'THESIS'])(
		'keeps the old neutral token-call badge for %s',
		(sourceType) => {
			expect(tokenCallSourceBadge(sourceType)).toBe('bg-wh/10 text-g6');
		}
	);
});

describe('custom signal metadata display', () => {
	it('returns no rows for a built-in call without caller metadata', () => {
		expect(callerMetaDisplayEntries(undefined)).toEqual([]);
	});

	it('hides the server-owned integration ID and keeps owner field keys unchanged', () => {
		expect(callerMetaDisplayEntries({
			integrationId: 'integration-a',
			Followers: 1000,
			tag_group: ['dog', 'college'],
			verified: false
		})).toEqual([
			{ key: 'Followers', value: '1000' },
			{ key: 'tag_group', value: 'dog, college' },
			{ key: 'verified', value: 'false' }
		]);
	});
});
