<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import X from 'lucide-svelte/icons/x';
	import { avatarUrl } from '$lib/utils/format';
	import GeneratedFilterControls from '$lib/custom-signals/GeneratedFilterControls.svelte';
	import type {
		CustomMetaFilter,
		CustomSignalIntegrationDescriptor
	} from '$lib/custom-signals/contracts';
	import { fetchIntegrationFilterFields, requestedHistoricalFieldKeys } from '$lib/custom-signals/filter-fields';
	import type { HistoricalFilterFieldDefinition, ParsedCustomSignalSchema } from '$lib/custom-signals/schema';
	import type { CustomSignalSchemaCache } from '$lib/custom-signals/schema-cache';
	import {
		fetchIntegrationCallers,
		type IntegrationCallerSourceItem
	} from '$lib/watchlist/custom-integrations';

	type CallerChoice = Pick<IntegrationCallerSourceItem, 'id' | 'name' | 'photoId'>;

	let {
		integrations,
		integrationId,
		callerIds,
		metaFilter,
		callerMode = 'multi',
		allowIntegrationSelection = true,
		initialIntegration,
		initialCallers = [],
		schemaCache,
		disabled = false,
		uncappedCallerListOnMobile = false,
		onintegrationchange,
		oncalleridschange,
		onfilterchange
	}: {
		integrations: CustomSignalIntegrationDescriptor[];
		integrationId: string;
		callerIds: string[];
		metaFilter: CustomMetaFilter;
		callerMode?: 'single' | 'multi';
		allowIntegrationSelection?: boolean;
		initialIntegration?: Pick<CustomSignalIntegrationDescriptor, 'id' | 'name' | 'photoId'>;
		initialCallers?: CallerChoice[];
		schemaCache: CustomSignalSchemaCache;
		disabled?: boolean;
		uncappedCallerListOnMobile?: boolean;
		onintegrationchange: (integrationId: string) => void;
		oncalleridschange: (callerIds: string[], callers: CallerChoice[]) => void;
		onfilterchange: (filter: CustomMetaFilter) => void;
	} = $props();

	let schema = $state<ParsedCustomSignalSchema | null>(null);
	let historicalFields = $state<HistoricalFilterFieldDefinition[]>([]);
	let callers = $state<CallerChoice[]>([]);
	let nextCursor = $state<string | undefined>();
	let callerSearch = $state('');
	let loading = $state(false);
	let loadingMore = $state(false);
	let sourceError = $state('');
	let callerError = $state('');
	let historyError = $state('');
	let loadedIntegrationId = $state('');
	let historyIdentity = $state('');
	let loadGeneration = 0;
	let callerLoadGeneration = 0;
	let historyLoadGeneration = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const selectedIntegrationDescriptor = $derived(integrations.find((item) => item.id === integrationId));
	const selectedIntegration = $derived(
		selectedIntegrationDescriptor ?? (initialIntegration?.id === integrationId ? initialIntegration : undefined)
	);
	const selectableIntegrations = $derived.by(() => {
		const available = integrations.filter((item) => item.enabled || item.id === integrationId);
		if (initialIntegration?.id === integrationId && !available.some((item) => item.id === integrationId)) {
			return [...available, { ...initialIntegration, enabled: true }];
		}
		return available;
	});

	function mergeCallers(current: CallerChoice[], next: CallerChoice[]): CallerChoice[] {
		const byId = new Map(current.map((caller) => [caller.id, caller]));
		for (const caller of next) byId.set(caller.id, caller);
		return [...byId.values()];
	}

	async function loadSource(nextIntegrationId: string): Promise<void> {
		if (searchTimer) {
			clearTimeout(searchTimer);
			searchTimer = undefined;
		}
		const generation = ++loadGeneration;
		callerLoadGeneration += 1;
		historyLoadGeneration += 1;
		loading = true;
		loadingMore = false;
		sourceError = '';
		callerError = '';
		historyError = '';
		schema = null;
		historicalFields = [];
		historyIdentity = '';
		callers = [...initialCallers];
		nextCursor = undefined;
		callerSearch = '';
		try {
			const [nextSchema, catalog] = await Promise.all([
				schemaCache.get(nextIntegrationId),
				fetchIntegrationCallers(nextIntegrationId)
			]);
			if (generation !== loadGeneration || integrationId !== nextIntegrationId) return;
			schema = nextSchema;
			callers = mergeCallers(initialCallers, catalog.sources);
			nextCursor = catalog.nextCursor;
		} catch (cause) {
			if (generation !== loadGeneration || integrationId !== nextIntegrationId) return;
			sourceError = cause instanceof Error ? cause.message : 'Failed to load integration source';
		} finally {
			if (generation === loadGeneration && integrationId === nextIntegrationId) loading = false;
		}
	}

	async function loadCallers(search: string, cursor?: string): Promise<void> {
		const requestedIntegrationId = integrationId;
		if (!requestedIntegrationId) return;
		const generation = loadGeneration;
		const callerGeneration = ++callerLoadGeneration;
		callerError = '';
		if (cursor) loadingMore = true;
		else loading = true;
		try {
			const catalog = await fetchIntegrationCallers(requestedIntegrationId, {
				...(search.trim() ? { search: search.trim() } : {}),
				...(cursor ? { cursor } : {})
			});
			if (generation !== loadGeneration || callerGeneration !== callerLoadGeneration || integrationId !== requestedIntegrationId || callerSearch !== search) return;
			const selectedCallers = callers.filter((caller) => callerIds.includes(caller.id));
			callers = cursor
				? mergeCallers(callers, catalog.sources)
				: mergeCallers(selectedCallers, catalog.sources);
			nextCursor = catalog.nextCursor;
		} catch (cause) {
			if (generation !== loadGeneration || callerGeneration !== callerLoadGeneration || integrationId !== requestedIntegrationId || callerSearch !== search) return;
			callerError = cause instanceof Error ? cause.message : 'Failed to load callers';
		} finally {
			if (generation === loadGeneration && callerGeneration === callerLoadGeneration && integrationId === requestedIntegrationId) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	function changeIntegration(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value;
		if (next !== integrationId) onintegrationchange(next);
	}

	function changeSearch(event: Event): void {
		callerSearch = (event.currentTarget as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		const search = callerSearch;
		searchTimer = setTimeout(() => void loadCallers(search), 250);
	}

	function toggleCaller(callerId: string): void {
		let nextCallerIds: string[];
		if (callerMode === 'single') {
			nextCallerIds = callerIds[0] === callerId ? [] : [callerId];
		} else {
			nextCallerIds = callerIds.includes(callerId)
				? callerIds.filter((id) => id !== callerId)
				: [...callerIds, callerId];
		}
		oncalleridschange(nextCallerIds, callers.filter((caller) => nextCallerIds.includes(caller.id)));
	}

	function callerLabel(callerId: string): string {
		return callers.find((caller) => caller.id === callerId)?.name ?? callerId;
	}

	function callerChoice(callerId: string): CallerChoice | undefined {
		return callers.find((caller) => caller.id === callerId);
	}

	function retryFailedLoad(): void {
		if (sourceError || historyError) {
			void loadSource(integrationId);
			return;
		}
		void loadCallers(callerSearch);
	}

	$effect(() => {
		const nextIntegrationId = integrationId;
		if (!nextIntegrationId || loadedIntegrationId === nextIntegrationId) return;
		untrack(() => {
			loadedIntegrationId = nextIntegrationId;
			void loadSource(nextIntegrationId);
		});
	});

	$effect(() => {
		const currentSchema = schema;
		if (!currentSchema || !integrationId) return;
		const requestedKeys = requestedHistoricalFieldKeys(metaFilter, currentSchema.fields);
		const identity = `${integrationId}:${currentSchema.revision}:${JSON.stringify(requestedKeys)}`;
		if (historyIdentity === identity) return;
		untrack(() => {
			historyIdentity = identity;
			historicalFields = [];
			historyError = '';
			const historyGeneration = ++historyLoadGeneration;
			if (requestedKeys.length === 0) return;
			const requestedIntegrationId = integrationId;
			void fetchIntegrationFilterFields(requestedIntegrationId, requestedKeys)
				.then((fields) => {
					if (historyGeneration === historyLoadGeneration && integrationId === requestedIntegrationId && historyIdentity === identity) historicalFields = fields;
				})
				.catch((cause) => {
					if (historyGeneration === historyLoadGeneration && integrationId === requestedIntegrationId && historyIdentity === identity) {
						historyError = cause instanceof Error ? cause.message : 'Failed to load legacy filters';
					}
				});
		});
	});

	onDestroy(() => {
		loadGeneration += 1;
		callerLoadGeneration += 1;
		historyLoadGeneration += 1;
		if (searchTimer) clearTimeout(searchTimer);
	});
</script>

<div class="space-y-3">
	{#if allowIntegrationSelection}
		<label class="block space-y-1">
			<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Integration</span>
			<select value={integrationId} onchange={changeIntegration} {disabled} class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none focus:border-bd3">
				{#each selectableIntegrations as integration}
					<option value={integration.id}>{integration.name}{integration.enabled ? '' : ' (disabled)'}</option>
				{/each}
			</select>
		</label>
	{/if}
	{#if selectedIntegration}
		<div class="flex items-center gap-2 text-xs text-g7">
			{#if selectedIntegration.photoId && avatarUrl(selectedIntegration.photoId)}
				<img src={avatarUrl(selectedIntegration.photoId) ?? ''} alt="" class="h-5 w-5 rounded object-cover" />
			{/if}
			<span>{selectedIntegration.name}</span>
			{#if selectedIntegrationDescriptor && !selectedIntegrationDescriptor.enabled}<span class="rounded bg-yel/10 px-1.5 py-0.5 text-[10px] text-yel">Disabled</span>{/if}
		</div>
	{/if}

	<div class="space-y-2 rounded-lg border border-bd bg-s2 p-2.5">
		<div class="flex items-center justify-between gap-2">
			<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Callers</span>
			<button type="button" onclick={() => oncalleridschange([], [])} disabled={disabled || callerIds.length === 0} class="cursor-pointer text-[10px] text-g5 hover:text-tx disabled:cursor-default disabled:opacity-40">Any caller</button>
		</div>
		<input value={callerSearch} oninput={changeSearch} disabled={disabled || !integrationId || !schema} type="search" aria-label="Search integration callers" placeholder="Search callers" class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none placeholder:text-g4 focus:border-bd3" />
		{#if callerIds.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each callerIds as callerId}
					{@const selectedCaller = callerChoice(callerId)}
					<span class="flex max-w-full items-center gap-1 rounded bg-s4 px-1.5 py-0.5 text-[10px] text-g7">
						{#if selectedCaller?.photoId && avatarUrl(selectedCaller.photoId)}
							<img src={avatarUrl(selectedCaller.photoId) ?? ''} alt="" class="h-3.5 w-3.5 shrink-0 rounded-full object-cover" />
						{/if}
						<span class="truncate">{callerLabel(callerId)}</span>
						<button type="button" onclick={() => toggleCaller(callerId)} disabled={disabled} aria-label={`Remove ${callerLabel(callerId)}`} class="cursor-pointer text-g4 hover:text-red"><X class="h-2.5 w-2.5" /></button>
					</span>
				{/each}
			</div>
		{/if}
		{#if callers.length > 0}
			<div class="space-y-1 {uncappedCallerListOnMobile ? 'md:max-h-36 md:overflow-y-auto' : 'max-h-36 overflow-y-auto'}">
				{#each callers as caller (caller.id)}
					<button type="button" onclick={() => toggleCaller(caller.id)} disabled={disabled} class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors {callerIds.includes(caller.id) ? 'bg-grn/10 text-grn' : 'text-g7 hover:bg-wh/5 hover:text-tx'}">
						{#if caller.photoId && avatarUrl(caller.photoId)}
							<img src={avatarUrl(caller.photoId) ?? ''} alt="" class="h-5 w-5 shrink-0 rounded-full object-cover" />
						{:else}
							<span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-s7 text-[9px] font-bold text-g7">{caller.name[0]?.toUpperCase() ?? '?'}</span>
						{/if}
						<span class="truncate">{caller.name}</span>
					</button>
				{/each}
			</div>
		{:else if !loading}
			<p class="text-[10px] text-g5">No callers found.{callerIds.length === 0 ? ' Any caller is selected.' : ''}</p>
		{/if}
		{#if nextCursor}
			<button type="button" onclick={() => void loadCallers(callerSearch, nextCursor)} disabled={disabled || loadingMore} class="btn-secondary px-2 py-1 text-[10px] disabled:opacity-40">{loadingMore ? 'Loading…' : 'Load more callers'}</button>
		{/if}
	</div>

	<div class="space-y-2 rounded-lg border border-bd bg-s2 p-2.5">
		<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Metadata filters</span>
		{#if schema}
			<GeneratedFilterControls
				fields={schema.fields}
				revision={schema.revision}
				{historicalFields}
				value={metaFilter}
				disabled={disabled || loading}
				onchange={onfilterchange}
			/>
		{:else if loading}
			<p class="text-xs text-g5">Loading schema…</p>
		{:else}
			<p class="text-xs text-g5">Schema is not available.</p>
		{/if}
	</div>

	{#if sourceError || callerError || historyError}
		<div class="flex items-center justify-between gap-2">
			<p role="alert" class="text-xs text-red">{sourceError || callerError || historyError}</p>
			<button type="button" onclick={retryFailedLoad} disabled={disabled || !integrationId} class="btn-secondary px-2 py-1 text-xs disabled:opacity-40">Retry</button>
		</div>
	{/if}
</div>
