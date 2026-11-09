import type { components } from '$lib/api/v2.d.ts';
import { getRouterInfo, getRouterIconForChain, isRhChain } from './routers';

type TokenSnapshot = components['schemas']['TokenSnapshotBase'];

export type VenueviewInput = Partial<
	Pick<TokenSnapshot, 'executionProtocol' | 'launchOrigin' | 'capability'>
> & {
	chain?: components['schemas']['Chain'] | string | number | null;
	platformType?: components['schemas']['VenueLabel'] | null;
	executionApp?: string | null;
};

export type VenueviewOutput = {
	currentLabel: string;
	originLabel: string | null;
	protocolLabel: string | null;
	executionApp: string | null;
	icon: string | null;
	originIcon: string | null;
	title: string;
};

export function venueView(input: VenueviewInput): VenueviewOutput {
	const current = getRouterInfo(input.platformType ?? '', input.chain);
	const origin =
		isRhChain(input.chain) && input.launchOrigin?.chainId === 4663
			? getRouterInfo(input.launchOrigin.platformType, input.chain)
			: null;
	const protocolLabel = input.executionProtocol
		? input.executionProtocol === 'SLIPSTREAM'
			? 'Slipstream'
			: getRouterInfo(input.executionProtocol, input.chain).name
		: null;
	return {
		currentLabel: current.name,
		originLabel: origin?.name ?? null,
		protocolLabel,
		executionApp: input.executionApp ?? null,
		icon: input.chain == null
			? current.icon || null
			: getRouterIconForChain(input.platformType ?? '', input.chain) || null,
		originIcon: origin?.icon || null,
		title: protocolLabel ? `${current.name} · ${protocolLabel}` : current.name
	};
}
