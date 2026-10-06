import { describe, expect, it, vi } from 'vitest';
import { CustomSignalSchemaCache, schemaRevisionKey } from './schema-cache';

describe('custom signal schema cache', () => {
	it('coalesces active-revision loads and invalidates explicitly', async () => {
		const schema = { revision: 2, fields: [], jsonSchema: {} };
		const loader = vi.fn(async () => schema);
		const cache = new CustomSignalSchemaCache(loader);

		const [first, second] = await Promise.all([cache.get('integration-1', 2), cache.get('integration-1', 2)]);
		expect(first).toBe(schema);
		expect(second).toBe(schema);
		expect(loader).toHaveBeenCalledTimes(1);
		expect(cache.peek('integration-1', 3)).toBeUndefined();
		cache.invalidate('integration-1');
		await cache.get('integration-1', 2);
		expect(loader).toHaveBeenCalledTimes(2);
		expect(schemaRevisionKey('integration-1', 2)).toBe('integration-1:2');
	});

	it('does not cache a response with the wrong expected revision', async () => {
		const cache = new CustomSignalSchemaCache(async () => ({ revision: 3, fields: [], jsonSchema: {} }));
		await expect(cache.get('integration-1', 4)).rejects.toThrow('Expected schema revision 4');
		expect(cache.peek('integration-1', 3)).toBeUndefined();
	});

	it('reloads when no discovery revision is available', async () => {
		let revision = 1;
		const loader = vi.fn(async () => ({ revision, fields: [], jsonSchema: {} }));
		const cache = new CustomSignalSchemaCache(loader);
		expect((await cache.get('integration-1')).revision).toBe(1);
		revision = 2;
		expect((await cache.get('integration-1')).revision).toBe(2);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('does not let an old pending load replace a newer put', async () => {
		let resolveOld!: (schema: { revision: number; fields: []; jsonSchema: {} }) => void;
		const oldLoad = new Promise<{ revision: number; fields: []; jsonSchema: {} }>((resolve) => {
			resolveOld = resolve;
		});
		const cache = new CustomSignalSchemaCache(async () => oldLoad);
		const pending = cache.get('integration-1');
		const newer = { revision: 2, fields: [] as [], jsonSchema: {} };
		cache.put('integration-1', newer);
		resolveOld({ revision: 1, fields: [], jsonSchema: {} });
		expect(await pending).toBe(newer);
		expect(cache.peek('integration-1', 2)).toBe(newer);
	});

	it('keeps the greatest revision across a pending load and put', async () => {
		let resolveLoad!: (schema: { revision: number; fields: []; jsonSchema: {} }) => void;
		const load = new Promise<{ revision: number; fields: []; jsonSchema: {} }>((resolve) => {
			resolveLoad = resolve;
		});
		const cache = new CustomSignalSchemaCache(async () => load);
		const pending = cache.get('integration-1');
		cache.put('integration-1', { revision: 1, fields: [], jsonSchema: {} });
		resolveLoad({ revision: 2, fields: [], jsonSchema: {} });
		expect((await pending).revision).toBe(2);
		expect(cache.peek('integration-1', 2)?.revision).toBe(2);
		cache.put('integration-1', { revision: 1, fields: [], jsonSchema: {} });
		expect(cache.peek('integration-1', 2)?.revision).toBe(2);
	});

	it('does not return a load invalidated while it was pending', async () => {
		let resolveLoad!: (schema: { revision: number; fields: []; jsonSchema: {} }) => void;
		const load = new Promise<{ revision: number; fields: []; jsonSchema: {} }>((resolve) => {
			resolveLoad = resolve;
		});
		const cache = new CustomSignalSchemaCache(async () => load);
		const pending = cache.get('integration-1');
		cache.invalidate('integration-1');
		resolveLoad({ revision: 1, fields: [], jsonSchema: {} });
		await expect(pending).rejects.toThrow('invalidated during load');
		expect(cache.peek('integration-1', 1)).toBeUndefined();
	});
});
