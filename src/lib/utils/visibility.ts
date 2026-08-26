// Shared viewport gate for live list rows.
//
// Flash animations are only worth running for rows the user can actually see:
// an offscreen row still pays style + animation-tick cost even though
// `content-visibility` skips its paint. Every row registers with ONE shared
// IntersectionObserver rather than allocating its own.

type VisibilityCallback = (visible: boolean) => void;

const callbacks = new WeakMap<Element, VisibilityCallback>();
let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
	if (typeof IntersectionObserver === 'undefined') return null;
	observer ??= new IntersectionObserver(
		(entries) => {
			for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
		},
		// A small margin keeps rows just off the edge "live" so a flash isn't
		// dropped the instant a row scrolls into view.
		{ rootMargin: '96px' }
	);
	return observer;
}

/**
 * `use:onVisibility={(visible) => ...}` — fires whenever the node enters or
 * leaves the viewport. Assumes visible when IntersectionObserver is missing
 * (SSR/older engines) so behaviour degrades to the previous always-flash.
 */
export function onVisibility(node: Element, callback: VisibilityCallback) {
	const io = getObserver();
	if (!io) {
		callback(true);
		return {};
	}
	callbacks.set(node, callback);
	io.observe(node);
	return {
		destroy() {
			io.unobserve(node);
			callbacks.delete(node);
		}
	};
}

/** Value-flash timing, shared by every live row so the CSS and JS stay in sync. */
export const FLASH_MS = 450;
/** A value that keeps churning re-arms at most this often. */
export const FLASH_COOLDOWN_MS = 900;
/** Row/card-level flash (longer than a single value flash). */
export const ROW_FLASH_MS = 1200;
