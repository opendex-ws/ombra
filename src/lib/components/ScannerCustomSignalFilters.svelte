<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import X from 'lucide-svelte/icons/x';
	import IntegrationSourceControls from './IntegrationSourceControls.svelte';
	import { CustomSignalSchemaCache } from '$lib/custom-signals/schema-cache';
	import {
		fetchIntegrationDiscovery,
		fetchIntegrationSchema
	} from '$lib/watchlist/custom-integrations';
	import {
		createScannerIntegrationClause,
		type ScannerIntegrationClause
	} from '$lib/scanner-custom-signals';
	import type { CustomSignalIntegrationDescriptor } from '$lib/custom-signals/contracts';

	let {
		clauses,
		onchange
	}: {
		clauses: ScannerIntegrationClause[];
		onchange: (clauses: ScannerIntegrationClause[]) => void;
	} = $props();

	const schemaCache = new CustomSignalSchemaCache(fetchIntegrationSchema);
	let integrations = $state<CustomSignalIntegrationDescriptor[]>([]);
	let customSignalsEnabled = $state(false);
	let loading = $state(true);
	let error = $state('');
	let generation = 0;

	async function loadIntegrations(): Promise<void> {
		const requestedGeneration = ++generation;
		loading = true;
		error = '';
		try {
			const discovery = await fetchIntegrationDiscovery();
			if (requestedGeneration !== generation) return;
			customSignalsEnabled = discovery.enabled;
			integrations = discovery.integrations;
			const integrationsById = new Map(discovery.integrations.map((integration) => [integration.id, integration]));
			let changed = false;
			const hydrated = clauses.map((clause) => {
				const integration = integrationsById.get(clause.integrationId);
				if (!integration
					|| clause.integration.id === integration.id
					&& clause.integration.name === integration.name
					&& clause.integration.photoId === integration.photoId) return clause;
				changed = true;
				return { ...clause, integration: { id: integration.id, name: integration.name, photoId: integration.photoId } };
			});
			if (changed) onchange(hydrated);
		} catch (cause) {
			if (requestedGeneration !== generation) return;
			error = cause instanceof Error ? cause.message : 'Failed to load custom integrations';
		} finally {
			if (requestedGeneration === generation) loading = false;
		}
	}

	function addClause(): void {
		const integration = integrations.find((item) => item.enabled);
		if (!integration) return;
		onchange([...clauses, createScannerIntegrationClause(integration)]);
	}

	function updateClause(
		uiId: string,
		update: Partial<Omit<ScannerIntegrationClause, 'uiId'>>
	): void {
		onchange(clauses.map((clause) => clause.uiId === uiId ? { ...clause, ...update } : clause));
	}

	function removeClause(uiId: string): void {
		onchange(clauses.filter((clause) => clause.uiId !== uiId));
	}

	onMount(() => void loadIntegrations());
	onDestroy(() => {
		generation += 1;
		schemaCache.clear();
	});
</script>

<div class="min-w-0 space-y-3">
	<div class="rounded-lg border border-bd bg-s2 p-2.5">
		<div class="flex flex-wrap items-start justify-between gap-2">
			<div class="min-w-0 space-y-1">
				<p class="text-xs font-medium text-tx">Custom Signals</p>
				<p class="text-[10px] leading-relaxed text-g5">A token matches when any integration clause matches. Call-count limits use calls from the selected sources.</p>
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				{#if clauses.length > 0}
					<button type="button" onclick={() => onchange([])} class="cursor-pointer text-[10px] text-red hover:text-red-light">Reset</button>
				{/if}
				<button
					type="button"
					onclick={addClause}
					disabled={loading || !customSignalsEnabled || !integrations.some((item) => item.enabled)}
					class="btn-secondary px-2 py-1 text-[10px] disabled:cursor-default disabled:opacity-40"
				>
					Add integration
				</button>
			</div>
		</div>
		{#if loading}
			<p class="mt-2 text-[10px] text-g5">Loading integrations…</p>
		{:else if error}
			<div class="mt-2 flex items-center justify-between gap-2">
				<p role="alert" class="text-[10px] text-red">{error}</p>
				<button type="button" onclick={() => void loadIntegrations()} class="btn-secondary px-2 py-1 text-[10px]">Retry</button>
			</div>
		{:else if (!customSignalsEnabled || integrations.every((item) => !item.enabled)) && clauses.length === 0}
			<p class="mt-2 text-[10px] text-g5">No enabled custom integrations.</p>
		{:else if clauses.length === 0}
			<p class="mt-2 text-[10px] text-g5">Add an integration to filter by its callers or metadata.</p>
		{/if}
	</div>

	{#each clauses as clause, index (clause.uiId)}
		<div class="min-w-0 rounded-lg border border-bd bg-s2 p-2.5">
			<div class="mb-2 flex items-center justify-between gap-2">
				<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Clause {index + 1}</span>
				<button type="button" onclick={() => removeClause(clause.uiId)} aria-label={`Remove integration clause ${index + 1}`} class="-m-1.5 cursor-pointer p-1.5 text-g5 hover:text-red">
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
			<IntegrationSourceControls
				{integrations}
				integrationId={clause.integrationId}
				callerIds={clause.callerIds}
				metaFilter={clause.metaFilter}
				initialIntegration={clause.integration}
				initialCallers={clause.callers}
				schemaCache={schemaCache}
				uncappedCallerListOnMobile={true}
				onintegrationchange={(integrationId) => {
					const integration = integrations.find((item) => item.id === integrationId);
					updateClause(clause.uiId, {
						integrationId,
						callerIds: [],
						metaFilter: [],
						callers: [],
						integration: integration
							? { id: integration.id, name: integration.name, photoId: integration.photoId }
							: { id: integrationId, name: integrationId, photoId: null }
					});
				}}
				oncalleridschange={(callerIds, callers) => updateClause(clause.uiId, { callerIds, callers })}
				onfilterchange={(metaFilter) => updateClause(clause.uiId, { metaFilter })}
			/>
		</div>
	{/each}
</div>
