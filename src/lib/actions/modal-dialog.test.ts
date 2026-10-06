import { describe, expect, it, vi } from 'vitest';
import { modalDialog } from './modal-dialog';

describe('modal dialog keyboard behavior', () => {
	it('focuses the dialog, traps Tab, closes on Escape, and restores the opener', async () => {
		const opener = document.createElement('button');
		const dialog = document.createElement('div');
		dialog.tabIndex = -1;
		const first = document.createElement('button');
		const last = document.createElement('button');
		dialog.insertAdjacentElement('beforeend', first);
		dialog.insertAdjacentElement('beforeend', last);
		document.body.insertAdjacentElement('beforeend', opener);
		document.body.insertAdjacentElement('beforeend', dialog);
		opener.focus();
		const onClose = vi.fn();
		const action = modalDialog(dialog, { onClose });

		await Promise.resolve();
		expect(document.activeElement).toBe(first);
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
		expect(document.activeElement).toBe(last);
		last.focus();
		dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
		expect(document.activeElement).toBe(first);
		dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onClose).toHaveBeenCalledOnce();

		action.destroy();
		dialog.remove();
		await Promise.resolve();
		expect(document.activeElement).toBe(opener);
		opener.remove();
	});

	it('moves focus into the next modal without restoring the original opener', async () => {
		const opener = document.createElement('button');
		const picker = document.createElement('div');
		picker.tabIndex = -1;
		const pickerChoice = document.createElement('button');
		picker.insertAdjacentElement('beforeend', pickerChoice);
		document.body.insertAdjacentElement('beforeend', opener);
		document.body.insertAdjacentElement('beforeend', picker);
		opener.focus();
		const pickerAction = modalDialog(picker, {
			onClose: vi.fn(),
			shouldRestoreFocus: () => false
		});

		await Promise.resolve();
		expect(document.activeElement).toBe(pickerChoice);
		pickerAction.destroy();
		picker.remove();

		const botDialog = document.createElement('div');
		botDialog.tabIndex = -1;
		const botClose = document.createElement('button');
		botDialog.insertAdjacentElement('beforeend', botClose);
		document.body.insertAdjacentElement('beforeend', botDialog);
		const botAction = modalDialog(botDialog, { onClose: vi.fn(), restoreFocusTo: opener });
		await Promise.resolve();
		expect(document.activeElement).toBe(botClose);
		expect(document.activeElement).not.toBe(opener);

		botAction.destroy();
		botDialog.remove();
		await Promise.resolve();
		expect(document.activeElement).toBe(opener);
		opener.remove();
	});
});
