<script lang="ts">
	import { untrack } from 'svelte';
	import type { CustomMetaFilter, CustomMetaPredicate, CustomSignalFieldDefinition } from './contracts';
	import { canonicalDecimalFromJsonNumber, isExactJsonNumber, jsonNumberFromText } from './json-number';
	import {
		assertMetaFilterEnvelope,
		canonicalizeMetaFilter,
		compareMetaPredicates,
		metaPredicateIdentity,
		reconcileMetaFilter,
		type MetaFilterReconciliation
	} from './predicates';
	import { allowedOperatorsForField, type MetaOperator } from './schema';
	import type { HistoricalFilterFieldDefinition } from './schema';

	let {
		fields,
		revision,
		historicalFields = [],
		value = $bindable<CustomMetaFilter>([]),
		disabled = false,
		onchange = (_filter: CustomMetaFilter) => {}
	}: {
		fields: CustomSignalFieldDefinition[];
		revision: number;
		historicalFields?: HistoricalFilterFieldDefinition[];
		value?: CustomMetaFilter;
		disabled?: boolean;
		onchange?: (filter: CustomMetaFilter) => void;
	} = $props();

	const operatorLabels: Record<MetaOperator, string> = {
		eq: 'equals',
		contains: 'contains',
		in: 'is any of',
		gte: 'at least',
		lte: 'at most',
		exists: 'presence',
		countEq: 'item count equals',
		countGte: 'item count at least',
		countLte: 'item count at most',
		containsAny: 'contains any',
		containsAll: 'contains all',
		itemContains: 'an item contains',
		itemEq: 'an item equals',
		itemGte: 'an item is at least',
		itemLte: 'an item is at most',
		itemBetween: 'an item is between'
	};

	let selectedFieldKey = $state('');
	let selectedOperator = $state<MetaOperator | ''>('');
	let textValue = $state('');
	let selectedValues = $state<string[]>([]);
	let stringValues = $state<string[]>(['']);
	let booleanValue = $state(true);
	let rangeMin = $state('');
	let rangeMax = $state('');
	let error = $state('');
	let lastSchemaIdentity = $state('');
	let legacyReasons = $state(new Map<string, string>());

	const filterableFields = $derived(fields.filter((field) => field.filterable));
	const selectedField = $derived(filterableFields.find((field) => field.key === selectedFieldKey));
	const operators = $derived(selectedField ? allowedOperatorsForField(selectedField) : []);

	function resetOperand(): void {
		textValue = '';
		selectedValues = [];
		stringValues = [''];
		booleanValue = true;
		rangeMin = '';
		rangeMax = '';
		error = '';
	}

	function selectField(event: Event): void {
		selectedFieldKey = (event.currentTarget as HTMLSelectElement).value;
		const field = filterableFields.find((candidate) => candidate.key === selectedFieldKey);
		selectedOperator = field ? allowedOperatorsForField(field)[0] ?? '' : '';
		resetOperand();
	}

	function selectOperator(event: Event): void {
		selectedOperator = (event.currentTarget as HTMLSelectElement).value as MetaOperator;
		resetOperand();
	}

	function isStringSetOperator(operator: MetaOperator | ''): boolean {
		return operator === 'in' || operator === 'containsAny' || operator === 'containsAll';
	}

	function isCountOperator(operator: MetaOperator | ''): boolean {
		return operator === 'countEq' || operator === 'countGte' || operator === 'countLte';
	}

	function isNumberOperator(operator: MetaOperator | ''): boolean {
		return ['eq', 'gte', 'lte', 'itemEq', 'itemGte', 'itemLte'].includes(operator) &&
			(selectedField?.type === 'number' || selectedField?.type === 'list' && selectedField.itemType === 'number');
	}

	function inputValue(): unknown {
		if (!selectedField || !selectedOperator) throw new Error('Select a field and condition');
		if (selectedOperator === 'exists') return booleanValue;
		if (selectedField.type === 'boolean') return booleanValue;
		if (selectedOperator === 'itemBetween') {
			if (!rangeMin.trim() || !rangeMax.trim()) throw new Error('Enter both range values');
			return { min: jsonNumberFromText(rangeMin), max: jsonNumberFromText(rangeMax) };
		}
		if (isCountOperator(selectedOperator)) {
			if (!textValue.trim()) throw new Error('Enter a number');
			return Number(textValue);
		}
		if (isNumberOperator(selectedOperator)) {
			if (!textValue.trim()) throw new Error('Enter a number');
			return jsonNumberFromText(textValue);
		}
		if (isStringSetOperator(selectedOperator)) {
			if ('options' in selectedField) return selectedValues;
			return stringValues;
		}
		return textValue;
	}

	function emit(next: CustomMetaFilter): void {
		value = next;
		onchange(next);
	}

	function addPredicate(): void {
		try {
			if (!selectedField || !selectedOperator) throw new Error('Select a field and condition');
			const draft = { field: selectedField.key, op: selectedOperator, value: inputValue() };
			const current = reconcileMetaFilter(value, fields, historicalFields);
			const nextEditable = canonicalizeMetaFilter([...current.editable, draft], fields);
			const added = nextEditable.find((predicate) => !current.editable.some((item) => metaPredicateIdentity(item) === metaPredicateIdentity(predicate)));
			if (added && current.legacy.some((item) => metaPredicateIdentity(item.predicate) === metaPredicateIdentity(added))) {
				throw new Error('This legacy filter already exists');
			}
			const combined = [...nextEditable, ...current.legacy.map((item) => item.predicate)].sort(compareMetaPredicates) as CustomMetaFilter;
			assertMetaFilterEnvelope(combined);
			emit(reconcileMetaFilter(combined, fields, historicalFields).filter);
			resetOperand();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Invalid metadata filter';
		}
	}

	function removePredicate(index: number): void {
		try {
			emit(reconcileMetaFilter(value.filter((_, itemIndex) => itemIndex !== index), fields, historicalFields).filter);
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Invalid metadata filter';
		}
	}

	function reset(): void {
		emit([]);
		error = '';
	}

	function updateStringValue(index: number, event: Event): void {
		const next = [...stringValues];
		next[index] = (event.currentTarget as HTMLInputElement).value;
		stringValues = next;
	}

	function addStringValue(): void {
		if (stringValues.length < 64) stringValues = [...stringValues, ''];
	}

	function removeStringValue(index: number): void {
		stringValues = stringValues.filter((_, itemIndex) => itemIndex !== index);
		if (stringValues.length === 0) stringValues = [''];
	}

	function predicateText(predicate: CustomMetaPredicate): string {
		const shownValue = isExactJsonNumber(predicate.value)
			? canonicalDecimalFromJsonNumber(predicate.value)
			: Array.isArray(predicate.value)
			? predicate.value.join(', ')
			: typeof predicate.value === 'object'
				? `${canonicalDecimalFromJsonNumber(predicate.value.min)} to ${canonicalDecimalFromJsonNumber(predicate.value.max)}`
				: String(predicate.value);
		return `${predicate.field} ${operatorLabels[predicate.op as MetaOperator]} ${shownValue}`;
	}

	$effect(() => {
		const identity = `${revision}:${JSON.stringify(fields)}:${JSON.stringify(historicalFields)}:${JSON.stringify(value)}`;
		if (lastSchemaIdentity === identity) return;
		untrack(() => {
			let reconciled: MetaFilterReconciliation;
			try {
				reconciled = reconcileMetaFilter(value, fields, historicalFields);
			} catch (cause) {
				error = cause instanceof Error ? cause.message : 'Invalid metadata filter';
				legacyReasons = new Map();
				return;
			}
			lastSchemaIdentity = identity;
			legacyReasons = new Map(reconciled.legacy.map((item) => [metaPredicateIdentity(item.predicate), item.reason]));
			if (JSON.stringify(reconciled.filter) !== JSON.stringify(value)) emit(reconciled.filter);
			const first = fields.find((field) => field.filterable);
			selectedFieldKey = first?.key ?? '';
			selectedOperator = first ? allowedOperatorsForField(first)[0] ?? '' : '';
			resetOperand();
		});
	});
