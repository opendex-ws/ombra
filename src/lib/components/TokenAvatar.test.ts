import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';
import TokenAvatar from './TokenAvatar.svelte';

afterEach(() => cleanup());

describe('TokenAvatar', () => {
	test('shows the symbol letters when the image 404s', async () => {
		const { container } = render(TokenAvatar, {
			props: {
				chain: 'RH',
				address: '0x0180072386a1cB83F188CbA38d9Fe0F2c5d68458',
				symbol: 'PEPE',
				letters: 2
			}
		});
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		await fireEvent.error(img!);
		expect(container.querySelector('img')).toBeNull();
		expect(container.textContent).toContain('PE');
	});

	test('shows the symbol when the token has no address', () => {
		const { container } = render(TokenAvatar, {
			props: { chain: 'RH', address: '', symbol: 'ZZ' }
		});
		expect(container.querySelector('img')).toBeNull();
		expect(container.textContent).toContain('Z');
	});
});
