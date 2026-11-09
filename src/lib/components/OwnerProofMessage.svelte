<script lang="ts">
	import type { OwnerProofPreview } from '$lib/waas/owner-proof';

	let { preview }: { preview: OwnerProofPreview } = $props();

	let now = $state(Date.now());

	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const expired = $derived(now > preview.validUntil * 1000);
	const left = $derived(Math.max(0, preview.validUntil - Math.floor(now / 1000)));
	const until = $derived(new Date(preview.validUntil * 1000).toISOString().replace('.000Z', ' UTC'));
	const countdown = $derived(
		`Valid until ${until} (${preview.validUntil}) — ${expired ? 'Expired' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`}`
	);
</script>

<div class="space-y-2">
	<pre data-testid="owner-proof-message" class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-bd bg-s2 p-3 font-mono text-[11px] leading-relaxed text-tx">{preview.message}</pre>
	<div class="text-[11px] text-g6">Issued at {new Date(preview.ts * 1000).toISOString().replace('.000Z', ' UTC')} ({preview.ts})</div>
	<div data-testid="owner-proof-countdown" class="text-[11px] {expired ? 'text-red' : 'text-g6'}">{countdown}</div>
</div>
