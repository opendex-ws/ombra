<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { completeGoogleLogin } from '$lib/stores/auth.svelte';
	import { authenticate } from '$lib/ws/client';
	import { fetchSettings, fetchFavourites } from '$lib/stores/settings.svelte';
	import { fetchProfile } from '$lib/stores/profile.svelte';

	let message = $state('Signing in...');

	onMount(() => {
		const token = page.url.searchParams.get('token');
		const wallet = page.url.searchParams.get('wallet');
		const error = page.url.searchParams.get('error');
		if (!token || error) {
			message = 'Google sign-in failed.';
			return;
		}
		completeGoogleLogin(token, wallet);
		authenticate(token);
		fetchSettings();
		fetchFavourites();
		fetchProfile();
		goto('/');
	});
</script>

<p class="p-6 text-sm text-g5">{message}</p>
