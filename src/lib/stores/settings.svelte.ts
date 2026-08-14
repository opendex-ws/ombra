import { api } from '$lib/api/client';
import type { PublicUserSettings, SettingsResponse, Chain, UserFavouriteToken, UserFavouritesResponse } from '$lib/api/client';
import { getIsLoggedIn } from '$lib/stores/auth.svelte';

let settings = $state<PublicUserSettings | null>(null);
let settingsFetched = $state(false);

let favourites = $state<UserFavouriteToken[]>([]);
let favouritesFetched = $state(false);

export function getSettings() { return settings; }
export function getUseDca() { return false; }
export function getAnonymous() { return settings?.anonymous ?? false; }

export function applySettingsSnapshot(response: SettingsResponse) {
	settings = response.settings;
	settingsFetched = true;
}

export async function fetchSettings() {
	if (!getIsLoggedIn()) return;
	if (settingsFetched) return;
	try {
		const { data } = await api.GET('/v2/user/settings');
		settings = (data as SettingsResponse | undefined)?.settings ?? null;
	} catch {}
	settingsFetched = true;
}

export async function updateSetting<K extends keyof PublicUserSettings>(key: K, value: PublicUserSettings[K]) {
	if (!settings) return;
	const updated = { ...settings, [key]: value };
	settings = updated;
	try {
		await api.PUT('/v2/user/settings', { body: { settings: updated } as never });
	} catch {
		settings = { ...settings, [key]: settings[key] };
	}
}

export function getFavourites() { return favourites; }

export function applyFavouritesSnapshot(response: UserFavouritesResponse) {
	favourites = response.favourites;
	favouritesFetched = true;
}

export async function fetchFavourites() {
	if (!getIsLoggedIn()) return;
	if (favouritesFetched) return;
	try {
		const { data } = await api.GET('/v2/user/favourites');
		favourites = (data as UserFavouritesResponse | undefined)?.favourites ?? [];
	} catch {}
	favouritesFetched = true;
}

export async function addFavourite(chain: Chain, tokenAddress: string) {
	try {
		await api.POST('/v2/user/favourites', { body: { chain, tokenAddress } });
		favouritesFetched = false;
		await fetchFavourites();
	} catch {}
}

export function updateFavouritePrice(chain: Chain, tokenAddress: string, priceUsd?: number, marketCapUsd?: number) {
	const idx = favourites.findIndex(f => f.token.chain === chain && f.token.address === tokenAddress);
	if (idx === -1) return;
	const updated = { ...favourites[idx] };
	if (priceUsd !== undefined) {
		updated.priceUsd = priceUsd;
		updated.priceUsdStr = String(priceUsd);
	}
	if (marketCapUsd !== undefined) {
		updated.marketCapUsd = marketCapUsd;
		updated.marketCapUsdStr = String(marketCapUsd);
	}
	favourites[idx] = updated;
}

export async function removeFavourite(chain: Chain, tokenAddress: string) {
	try {
		await api.DELETE('/v2/user/favourites/{chain}/{tokenAddress}', {
			params: { path: { chain, tokenAddress } }
		});
		favourites = favourites.filter(f => !(f.token.chain === chain && f.token.address === tokenAddress));
	} catch {}
}

export function clearSettings() {
	settings = null;
	settingsFetched = false;
	favourites = [];
	favouritesFetched = false;
}
