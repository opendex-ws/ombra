<script lang="ts">
	import { getWalletIconUrl } from '$lib/utils/walleticon';
	import { avatarUrl } from '$lib/utils/format';

	let { address, photoId = null, size = 32, class: className = '' }: {
		address: string;
		photoId?: string | null;
		size?: number;
		class?: string;
	} = $props();

	let failed = $state(false);
	const photo = $derived(photoId ? avatarUrl(photoId) : null);
	const src = $derived(photo && !failed ? photo : getWalletIconUrl(address));
</script>

<img src={src} onerror={() => (failed = true)} alt="" width={size} height={size} class="shrink-0 rounded-full object-cover {className}" />
