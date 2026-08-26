import { browser } from '$app/environment';

let isDesktop = $state(false);
let started = false;

export function getIsDesktop() {
	return isDesktop;
}

/** Call from layout onMount so SSR and the first client paint stay aligned. */
export function startViewport(): void {
	if (!browser || started) return;
	started = true;
	const media = window.matchMedia('(min-width: 768px)');
	const sync = () => {
		isDesktop = media.matches;
	};
	sync();
	media.addEventListener('change', sync);
}
