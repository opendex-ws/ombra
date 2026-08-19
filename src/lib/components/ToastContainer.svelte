<script lang="ts">
	import { getToasts, removeToast, type ToastType } from '$lib/stores/toast.svelte';
	import CheckCircle from 'lucide-svelte/icons/circle-check-big';
	import XCircle from 'lucide-svelte/icons/circle-x';
	import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
	import Info from 'lucide-svelte/icons/info';
	import X from 'lucide-svelte/icons/x';

	function accentColor(type: ToastType): string {
		switch (type) {
			case 'success': return 'var(--t-grn)';
			case 'error': return 'var(--t-red)';
			case 'warning': return 'var(--t-yel)';
			case 'info': return 'var(--t-g7)';
		}
	}

	function borderColor(type: ToastType): string {
		switch (type) {
			case 'success': return 'border-l-grn';
			case 'error': return 'border-l-red';
			case 'warning': return 'border-l-yel';
			case 'info': return 'border-l-g3';
		}
	}

	const MAX_VISIBLE = 5;
	const GAP = 8;
	const PEEK = 12;

	let expanded = $state(false);
	let heights = $state<Record<number, number>>({});

	function stackStyle(visible: { id: number }[], i: number): string {
		const d = visible.length - 1 - i;
		if (expanded) {
			let cum = 0;
			for (let j = i + 1; j < visible.length; j++) {
				cum += (heights[visible[j].id] ?? 0) + GAP;
			}
			const tilt = d === 0 ? 0 : (d % 2 === 1 ? -1.5 : 1.5);
			return `transform: translateY(${-cum}px) rotate(${tilt}deg); z-index: ${100 - d};`;
		}
		const hidden = d > 2;
		return `transform: translateY(${-d * PEEK}px) scale(${1 - d * 0.06}); z-index: ${100 - d}; opacity: ${hidden ? 0 : 1 - d * 0.15}; ${hidden ? 'pointer-events: none;' : ''}`;
	}
</script>

{#if getToasts().length > 0}
	{@const toasts = getToasts()}
	{@const visible = toasts.slice(-MAX_VISIBLE)}
	<div
		class="fixed bottom-16 left-1/2 z-[200] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 md:bottom-4"
		role="region"
		aria-label="Notifications"
		onmouseenter={() => (expanded = true)}
		onmouseleave={() => (expanded = false)}
	>
		<div class="grid">
			{#each visible as toast, i (toast.id)}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					bind:clientHeight={heights[toast.id]}
					onclick={toast.onClick ? () => { toast.onClick?.(); removeToast(toast.id); } : undefined}
					onkeydown={toast.onClick ? (e) => { if (e.key === 'Enter') { toast.onClick?.(); removeToast(toast.id); } } : undefined}
					role={toast.onClick ? 'button' : undefined}
					tabindex={toast.onClick ? 0 : undefined}
					class="toast-card animate-toast-in self-end rounded-lg border border-bd border-l-2 {borderColor(toast.type)} bg-s5 px-3 py-2 shadow-lg shadow-s0/40 backdrop-blur-md {toast.onClick ? 'cursor-pointer transition-colors hover:bg-s6' : ''}"
					style="grid-area: 1 / 1; {stackStyle(visible, i)}"
				>
					<div class="flex items-start gap-2">
						<div class="mt-0.5 shrink-0">
							{#if toast.iconUrl}
								<img src={toast.iconUrl} alt="" class="h-5 w-5 rounded-full object-cover ring-1 ring-bd" onerror={(e: Event) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
							{:else if toast.type === 'success'}
								<CheckCircle class="h-3.5 w-3.5" style="color: {accentColor(toast.type)}" strokeWidth={2} />
							{:else if toast.type === 'error'}
								<XCircle class="h-3.5 w-3.5" style="color: {accentColor(toast.type)}" strokeWidth={2} />
							{:else if toast.type === 'warning'}
								<AlertTriangle class="h-3.5 w-3.5" style="color: {accentColor(toast.type)}" strokeWidth={2} />
							{:else}
								<Info class="h-3.5 w-3.5" style="color: {accentColor(toast.type)}" strokeWidth={2} />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-semibold text-tx">{toast.title}</span>
								<button
									onclick={(e) => { e.stopPropagation(); removeToast(toast.id); }}
									class="shrink-0 cursor-pointer text-g3 transition-colors hover:text-g7"
									aria-label="Dismiss"
								>
									<X class="h-3 w-3" strokeWidth={2} />
								</button>
							</div>
							{#if toast.message}
								<div class="mt-0.5 text-[11px] leading-snug text-g6">{toast.message}</div>
							{/if}
							{#if toast.details && toast.details.length > 0}
								<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
									{#each toast.details as detail}
										<span class="text-g4">{detail.label}: {#if detail.href}<a href={detail.href} target="_blank" rel="noopener" class="font-medium text-g9 hover:text-grn">{detail.value}</a>{:else}<span class="font-medium text-g9">{detail.value}</span>{/if}</span>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.toast-card {
		transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
		transform-origin: bottom center;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.97);
		}
	}

	:global(.animate-toast-in) {
		animation: toast-in 0.25s cubic-bezier(0.22, 1, 0.36, 1);
	}
</style>
