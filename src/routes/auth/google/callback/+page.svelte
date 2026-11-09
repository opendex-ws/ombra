<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveGoogleCallback } from '$lib/auth/google';
	import { completeGoogleLogin } from '$lib/stores/auth.svelte';
	import { authenticate } from '$lib/ws/client';
	import { fetchSettings, fetchFavourites } from '$lib/stores/settings.svelte';
	import { fetchProfile } from '$lib/stores/profile.svelte';

	let message = $state('Signing in...');

	onMount(async () => {
		const result = await resolveGoogleCallback(page.url.searchParams);
		if (!result.ok) {
			message = result.message;
			return;
		}
		completeGoogleLogin(result.token, result.wallet);
		authenticate(result.token);
		fetchSettings();
		fetchFavourites();
		fetchProfile();
		goto('/');
	});
</script>

<p class="p-6 text-sm text-g5">{message}</p>
