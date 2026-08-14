import { browser } from '$app/environment';

let isDesktop = $state(false);

if (browser) {
	const media = window.matchMedia('(min-width: 768px)');
	isDesktop = media.matches;
	media.addEventListener('change', () => {
		isDesktop = media.matches;
	});
}

export function getIsDesktop() {
	return isDesktop;
}
