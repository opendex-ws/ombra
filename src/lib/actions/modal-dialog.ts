export type ModalDialogOptions = {
	onClose: () => void;
	shouldRestoreFocus?: () => boolean;
	restoreFocusTo?: HTMLElement | null;
};

const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
		.filter((element) => element.getAttribute('aria-hidden') !== 'true');
}

/** Gives a portaled modal its keyboard behavior without owning its visual state. */
export function modalDialog(node: HTMLElement, initialOptions: ModalDialogOptions) {
	let options = initialOptions;
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

	const focusDialog = () => {
		if (!node.isConnected) return;
		const first = focusableElements(node)[0];
		if (first) first.focus({ preventScroll: true });
		else node.focus({ preventScroll: true });
	};
	queueMicrotask(focusDialog);

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			options.onClose();
			return;
		}
		if (event.key !== 'Tab') return;

		const focusable = focusableElements(node);
		if (focusable.length === 0) {
			event.preventDefault();
			node.focus({ preventScroll: true });
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && (active === first || active === node || !node.contains(active))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (active === last || active === node || !node.contains(active))) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', handleKeydown);

	return {
		update(nextOptions: ModalDialogOptions) {
			options = nextOptions;
		},
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
			queueMicrotask(() => {
				const restoreTarget = options.restoreFocusTo ?? opener;
				if ((options.shouldRestoreFocus?.() ?? true) && restoreTarget?.isConnected) {
					restoreTarget.focus({ preventScroll: true });
				}
			});
		}
	};
}
