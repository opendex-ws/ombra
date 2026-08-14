import { api } from '$lib/api/client';
import type { ProfileResponse } from '$lib/api/client';
import { getIsLoggedIn } from '$lib/stores/auth.svelte';

let profile = $state<ProfileResponse | null>(null);
let profileFetched = $state(false);
let inFlight: Promise<void> | null = null;

export function getProfile(): ProfileResponse | null {
	return profile;
}

export function setProfile(next: ProfileResponse | null) {
	profile = next;
	profileFetched = true;
}

export function clearProfile() {
	profile = null;
	profileFetched = false;
	inFlight = null;
}

export function applyProfileSnapshot(data: ProfileResponse) {
	profile = data;
	profileFetched = true;
}

export async function fetchProfile(force = false): Promise<void> {
	if (!getIsLoggedIn()) return;
	// Skip only when we already have a usable profile — never stick on empty forever.
	if (!force && profileFetched && profile) return;
	if (inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const { data } = await api.GET('/v2/user/profile');
			if (data) profile = data;
		} catch {
			/* ignore */
		} finally {
			profileFetched = true;
			inFlight = null;
		}
	})();
	return inFlight;
}
