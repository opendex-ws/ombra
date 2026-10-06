import type { ParsedCustomSignalSchema } from './schema';

export type SchemaLoader = (integrationId: string) => Promise<ParsedCustomSignalSchema>;

interface CacheEntry {
	schema?: ParsedCustomSignalSchema;
	pending?: Promise<ParsedCustomSignalSchema>;
}

export function schemaRevisionKey(integrationId: string, revision: number): string {
	return `${integrationId}:${revision}`;
}

/** Small active-schema cache. It coalesces parallel reads and never serves a
 * value when the caller names a different active revision.
 */
export class CustomSignalSchemaCache {
	private readonly entries = new Map<string, CacheEntry>();
	private readonly generations = new Map<string, number>();

	constructor(private readonly loadSchema: SchemaLoader) {}

	peek(integrationId: string, expectedRevision: number): ParsedCustomSignalSchema | undefined {
		const schema = this.entries.get(integrationId)?.schema;
		return schema && schema.revision >= expectedRevision
			? schema
			: undefined;
	}

	private generation(integrationId: string): number {
		return this.generations.get(integrationId) ?? 0;
	}

	private greaterSchema(
		left: ParsedCustomSignalSchema | undefined,
		right: ParsedCustomSignalSchema
	): ParsedCustomSignalSchema {
		return left && left.revision > right.revision ? left : right;
	}

	async get(integrationId: string, expectedRevision?: number): Promise<ParsedCustomSignalSchema> {
		const generation = this.generation(integrationId);
		// Without a discovery revision, fetch the active schema again. This avoids
		// an indefinite active-schema cache when the owner publishes a revision.
		const cached = expectedRevision === undefined ? undefined : this.peek(integrationId, expectedRevision);
		if (cached) return cached;

		const current = this.entries.get(integrationId);
		if (current?.pending) {
			const loaded = await current.pending;
			if (this.generation(integrationId) !== generation) throw new Error('Schema cache was invalidated during load');
			const latest = this.entries.get(integrationId);
			const greatest = this.greaterSchema(latest?.schema, loaded);
			if (expectedRevision === undefined || greatest.revision >= expectedRevision) return greatest;
		}

		const pending = this.loadSchema(integrationId);
		const beforeLoad = this.entries.get(integrationId);
		this.entries.set(integrationId, { schema: beforeLoad?.schema, pending });
		try {
			const loaded = await pending;
			if (this.generation(integrationId) !== generation) throw new Error('Schema cache was invalidated during load');
			const latest = this.entries.get(integrationId);
			const greatest = this.greaterSchema(latest?.schema, loaded);
			if (expectedRevision !== undefined && greatest.revision < expectedRevision) {
				throw new Error(`Expected schema revision ${expectedRevision}, received ${greatest.revision}`);
			}
			if (latest?.pending === pending) this.entries.set(integrationId, { schema: greatest });
			return greatest;
		} catch (error) {
			const latest = this.entries.get(integrationId);
			if (latest?.pending === pending) {
				if (latest.schema) this.entries.set(integrationId, { schema: latest.schema });
				else this.entries.delete(integrationId);
			}
			throw error;
		}
	}

	put(integrationId: string, schema: ParsedCustomSignalSchema): void {
		const entry = this.entries.get(integrationId);
		if (entry?.schema && entry.schema.revision >= schema.revision) return;
		this.entries.set(integrationId, { schema, pending: entry?.pending });
	}

	invalidate(integrationId: string): void {
		this.generations.set(integrationId, this.generation(integrationId) + 1);
		this.entries.delete(integrationId);
	}

	clear(): void {
		for (const integrationId of this.entries.keys()) {
			this.generations.set(integrationId, this.generation(integrationId) + 1);
		}
		this.entries.clear();
	}
}
