import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
	ENTITY_ICON_SLUGS,
	EXECUTION_PROGRAM_ICON_SLUGS,
	getEntityIcon,
	getExecutionProgramIcon
} from './utils/entity-icons';

describe('entity icon registry', () => {
	test('keeps every registry entry backed by a local asset', () => {
		for (const slug of ENTITY_ICON_SLUGS) {
			const extension =
				slug === 'open-dex' ||
				slug === 'fomo' ||
				slug === 'direct' ||
				slug === 'padre' ||
				slug === 'generic-bot' ||
				slug === 'solana-mev-bot'
					? 'svg'
					: 'webp';
			expect(existsSync(resolve('static/entity-icons', `${slug}.${extension}`)), slug).toBe(true);
		}
	});

	test.each([
		['Kraken 1', 'kraken'],
		['Crypto.com', 'crypto-com'],
		['Huobi Global', 'htx'],
		['Circle CCTP', 'circle-cctp'],
		['AxiomBot2', 'axiom'],
		['PhotonNBot', 'photon'],
		['BBRouter', 'bb-router'],
		['minTcHY', 'mintc'],
		['Dexcelerate', 'open-dex'],
		['FOMO', 'fomo'],
		['DIRECT', 'direct'],
		['Padre.gg', 'padre'],
		['Pump Mayhem', 'pumpfun'],
		['SolanaMevBot', 'solana-mev-bot'],
		['GenericBot', 'generic-bot'],
		['GENERIC', 'generic-bot']
	])('resolves %s to %s', (label, slug) => {
		expect(getEntityIcon(label)?.slug).toBe(slug);
		expect(getEntityIcon(label)?.url.startsWith('/entity-icons/')).toBe(true);
	});

	test('does not invent a remote asset for an unknown label', () => {
		expect(getEntityIcon('Future Provider')).toBeNull();
	});

	test('uses canonical execution program IDs for local venue assets', () => {
		for (const [programId, slug] of Object.entries(EXECUTION_PROGRAM_ICON_SLUGS)) {
			expect(getExecutionProgramIcon(programId)?.slug, programId).toBe(slug);
		}
		expect(getExecutionProgramIcon('unknown-program')).toBeNull();
	});
});
