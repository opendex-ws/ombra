export type ToastType = 'success' | 'error' | 'warning' | 'info';

export type ToastDetail = {
	label: string;
	value: string;
	href?: string;
	color?: string;
};

export type Toast = {
	id: number;
	type: ToastType;
	title: string;
	message?: string;
	details?: ToastDetail[];
	duration: number;
	/** Optional leading image (e.g. token logo) shown instead of the type icon. */
	iconUrl?: string;
	/** When set, the toast body becomes clickable and runs this on click. */
	onClick?: () => void;
};

let counter = 0;
let toasts = $state<Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function getToasts(): Toast[] {
	return toasts;
}

function scheduleDismiss(id: number, duration: number) {
	const existing = timers.get(id);
	if (existing) clearTimeout(existing);
	timers.set(id, setTimeout(() => removeToast(id), duration));
}

export function addToast(type: ToastType, title: string, message?: string, duration = 5000, details?: ToastDetail[]): number {
	const id = ++counter;
	toasts = [...toasts, { id, type, title, message, details, duration }];
	scheduleDismiss(id, duration);
	return id;
}

/** A richer toast with an optional leading image and a click action on the body. */
export function addActionToast(opts: {
	type?: ToastType;
	title: string;
	message?: string;
	iconUrl?: string;
	onClick?: () => void;
	duration?: number;
}): number {
	const id = ++counter;
	const duration = opts.duration ?? 8000;
	toasts = [...toasts, {
		id,
		type: opts.type ?? 'info',
		title: opts.title,
		message: opts.message,
		iconUrl: opts.iconUrl,
		onClick: opts.onClick,
		duration
	}];
	scheduleDismiss(id, duration);
	return id;
}

/**
 * Patch an existing toast in place (e.g. upgrade a "Swap Confirmed" toast to the
 * finalized amounts) and restart its auto-dismiss timer. No-op if the toast has
 * already been dismissed.
 */
export function updateToast(id: number, patch: Partial<Omit<Toast, 'id'>>): void {
	const idx = toasts.findIndex((t) => t.id === id);
	if (idx === -1) return;
	const next = { ...toasts[idx], ...patch };
	toasts = [...toasts.slice(0, idx), next, ...toasts.slice(idx + 1)];
	scheduleDismiss(id, next.duration);
}

export function removeToast(id: number) {
	const existing = timers.get(id);
	if (existing) { clearTimeout(existing); timers.delete(id); }
	toasts = toasts.filter((t) => t.id !== id);
}
