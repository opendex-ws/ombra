export const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

const CHUNK_RELOAD_KEY = 'ombra:last-chunk-reload';

type ChunkRecoveryRuntime = {
	now: () => number;
	storage: Pick<Storage, 'getItem' | 'setItem'>;
	reload: () => void;
};

export function recoverFromChunkLoadError(
	event: Event,
	runtime: ChunkRecoveryRuntime
): 'reloaded' | 'suppressed' {
	event.preventDefault();

	let previousReload = Number.NaN;
	try {
		previousReload = Number(runtime.storage.getItem(CHUNK_RELOAD_KEY));
	} catch {
		// Storage can be unavailable in hardened/private browser contexts.
	}

	const now = runtime.now();
	if (
		Number.isFinite(previousReload) &&
		previousReload > 0 &&
		now - previousReload < CHUNK_RELOAD_COOLDOWN_MS
	) {
		return 'suppressed';
	}

	try {
		runtime.storage.setItem(CHUNK_RELOAD_KEY, String(now));
	} catch {
		// A reload still gives the browser a chance to fetch the current manifest.
	}
	runtime.reload();
	return 'reloaded';
}