</script>

<div class="space-y-3" data-custom-signal-filters>
	{#if filterableFields.length === 0}
		<p class="text-xs text-g5">This integration has no metadata filters.</p>
	{:else}
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<label class="space-y-1">
				<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Field</span>
				<select
					value={selectedFieldKey}
					onchange={selectField}
					disabled={disabled}
					class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none focus:border-bd3"
				>
					{#each filterableFields as field}
						<option value={field.key}>{field.key}</option>
					{/each}
				</select>
			</label>
			<label class="space-y-1">
				<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Condition</span>
				<select
					value={selectedOperator}
					onchange={selectOperator}
					disabled={disabled}
					class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none focus:border-bd3"
				>
					{#each operators as operator}
						<option value={operator}>{operatorLabels[operator]}</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="space-y-1">
			<span class="text-[10px] font-medium uppercase tracking-wider text-g5">Value</span>
			{#if selectedOperator === 'exists' || selectedField?.type === 'boolean'}
				<select bind:value={booleanValue} disabled={disabled} aria-label="Filter value" class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none focus:border-bd3">
					<option value={true}>{selectedOperator === 'exists' ? 'has a value' : 'true'}</option>
					<option value={false}>{selectedOperator === 'exists' ? 'has no value' : 'false'}</option>
				</select>
			{:else if selectedOperator === 'itemBetween'}
				<div class="grid grid-cols-2 gap-2">
					<input value={rangeMin} oninput={(event) => rangeMin = event.currentTarget.value} disabled={disabled} type="number" aria-label="Minimum item value" placeholder="Minimum" class="rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none placeholder:text-g4 focus:border-bd3" />
					<input value={rangeMax} oninput={(event) => rangeMax = event.currentTarget.value} disabled={disabled} type="number" aria-label="Maximum item value" placeholder="Maximum" class="rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none placeholder:text-g4 focus:border-bd3" />
				</div>
			{:else if isStringSetOperator(selectedOperator) && selectedField && 'options' in selectedField}
				<select bind:value={selectedValues} multiple disabled={disabled} aria-label="Filter values" class="min-h-24 w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none focus:border-bd3">
					{#each selectedField.options as option}
						<option value={option}>{option}</option>
					{/each}
				</select>
			{:else if isStringSetOperator(selectedOperator)}
				<div class="space-y-2">
					{#each stringValues as item, index}
						<div class="flex items-center gap-2">
							<input value={item} oninput={(event) => updateStringValue(index, event)} disabled={disabled} type="text" aria-label={`Filter value ${index + 1}`} placeholder="Exact item value" class="min-w-0 flex-1 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none placeholder:text-g4 focus:border-bd3" />
							{#if stringValues.length > 1}
								<button type="button" class="cursor-pointer text-xs text-g5 hover:text-tx" disabled={disabled} aria-label={`Remove value ${index + 1}`} onclick={() => removeStringValue(index)}>Remove</button>
							{/if}
						</div>
					{/each}
					<button type="button" class="cursor-pointer text-xs text-g5 hover:text-tx" disabled={disabled || stringValues.length >= 64} onclick={addStringValue}>Add value</button>
				</div>
			{:else}
				<input
					value={textValue}
					oninput={(event) => textValue = event.currentTarget.value}
					disabled={disabled}
					type={isCountOperator(selectedOperator) || isNumberOperator(selectedOperator) ? 'number' : 'text'}
					min={isCountOperator(selectedOperator) ? 0 : selectedField && 'min' in selectedField ? selectedField.min : undefined}
					max={isCountOperator(selectedOperator) ? 64 : selectedField && 'max' in selectedField ? selectedField.max : undefined}
					aria-label="Filter value"
					placeholder="Value"
					class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none placeholder:text-g4 focus:border-bd3"
				/>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			<button type="button" class="btn-secondary px-3 py-1.5 text-xs" disabled={disabled} onclick={addPredicate}>Add filter</button>
			{#if value.length > 0}
				<button type="button" class="cursor-pointer text-xs text-g5 hover:text-tx" disabled={disabled} onclick={reset}>Reset</button>
			{/if}
		</div>
	{/if}

	{#if error}<p role="alert" class="text-xs text-red">{error}</p>{/if}

	{#if value.length > 0}
		<ul class="space-y-1" aria-label="Active metadata filters">
			{#each value as predicate, index (`${predicate.field}:${predicate.op}:${JSON.stringify(predicate.value)}`)}
				<li class="flex items-center justify-between gap-2 rounded-lg bg-s2 px-2.5 py-2 text-xs text-g7">
					<span class="min-w-0 truncate" title={legacyReasons.get(metaPredicateIdentity(predicate))}>{predicateText(predicate)}</span>
					{#if legacyReasons.has(metaPredicateIdentity(predicate))}
						<span class="shrink-0 rounded bg-yel/10 px-1.5 py-0.5 text-[10px] font-medium text-yel">Legacy</span>
					{/if}
					<button type="button" class="-m-1.5 shrink-0 cursor-pointer p-1.5 text-g4 hover:text-tx" disabled={disabled} aria-label={`Remove ${predicate.field} filter`} onclick={() => removePredicate(index)}>Remove</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
