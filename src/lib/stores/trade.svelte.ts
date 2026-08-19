import { api } from '$lib/api/client';
import type {
  ActiveTrade, CompletedTrade, ManagedWallet, WalletAsset,
  ActiveTradesResponse, CompletedTradesResponse,
  TradePreset, TradePresetsResponse, TradePresetSlot,
  TradeSettings, Chain, GasPreset, ErrorResponse,
  TradeFeeEstimateResponse, BuyStrategy, BuyAmount,
  TradeTargetConfig, TradeTargetTrigger,
} from '$lib/api/client';
import { getIsLoggedIn } from '$lib/stores/auth.svelte';
import { isUsd } from '$lib/stores/currency.svelte';
import { addToast, updateToast, type ToastDetail } from '$lib/stores/toast.svelte';
import { formatNumber, formatUsd, formatCompactNumber, shortAddress, explorerTxUrl } from '$lib/utils/format';
import { positivePercentTargetTrigger } from '$lib/utils/trade-targets';
import type { CursorTriplet } from '$lib/utils/livecursor';
import { mergeCompletedTrades, sortCompletedTrades } from '$lib/utils/completed-trades';
import type { FeeEstimate } from '$lib/api/client';
import { subscribe, unsubscribe } from '$lib/ws/client';

export type TradeTab = 'buy' | 'sell';
export type PositionTab = 'active' | 'pending' | 'history';
export type OrderType = 'MARKET' | 'DIP' | 'LIMIT';
export type SellTargetKind = 'MULTIPLE' | 'PERCENTAGE' | 'MARKETCAP' | 'USD';
export type StopLossKind = 'PERCENTAGE' | 'PRICE' | 'MARKETCAP';
export type TargetKind = 'TAKE_PROFIT' | 'STOP_LOSS';

export interface SellTargetRow {
  kind: SellTargetKind;
  triggerValue: string;
  sellPercent: string;
  targetKind: TargetKind;
  mode: 'NORMAL' | 'TRAILING';
}

export interface StopLossState {
  enabled: boolean;
  mode: 'NORMAL' | 'TRAILING';
  kind: StopLossKind;
  triggerValue: string;
  sellPercent: string;
}

let activeTradeTab = $state<TradeTab>('buy');
let orderType = $state<OrderType>('MARKET');
let buyAmount = $state('');
let sellPercent = $state(100);
let buyGasType = $state<GasPreset>('AUTO');
let sellGasType = $state<GasPreset>('AUTO');
let slippageBuy = $state<number | null>(null);
let slippageSell = $state<number | null>(null);
let antiMev = $state(false);
let dipPercent = $state('10');
let limitPrice = $state('');

let activeTrades = $state<ActiveTrade[]>([]);
let completedTrades = $state<CompletedTrade[]>([]);
// Whether the completed/history page was ever actually fetched (vs. seeded only
// by a WS trade moving from active→completed). Gates the initial history load so
// a sold trade appearing before history was opened doesn't suppress the fetch.
let completedFetched = $state(false);
let activeLoading = $state(false);
let completedLoading = $state(false);
let activeHasMore = $state(false);
let completedHasMore = $state(false);
// Server-reported totals (may exceed the loaded/paginated arrays). The active
// endpoint reports ACTIVE and PENDING totals separately (they share one list).
let activePositionsTotal = $state<number | null>(null);
let pendingTradesTotal = $state<number | null>(null);
let completedTotalCount = $state<number | null>(null);
let activeCursor = $state<string | undefined>(undefined);
let completedCursor = $state<string | undefined>(undefined);
let activePrevCursor = $state<string | undefined>(undefined);
let completedPrevCursor = $state<string | undefined>(undefined);
let activeNextCursor = $state<string | undefined>(undefined);
let completedNextCursor = $state<string | undefined>(undefined);

let managedWallets = $state<Record<string, ManagedWallet>>({});

let sellTargets = $state<SellTargetRow[]>([]);
let stopLoss = $state<StopLossState>({ enabled: false, mode: 'NORMAL', kind: 'PERCENTAGE', triggerValue: '50', sellPercent: '100' });

let buyLoading = $state(false);
let sellLoading = $state(false);
let tradeError = $state<string | null>(null);

let feeEstimate = $state<TradeFeeEstimateResponse | null>(null);
// Live per-chain fee estimate (all tiers) from the `fee-estimate:{chain}` WS.
let feeEstimateLive = $state<FeeEstimate | null>(null);
let feeEstimateWsKey: string | null = null;
let feeEstimateChain: Chain | null = null;

function feeTierFor(fe: FeeEstimate, gasType: GasPreset): TradeFeeEstimateResponse {
  const pick = gasType === 'LOW' ? 'low' : gasType === 'HIGH' ? 'high' : gasType === 'MEDIUM' ? 'medium' : 'automatic';
  return {
    gasFeeNative: fe[`${pick}Native` as const] as number,
    gasFeeNativeStr: fe[`${pick}NativeStr` as const] as string,
    gasFeeUsd: fe[`${pick}Usd` as const] as number,
    gasFeeUsdStr: fe[`${pick}UsdStr` as const] as string
  };
}

// Subscribe to the live per-chain fee estimate. Re-subscribes when the chain
// changes; the WS delivers all tiers so the selected gas type is derived
// locally without refetching on every gas-type change.
export function subscribeFeeEstimate(chain: Chain) {
  if (feeEstimateChain === chain && feeEstimateWsKey) return;
  if (feeEstimateWsKey) { unsubscribe(feeEstimateWsKey); feeEstimateWsKey = null; }
  feeEstimateChain = chain;
  feeEstimateLive = null;
  feeEstimateWsKey = subscribe(`fee-estimate:${chain}`, (event, data) => {
    if (event !== 'FEE_ESTIMATE' || !data) return;
    feeEstimateLive = data as FeeEstimate;
  });
}

export function unsubscribeFeeEstimate() {
  if (feeEstimateWsKey) { unsubscribe(feeEstimateWsKey); feeEstimateWsKey = null; }
  feeEstimateChain = null;
  feeEstimateLive = null;
}

// The fee for the currently-selected gas type: prefer the live WS tiers, fall
// back to the single-tier REST estimate.
export function getFeeEstimateFor(gasType: GasPreset): TradeFeeEstimateResponse | null {
  if (feeEstimateLive) return feeTierFor(feeEstimateLive, gasType);
  return feeEstimate;
}

export function getLiveFeeEstimate(): FeeEstimate | null {
  return feeEstimateLive;
}

const EMPTY_TRADE_PRESETS: TradePresetsResponse = { S1: null, S2: null, S3: null };
let tradePresets = $state<TradePresetsResponse>({ ...EMPTY_TRADE_PRESETS });
let tradePresetsLoading = $state(false);
let selectedPresetSlot = $state<TradePresetSlot | null>(null);

export function getActiveTradeTab() { return activeTradeTab; }
export function setActiveTradeTab(t: TradeTab) { activeTradeTab = t; }
export function getOrderType() { return orderType; }
export function setOrderType(t: OrderType) { orderType = t; }
export function getBuyAmount() { return buyAmount; }
export function setBuyAmount(v: string) { buyAmount = v; }
export function getSellPercent() { return sellPercent; }
export function setSellPercent(v: number) { sellPercent = v; }
export function getBuyGasType() { return buyGasType; }
export function setBuyGasType(v: GasPreset) { buyGasType = v; }
export function getSellGasType() { return sellGasType; }
export function setSellGasType(v: GasPreset) { sellGasType = v; }
export function getSlippageBuy() { return slippageBuy; }
export function setSlippageBuy(v: number | null) { slippageBuy = v; }
export function getSlippageSell() { return slippageSell; }
export function setSlippageSell(v: number | null) { slippageSell = v; }
export function getAntiMev() { return antiMev; }
export function setAntiMev(v: boolean) { antiMev = v; }
export function getDipPercent() { return dipPercent; }
export function setDipPercent(v: string) { dipPercent = v; }
export function getLimitPrice() { return limitPrice; }
export function setLimitPrice(v: string) { limitPrice = v; }

export function getActiveTrades() { return activeTrades; }
export function getCompletedTrades() { return completedTrades; }
export function getCompletedFetched() { return completedFetched; }
export function getActiveLoading() { return activeLoading; }
export function getCompletedLoading() { return completedLoading; }
export function getActiveHasMore() { return activeHasMore; }
export function getCompletedHasMore() { return completedHasMore; }
export function getActiveCursor() { return activeCursor; }
export function getCompletedCursor() { return completedCursor; }
export function getActiveCursorTriplet(): CursorTriplet { return { cursor: activeCursor, prevCursor: activePrevCursor, nextCursor: activeNextCursor }; }
export function getCompletedCursorTriplet(): CursorTriplet { return { cursor: completedCursor, prevCursor: completedPrevCursor, nextCursor: completedNextCursor }; }
export function getActiveNextCursor() { return activeNextCursor; }
export function getCompletedNextCursor() { return completedNextCursor; }
export function getBuyLoading() { return buyLoading; }
export function getSellLoading() { return sellLoading; }
export function getTradeError() { return tradeError; }
export function clearTradeError() { tradeError = null; }
export function getFeeEstimate() {
  if (feeEstimateLive) return feeTierFor(feeEstimateLive, buyGasType);
  return feeEstimate;
}
export function getManagedWallets() { return managedWallets; }

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error !== 'object') return fallback;

  const record = error as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail', 'title']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  const detail = record.detail;
  if (detail && typeof detail === 'object') {
    const detailMessage = (detail as Record<string, unknown>).message;
    if (typeof detailMessage === 'string' && detailMessage.trim()) return detailMessage;
  }

  return fallback;
}

type TradeFailureSide = 'BUY' | 'SELL';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function normalizeTradeSide(value: unknown): TradeFailureSide | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase();
  return upper === 'BUY' || upper === 'SELL' ? upper : undefined;
}

function parseNumericId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  const record = asRecord(value);
  if (record) return parseNumericId(record.id);
  return undefined;
}

function collectNumericIds(...values: unknown[]): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const id = parseNumericId(item);
        if (id !== undefined) ids.add(id);
      }
      continue;
    }

    const id = parseNumericId(value);
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

function tradeUpdateErrorDetail(data: unknown): Record<string, unknown> | undefined {
  const detail = data && typeof data === 'object'
    ? (data as Record<string, unknown>).detail
    : undefined;
  return asRecord(detail);
}

function tradeUpdateErrorMessage(data: unknown, side?: TradeFailureSide): string {
  const detail = tradeUpdateErrorDetail(data);
  return errorMessage(detail ?? data, tradeFailureFallback(side));
}

function tradeFailureSwapIds(data: unknown): number[] {
  const payload = asRecord(data);
  const detail = tradeUpdateErrorDetail(data);
  return collectNumericIds(
    detail?.swapIds,
    detail?.swapId,
    detail?.swap_ids,
    detail?.swap_id,
    payload?.swapIds,
    payload?.swapId,
    payload?.swap_ids,
    payload?.swap_id
  );
}

function tradeFailureSideFromPendingSwap(tradeIds: number[], swapIds: number[]): TradeFailureSide | undefined {
  const swapIdSet = new Set(swapIds);
  const candidateTrades = tradeIds.length > 0
    ? activeTrades.filter(trade => tradeIds.includes(trade.id))
    : activeTrades;

  for (const trade of candidateTrades) {
    const pending = trade.pendingSwaps ?? [];
    if (swapIdSet.size > 0) {
      const matched = pending.find(swap => swapIdSet.has(swap.id));
      const side = normalizeTradeSide(matched?.side);
      if (side) return side;
    }

    if (tradeIds.length > 0) {
      const sides = pending
        .map(swap => normalizeTradeSide(swap.side))
        .filter((value): value is TradeFailureSide => !!value);
      if (sides.length === 1) return sides[0];
      if (sides.length > 1 && sides.every(value => value === sides[0])) return sides[0];
    }
  }
}

function tradeFailureSide(data: unknown, meta?: Record<string, unknown>): TradeFailureSide | undefined {
  const payload = asRecord(data);
  const detail = tradeUpdateErrorDetail(data);

  const direct = normalizeTradeSide(detail?.side)
    ?? normalizeTradeSide(detail?.swapType)
    ?? normalizeTradeSide(detail?.swap_type)
    ?? normalizeTradeSide(detail?.action)
    ?? normalizeTradeSide(payload?.side)
    ?? normalizeTradeSide(payload?.swapType)
    ?? normalizeTradeSide(payload?.swap_type)
    ?? normalizeTradeSide(payload?.action);
  if (direct) return direct;

  const tradeIds = collectNumericIds(meta?.affectedTradeIds, meta?.affected_trade_ids);
  return tradeFailureSideFromPendingSwap(tradeIds, tradeFailureSwapIds(data));
}

function tradeFailureTitle(side: TradeFailureSide | undefined): string {
  if (side === 'BUY') return 'Buy Failed';
  if (side === 'SELL') return 'Sell Failed';
  return 'Trade Failed';
}

function tradeFailureFallback(side: TradeFailureSide | undefined): string {
  if (side === 'BUY') return 'Buy failed';
  if (side === 'SELL') return 'Sell failed';
  return 'Trade failed';
}

export function getSellTargets() { return sellTargets; }
export function addSellTarget(targetKind: TargetKind = 'TAKE_PROFIT', mode: 'NORMAL' | 'TRAILING' = 'NORMAL') {
  const trailing = mode === 'TRAILING';
  sellTargets = [...sellTargets, {
    kind: trailing ? 'PERCENTAGE' : 'MULTIPLE',
    triggerValue: targetKind === 'TAKE_PROFIT' ? '2' : trailing ? '20' : '50',
    sellPercent: targetKind === 'TAKE_PROFIT' ? '50' : '100',
    targetKind: trailing ? 'STOP_LOSS' : targetKind,
    mode: trailing ? 'TRAILING' : 'NORMAL'
  }];
}
export function removeSellTarget(idx: number) { sellTargets = sellTargets.filter((_, i) => i !== idx); }
export function updateSellTarget(idx: number, target: SellTargetRow) { sellTargets = sellTargets.map((t, i) => i === idx ? target : t); }
export function getStopLoss() { return stopLoss; }
export function updateStopLossField<K extends keyof StopLossState>(key: K, value: StopLossState[K]) { stopLoss = { ...stopLoss, [key]: value }; }

export interface TradeConfigEntry { id: TradePresetSlot; name: string; preset: TradePreset; }
export function getTradeConfigs(): TradeConfigEntry[] {
  const entries: TradeConfigEntry[] = [];
  const slots: TradePresetSlot[] = ['S1', 'S2', 'S3'];
  for (const slot of slots) {
    const p = tradePresets[slot];
    if (p) entries.push({ id: slot, name: slot, preset: p });
  }
  return entries;
}
export function getTradeConfigsLoading() { return tradePresetsLoading; }
export function getSelectedConfigId() { return selectedPresetSlot; }
export function setSelectedConfigId(id: string | null) { selectedPresetSlot = id as TradePresetSlot | null; }
export function getTradeConfigsLimitRemaining() { return 0; }
export function applyTradePresetsSnapshot(snapshot: TradePresetsResponse) {
  tradePresets = snapshot;
  if (selectedPresetSlot && !tradePresets[selectedPresetSlot]) selectedPresetSlot = null;
}

export function getSelectedConfig(): TradeConfigEntry | undefined {
  if (!selectedPresetSlot) return undefined;
  const p = tradePresets[selectedPresetSlot];
  if (!p) return undefined;
  return { id: selectedPresetSlot, name: selectedPresetSlot, preset: p };
}

export async function fetchTradeConfigs() {
  if (!getIsLoggedIn()) return;
  tradePresetsLoading = true;
  try {
    const { data } = await api.GET('/v2/trade/presets');
    tradePresets = data ?? { ...EMPTY_TRADE_PRESETS };
    if (!selectedPresetSlot) {
      const slot = tradePresets.S1 ? 'S1' : tradePresets.S2 ? 'S2' : tradePresets.S3 ? 'S3' : null;
      if (slot) {
        const preset = tradePresets[slot];
        if (preset) loadConfigIntoForm({ id: slot, name: slot, preset });
      }
    }
  } catch {
    tradePresets = { ...EMPTY_TRADE_PRESETS };
  } finally {
    tradePresetsLoading = false;
  }
}

export async function createTradeConfig(_name: string) {
  const preset = buildPreset();
  if (!preset) return;
  const slot: TradePresetSlot = 'S1';
  try {
    const { data: resp, error } = await api.POST('/v2/trade/presets/{slot}/update', {
      params: { path: { slot } },
      body: preset
    });
    if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed to create preset');
    await fetchTradeConfigs();
    return resp;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to create preset';
    tradeError = msg;
    throw e;
  }
}

export async function updateTradeConfig(slot: string, _name?: string) {
  const preset = buildPreset();
  if (!preset) return;
  try {
    const { error } = await api.POST('/v2/trade/presets/{slot}/update', {
      params: { path: { slot: slot as TradePresetSlot } },
      body: preset
    });
    if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed to update preset');
    await fetchTradeConfigs();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to update preset';
    tradeError = msg;
    throw e;
  }
}

export async function deleteTradeConfig(slot: string) {
  try {
    const emptyPreset: TradePreset = {
      amount: { type: 'USD', value: 0 },
      strategy: { type: 'MARKET' },
      settings: {
        antiMev: false,
        buyGas: 'AUTO',
        buySlippagePct: 'AUTO',
        sellGas: 'AUTO',
        sellSlippagePct: 'AUTO',
        targets: []
      }
    };
    const { error } = await api.POST('/v2/trade/presets/{slot}/update', {
      params: { path: { slot: slot as TradePresetSlot } },
      body: emptyPreset
    });
    if (error) throw new Error((error as ErrorResponse)?.message ?? 'Failed to delete preset');
    if (selectedPresetSlot === slot) selectedPresetSlot = null;
    await fetchTradeConfigs();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to delete preset';
    tradeError = msg;
    throw e;
  }
}

export function loadConfigIntoForm(entry: TradeConfigEntry) {
  selectedPresetSlot = entry.id;
  const p = entry.preset;
  const s = p.settings;
  if (typeof s.buyGas === 'string') buyGasType = s.buyGas;
  if (typeof s.sellGas === 'string') sellGasType = s.sellGas;
  if (s.buySlippagePct === 'AUTO') slippageBuy = null;
  else slippageBuy = s.buySlippagePct as number;
  if (s.sellSlippagePct === 'AUTO') slippageSell = null;
  else slippageSell = s.sellSlippagePct as number;
  antiMev = s.antiMev;

  buyAmount = String(p.amount.value);
  if (p.strategy.type === 'MARKET') orderType = 'MARKET';
  else if (p.strategy.type === 'DIP') { orderType = 'DIP'; dipPercent = String(p.strategy.dipPct); }
  else if (p.strategy.type === 'LIMIT') { orderType = 'LIMIT'; limitPrice = String(p.strategy.priceUsd); }

  sellTargets = s.targets.map(t => {
    const trigger = t.trigger;
    let kind: SellTargetKind = 'MULTIPLE';
    let triggerValue = '';
    if (trigger.type === 'MULTIPLIER') { kind = 'MULTIPLE'; triggerValue = String((trigger as any).multiplier); }
    else if (trigger.type === 'PERCENT') { kind = 'PERCENTAGE'; triggerValue = String((trigger as any).changePct); }
    else if (trigger.type === 'PRICE') { kind = 'USD'; triggerValue = String((trigger as any).priceUsd); }
    else if (trigger.type === 'MARKET_CAP_USD') { kind = 'MARKETCAP'; triggerValue = String((trigger as any).marketCapUsd); }
    return {
      kind,
      triggerValue,
      sellPercent: String(t.sellPct),
      targetKind: t.kind as TargetKind,
      mode: ('mode' in t ? (t as any).mode : 'NORMAL') as 'NORMAL' | 'TRAILING'
    };
  });
}

export function getManagedWalletForChain(chain: Chain): ManagedWallet | undefined {
  return managedWallets[chain];
}

let managedWalletsInFlight: Promise<void> | null = null;
export async function fetchManagedWallets() {
  if (!getIsLoggedIn()) return;
  // Coalesce concurrent callers (layout mount + Navbar popover + page all fire on
  // load) onto one request; mutations can still refetch once this settles.
  if (managedWalletsInFlight) return managedWalletsInFlight;
  managedWalletsInFlight = (async () => {
    try {
      const { data } = await api.GET('/v2/user/wallets');
      managedWallets = data?.appWallets ?? {};
    } catch {
      managedWallets = {};
    } finally {
      managedWalletsInFlight = null;
    }
  })();
  return managedWalletsInFlight;
}

export function getPendingTrades(): ActiveTrade[] {
  return activeTrades.filter(t => t.status === 'PENDING');
}

export function getActivePositions(): ActiveTrade[] {
  return activeTrades.filter(t => t.status === 'ACTIVE');
}

// Server totals for the tab badges. Floored to the loaded/filtered length so a
// badge never shows fewer than what's actually rendered.
export function getActivePositionsTotal(): number {
  const loaded = activeTrades.filter(t => t.status === 'ACTIVE').length;
  return activePositionsTotal != null ? Math.max(activePositionsTotal, loaded) : loaded;
}
export function getPendingTradesTotal(): number {
  const loaded = activeTrades.filter(t => t.status === 'PENDING').length;
  return pendingTradesTotal != null ? Math.max(pendingTradesTotal, loaded) : loaded;
}
export function getCompletedTotalCount(): number {
  return completedTotalCount != null ? Math.max(completedTotalCount, completedTrades.length) : completedTrades.length;
}

export function getTradeForToken(chain: string, tokenAddress: string): ActiveTrade | undefined {
  return activeTrades.find(t =>
    t.chain === chain && t.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() && t.status === 'ACTIVE'
  );
}

type TradeWsTrade = ActiveTrade | CompletedTrade;
type TradeWsScope = 'ACTIVE' | 'COMPLETED';

interface TradeWsUpdateMeta {
  affectedTradeIds?: number[];
  removedTradeIds?: number[];
  tradeScope?: TradeWsScope;
  tradeUpdate?: string;
}

interface UserTradeUpdateData {
  trade?: unknown;
}

// Maps a confirmed swap's id → its "Swap Confirmed" toast id, so the later
// SWAP_FINALIZED frame (which carries the executed amounts) can upgrade the same
// toast in place instead of firing a second one. Bounded to avoid unbounded growth.
const confirmedSwapToasts = new Map<number, number>();
function rememberConfirmedToast(swapId: number, toastId: number) {
  confirmedSwapToasts.set(swapId, toastId);
  if (confirmedSwapToasts.size > 100) {
    const oldest = confirmedSwapToasts.keys().next().value;
    if (oldest !== undefined) confirmedSwapToasts.delete(oldest);
  }
}

function isTradeWsTrade(value: unknown): value is TradeWsTrade {
  if (!value || typeof value !== 'object') return false;
  const trade = value as { id?: unknown; status?: unknown };
  return typeof trade.id === 'number' && (
    trade.status === 'ACTIVE' ||
    trade.status === 'PENDING' ||
    trade.status === 'COMPLETED'
  );
}

function removeTradeIds(ids: unknown, scope?: TradeWsScope) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const idSet = new Set(ids.filter((id): id is number => typeof id === 'number'));
  if (idSet.size === 0) return;
  if (!scope || scope === 'ACTIVE') activeTrades = activeTrades.filter(t => !idSet.has(t.id));
  if (!scope || scope === 'COMPLETED') completedTrades = completedTrades.filter(t => !idSet.has(t.id));
}

function upsertTrade<T extends ActiveTrade | CompletedTrade>(trades: T[], updated: T): T[] {
  const idx = trades.findIndex(t => t.id === updated.id);
  if (idx < 0) return [updated, ...trades];
  return [
    ...trades.slice(0, idx),
    { ...trades[idx], ...updated },
    ...trades.slice(idx + 1)
  ];
}

// Tracks trade ids that have reached COMPLETED so a later out-of-order
// ACTIVE/PENDING frame (e.g. a sell POST response resolving after the WS
// COMPLETED frame) can't resurrect a finished trade back into the active list.
const completedTradeIds = new Set<number>();
function markCompleted(id: number) {
  completedTradeIds.add(id);
  if (completedTradeIds.size > 500) {
    const oldest = completedTradeIds.values().next().value;
    if (oldest !== undefined) completedTradeIds.delete(oldest);
  }
}

function patchTrade(updated: TradeWsTrade) {
  if (updated.status === 'COMPLETED') {
    markCompleted(updated.id);
    completedTrades = mergeCompletedTrades(completedTrades, [updated]);
    activeTrades = activeTrades.filter(t => t.id !== updated.id);
    return;
  }

  // A trade already known to be completed must never re-enter the active list,
  // regardless of frame ordering.
  if (completedTradeIds.has(updated.id)) {
    activeTrades = activeTrades.filter(t => t.id !== updated.id);
    return;
  }

  activeTrades = upsertTrade(activeTrades, updated);
  completedTrades = completedTrades.filter(t => t.id !== updated.id);
}

function assignActiveCursorTriplet(page: CursorTriplet | undefined | null) {
  activeCursor = page?.cursor ?? undefined;
  activePrevCursor = page?.prevCursor ?? undefined;
  activeNextCursor = page?.nextCursor ?? undefined;
  activeHasMore = !!page?.nextCursor;
}

function assignCompletedCursorTriplet(page: CursorTriplet | undefined | null) {
  completedCursor = page?.cursor ?? undefined;
  completedPrevCursor = page?.prevCursor ?? undefined;
  completedNextCursor = page?.nextCursor ?? undefined;
  completedHasMore = !!page?.nextCursor;
}

export async function fetchActiveTrades(tokenAddress?: string, chain?: Chain) {
  if (!getIsLoggedIn()) return;
  activeLoading = true;
  try {
    const { data } = await api.GET('/v2/trade/active');
    activeTrades = data?.trades ?? [];
    activePositionsTotal = data?.totalActiveCount ?? null;
    pendingTradesTotal = data?.totalPendingCount ?? null;
    assignActiveCursorTriplet(data);
  } catch {
    activeTrades = [];
    activePositionsTotal = null;
    pendingTradesTotal = null;
    assignActiveCursorTriplet(undefined);
  } finally {
    activeLoading = false;
  }
}

export async function fetchCompletedTrades(tokenAddress?: string, chain?: Chain) {
  if (!getIsLoggedIn()) return;
  completedLoading = true;
  try {
    const { data } = await api.GET('/v2/trade/completed');
    completedTrades = sortCompletedTrades(data?.trades ?? []);
    completedTotalCount = data?.totalCount ?? null;
    for (const t of data?.trades ?? []) markCompleted(t.id);
    assignCompletedCursorTriplet(data);
    completedFetched = true;
  } catch {
    completedTrades = [];
    completedTotalCount = null;
    assignCompletedCursorTriplet(undefined);
    completedFetched = false;
  } finally {
    completedLoading = false;
  }
}

export async function fetchMoreActive() {
  if (!activeHasMore || activeLoading || !activeNextCursor) return;
  activeLoading = true;
  try {
    const { data } = await api.GET('/v2/trade/active', {
      params: { query: { cursor: activeNextCursor } }
    });
    activeTrades = [...activeTrades, ...(data?.trades ?? [])];
    assignActiveCursorTriplet(data);
  } catch {} finally {
    activeLoading = false;
  }
}

export async function fetchMoreCompleted() {
  if (!completedHasMore || completedLoading || !completedNextCursor) return;
  completedLoading = true;
  try {
    const { data } = await api.GET('/v2/trade/completed', {
      params: { query: { cursor: completedNextCursor } }
    });
    completedTrades = mergeCompletedTrades(completedTrades, data?.trades ?? []);
    for (const t of data?.trades ?? []) markCompleted(t.id);
    assignCompletedCursorTriplet(data);
  } catch {} finally {
    completedLoading = false;
  }
}

export async function fetchFeeEstimate(chain: Chain, gasType: GasPreset) {
  try {
    const { data } = await api.GET('/v2/trade/{chain}/fee-estimate', {
      params: { path: { chain }, query: { type: gasType } }
    });
    feeEstimate = data ?? null;
  } catch {
    feeEstimate = null;
  }
}

function buildStrategy(): BuyStrategy {
  if (orderType === 'DIP') {
    const pct = dipPercent.trim();
    if (!pct || parseFloat(pct) <= 0) return { type: 'MARKET' };
    return { type: 'DIP', dipPct: parseFloat(pct) };
  }
  if (orderType === 'LIMIT') {
    const price = limitPrice.trim();
    if (!price || parseFloat(price) <= 0) return { type: 'MARKET' };
    return { type: 'LIMIT', priceUsd: parseFloat(price) };
  }
  return { type: 'MARKET' };
}

function rowToTrigger(row: SellTargetRow): TradeTargetTrigger {
  const val = parseFloat(row.triggerValue);
  if (isNaN(val)) return { type: 'MULTIPLIER', multiplier: 2 } as TradeTargetTrigger;
  switch (row.kind) {
    case 'MULTIPLE': return { type: 'MULTIPLIER', multiplier: val } as TradeTargetTrigger;
    case 'PERCENTAGE': return positivePercentTargetTrigger(val);
    case 'MARKETCAP': return { type: 'MARKET_CAP_USD', marketCapUsd: val } as TradeTargetTrigger;
    case 'USD': return { type: 'PRICE', priceUsd: val } as TradeTargetTrigger;
    default: return { type: 'MULTIPLIER', multiplier: val } as TradeTargetTrigger;
  }
}

function rowToTargetConfig(row: SellTargetRow): TradeTargetConfig | null {
  const sellPct = parseFloat(row.sellPercent);
  if (isNaN(sellPct) || sellPct <= 0) return null;
  const trigger = rowToTrigger(row);
  if (row.targetKind === 'STOP_LOSS') {
    return { kind: 'STOP_LOSS', sellPct, trigger, mode: row.mode } as TradeTargetConfig;
  }
  return { kind: 'TAKE_PROFIT', sellPct, trigger } as TradeTargetConfig;
}

function buildTargets(): TradeTargetConfig[] {
  const configs: TradeTargetConfig[] = [];
  for (const row of sellTargets) {
    const cfg = rowToTargetConfig(row);
    if (cfg) configs.push(cfg);
  }
  if (stopLoss.enabled) {
    const val = parseFloat(stopLoss.triggerValue);
    const sellPct = parseFloat(stopLoss.sellPercent);
    if (!isNaN(val) && !isNaN(sellPct) && sellPct > 0) {
      let trigger: TradeTargetTrigger;
      switch (stopLoss.kind) {
        case 'PERCENTAGE': trigger = positivePercentTargetTrigger(val); break;
        case 'PRICE': trigger = { type: 'PRICE', priceUsd: val } as TradeTargetTrigger; break;
        case 'MARKETCAP': trigger = { type: 'MARKET_CAP_USD', marketCapUsd: val } as TradeTargetTrigger; break;
        default: trigger = positivePercentTargetTrigger(val);
      }
      configs.push({ kind: 'STOP_LOSS', sellPct, trigger, mode: stopLoss.mode } as TradeTargetConfig);
    }
  }
  return configs;
}

function buildSettings(): TradeSettings {
  return {
    antiMev,
    buyGas: buyGasType,
    buySlippagePct: slippageBuy === null ? 'AUTO' : slippageBuy,
    sellGas: sellGasType,
    sellSlippagePct: slippageSell === null ? 'AUTO' : slippageSell,
    targets: buildTargets()
  };
}

function buildPreset(): TradePreset | null {
  const amountVal = parseFloat(buyAmount);
  if (isNaN(amountVal) || amountVal <= 0) return null;
  return {
    amount: { type: 'USD', value: amountVal },
    strategy: buildStrategy(),
    settings: buildSettings()
  };
}

export async function executeBuy(chain: Chain, tokenAddress: string, presetSlot?: string | null) {
  const managed = getManagedWalletForChain(chain);
  if (!managed) {
    const msg = `No managed wallet found for ${chain}. Check your profile wallets.`;
    tradeError = msg;
    throw new Error(msg);
  }
  if (!buyAmount) return;

  buyLoading = true;
  tradeError = null;

  try {
    const amountType = isUsd() ? 'USD' as const : 'NATIVE' as const;
    const decimals = amountType === 'NATIVE' ? (chain === 'SOL' ? 9 : 18) : 2;
    const amountVal = parseFloat(parseFloat(buyAmount).toFixed(decimals));
    if (isNaN(amountVal) || amountVal <= 0) throw new Error('Invalid amount');

    const slot = presetSlot ?? selectedPresetSlot;

    const body = slot
      ? {
          preset: slot as TradePresetSlot,
          amount: { type: amountType, value: amountVal },
          // The form mirrors the loaded preset, so this is the user's current
          // visible order type. Omitting it would make the API fall back to the
          // preset's stored strategy (e.g. DIP) even when MARKET is selected.
          strategy: buildStrategy()
        }
      : {
          amount: { type: amountType, value: amountVal },
          strategy: buildStrategy(),
          settings: buildSettings()
        };

    const { data, error } = await api.POST('/v2/trade/{chain}/{token}/buy', {
      params: { path: { chain, token: tokenAddress } },
      body
    });

    if (error) throw new Error(errorMessage(error, 'Buy failed'));

    buyAmount = '';
    if (isTradeWsTrade(data?.trade)) patchTrade(data.trade);
    return data;
  } catch (e: unknown) {
    const msg = errorMessage(e, 'Buy failed');
    tradeError = msg;
    throw new Error(msg);
  } finally {
    buyLoading = false;
  }
}

export async function executeSell(chain: Chain, tokenAddress: string, _tradeId?: number) {
  const managed = getManagedWalletForChain(chain);
  if (!managed) {
    const msg = `No managed wallet found for ${chain}`;
    tradeError = msg;
    throw new Error(msg);
  }

  sellLoading = true;
  tradeError = null;

  try {
    const pct = Math.max(1, Math.min(100, sellPercent));

    const { data, error } = await api.POST('/v2/trade/{chain}/{token}/sell', {
      params: { path: { chain, token: tokenAddress } },
      body: { pct }
    });

    if (error) throw new Error(errorMessage(error, 'Sell failed'));

    if (isTradeWsTrade(data?.trade)) patchTrade(data.trade);
    return data;
  } catch (e: unknown) {
    const msg = errorMessage(e, 'Sell failed');
    tradeError = msg;
    throw new Error(msg);
  } finally {
    sellLoading = false;
  }
}

let quickTradeLoading = $state<Record<string, boolean>>({});
let quickTradeError = $state<Record<string, string | null>>({});

function quickKey(chain: string, tokenAddress: string): string {
  return `${chain}:${tokenAddress}`;
}

export function getQuickTradeLoading(chain: string, tokenAddress: string): boolean {
  return !!quickTradeLoading[quickKey(chain, tokenAddress)];
}

export function getQuickTradeError(chain: string, tokenAddress: string): string | null {
  return quickTradeError[quickKey(chain, tokenAddress)] ?? null;
}

export function clearQuickTradeError(chain: string, tokenAddress: string) {
  quickTradeError[quickKey(chain, tokenAddress)] = null;
}

export async function quickBuy(chain: Chain, tokenAddress: string, amount: number, amountType: 'USD' | 'NATIVE') {
  const key = quickKey(chain, tokenAddress);
  const managed = getManagedWalletForChain(chain);
  if (!managed) {
    quickTradeError[key] = `No managed wallet for ${chain}`;
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    quickTradeError[key] = 'Invalid amount';
    return;
  }
  quickTradeLoading[key] = true;
  quickTradeError[key] = null;
  try {
    const decimals = amountType === 'NATIVE' ? (chain === 'SOL' ? 9 : 18) : 2;
    const amountVal = parseFloat(amount.toFixed(decimals));
    const { data, error } = await api.POST('/v2/trade/{chain}/{token}/buy', {
      params: { path: { chain, token: tokenAddress } },
      body: {
        amount: { type: amountType, value: amountVal },
        strategy: { type: 'MARKET' },
        settings: {
          antiMev,
          buyGas: buyGasType,
          buySlippagePct: slippageBuy === null ? 'AUTO' : slippageBuy,
          sellGas: sellGasType,
          sellSlippagePct: slippageSell === null ? 'AUTO' : slippageSell,
          targets: []
        }
      }
    });
    if (error) throw new Error(errorMessage(error, 'Buy failed'));
    if (isTradeWsTrade(data?.trade)) patchTrade(data.trade);
    return data;
  } catch (e: unknown) {
    quickTradeError[key] = errorMessage(e, 'Buy failed');
  } finally {
    quickTradeLoading[key] = false;
  }
}

export async function quickSell(chain: Chain, tokenAddress: string, pct: number) {
  const key = quickKey(chain, tokenAddress);
  const managed = getManagedWalletForChain(chain);
  if (!managed) {
    quickTradeError[key] = `No managed wallet for ${chain}`;
    return;
  }
  quickTradeLoading[key] = true;
  quickTradeError[key] = null;
  try {
    const clamped = Math.max(1, Math.min(100, pct));
    const { data, error } = await api.POST('/v2/trade/{chain}/{token}/sell', {
      params: { path: { chain, token: tokenAddress } },
      body: { pct: clamped }
    });
    if (error) throw new Error(errorMessage(error, 'Sell failed'));
    if (isTradeWsTrade(data?.trade)) patchTrade(data.trade);
    return data;
  } catch (e: unknown) {
    quickTradeError[key] = errorMessage(e, 'Sell failed');
  } finally {
    quickTradeLoading[key] = false;
  }
}

export async function abortTrade(tradeId: number) {
  tradeError = null;
  const trade = activeTrades.find(t => t.id === tradeId);
  if (!trade) {
    tradeError = 'Trade not found';
    return;
  }
  try {
    const { error } = await api.POST('/v2/trade/{chain}/{token}/cancel', {
      params: { path: { chain: trade.chain, token: trade.tokenAddress } },
      body: { mode: 'PENDING' }
    });
    if (error) throw new Error((error as ErrorResponse)?.message ?? 'Abort failed');
    await fetchActiveTrades();
  } catch (e: unknown) {
    tradeError = e instanceof Error ? e.message : 'Abort failed';
  }
}

export async function dismissTrade(tradeId: number) {
  tradeError = null;
  const trade = activeTrades.find(t => t.id === tradeId);
  if (!trade) {
    tradeError = 'Trade not found';
    return;
  }
  try {
    const { error } = await api.POST('/v2/trade/{chain}/{token}/cancel', {
      params: { path: { chain: trade.chain, token: trade.tokenAddress } },
      body: { mode: 'TRACKING' }
    });
    if (error) throw new Error((error as ErrorResponse)?.message ?? 'Dismiss failed');
    await fetchActiveTrades();
  } catch (e: unknown) {
    tradeError = e instanceof Error ? e.message : 'Dismiss failed';
  }
}

export function handleTradesSnapshot(topic: string, data: ActiveTradesResponse | CompletedTradesResponse | unknown, _meta?: Record<string, unknown>) {
  const page = data as { trades?: unknown[]; totalCount?: number | null; totalActiveCount?: number | null; totalPendingCount?: number | null } & CursorTriplet;
  if (!Array.isArray(page?.trades)) return;
  const trades = page.trades.filter(isTradeWsTrade);
  const hasCursor = typeof page.cursor === 'string';
  if (topic.startsWith('trades:completed')) {
    completedTrades = sortCompletedTrades(
      trades.filter((trade): trade is CompletedTrade => trade.status === 'COMPLETED')
    );
    if (typeof page.totalCount === 'number') completedTotalCount = page.totalCount;
    if (hasCursor) {
      assignCompletedCursorTriplet(page);
    }
    completedLoading = false;
    return;
  }
  activeTrades = trades.filter((trade): trade is ActiveTrade => trade.status === 'ACTIVE' || trade.status === 'PENDING');
  if (typeof page.totalActiveCount === 'number') activePositionsTotal = page.totalActiveCount;
  if (typeof page.totalPendingCount === 'number') pendingTradesTotal = page.totalPendingCount;
  if (hasCursor) {
    assignActiveCursorTriplet(page);
  }
  activeLoading = false;
}

interface BalanceUpdatePayload {
  chain: Chain;
  walletAddress: string;
  assets: WalletAsset[];
}

export function handleBalanceUpdate(data: { balanceUpdate?: BalanceUpdatePayload } | unknown) {
  const raw = data as { balanceUpdate?: BalanceUpdatePayload };
  const update = raw?.balanceUpdate;
  if (!update?.chain || !update?.walletAddress || !Array.isArray(update.assets)) return;
  const chain = update.chain;
  const existing = managedWallets[chain];

  const updatedAssets = existing ? [...existing.assets] : [];
  for (const a of update.assets) {
    const idx = updatedAssets.findIndex(wa =>
      wa.token.address === a.token.address
    );
    if (idx >= 0) {
      updatedAssets[idx] = a;
    } else {
      updatedAssets.push(a);
    }
  }
  const totalValueUsd = updatedAssets.reduce((sum, a) => sum + a.valueUsd, 0);
  const base: ManagedWallet = existing ?? { address: update.walletAddress, assets: [], totalValueUsd: 0 };
  managedWallets = {
    ...managedWallets,
    [chain]: { ...base, assets: updatedAssets, totalValueUsd }
  };
}

export function handleTradeUpdate(event: string, data: Record<string, unknown> | unknown, meta?: Record<string, unknown>) {
  if (!data || (event !== 'USER_TRADE_UPDATE' && event !== 'USER_TRADE_UPDATE_ERROR')) return;
  const updateMeta = meta as TradeWsUpdateMeta | undefined;
  removeTradeIds(updateMeta?.removedTradeIds);
  const trade = (data as UserTradeUpdateData).trade;
  if (isTradeWsTrade(trade)) patchTrade(trade);

  const type = meta?.tradeUpdate as string | undefined;
  if (!type) return;

  const tradeIds = collectNumericIds(meta?.affectedTradeIds, meta?.affected_trade_ids);
  const tradeObj = trade as Record<string, unknown> | undefined;
  const tokenSymbol = (tradeObj?.tokenSymbol as string) ?? '';
  const tokenLabel = tokenSymbol ? ` ${tokenSymbol}` : '';

  function tradeDetails(): ToastDetail[] {
    const details: ToastDetail[] = [];
    if (tokenSymbol) details.push({ label: 'Token', value: tokenSymbol });
    if (tradeIds.length > 0) details.push({ label: 'Trade', value: `#${tradeIds.join(', #')}` });
    return details;
  }

  const tradeChain = tradeObj?.chain as string | undefined;
  const nativeSym = tradeChain === 'SOL' ? 'SOL' : tradeChain === 'BSC' ? 'BNB' : 'ETH';

  function fmtNative(v: unknown): string {
    const n = Number(v);
    if (!isFinite(n)) return '';
    return n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(3) : n.toFixed(4);
  }

  const detail = (data as { detail?: { swapId?: number; side?: 'BUY' | 'SELL' } }).detail;

  // Build the executed-amount line for the swap named by `data.detail`
  // (swapId + side) — never the most recent swap in the array, which may be the
  // opposite side (e.g. the entry BUY still present when a SELL confirms).
  function executedSummary(): string | undefined {
    const swaps = (tradeObj?.swaps as Record<string, any>[]) ?? [];
    const s = detail?.swapId != null ? swaps.find((sw) => sw?.id === detail.swapId) : undefined;
    const side = detail?.side ?? s?.side;
    const verb = side === 'BUY' ? 'Bought' : side === 'SELL' ? 'Sold' : undefined;
    const v = s?.value;
    if (v?.amount && verb) {
      const tokens = formatCompactNumber(v.amountToken);
      return `${verb} ${tokens} ${tokenSymbol} for ${fmtNative(v.amount.native)} ${nativeSym} (${formatUsd(v.amount.usd)})`;
    }
    // Amounts not yet available (swap still pending at confirm time) — report the
    // side only, never a wrong-side/wrong-amount line.
    if (side === 'BUY') return 'Buy confirmed';
    if (side === 'SELL') return 'Sell confirmed';
    return undefined;
  }

  function pendingSummary(): string | undefined {
    const pend = (tradeObj?.pendingSwaps as Record<string, any>[]) ?? [];
    if (!pend.length) return undefined;
    const p = pend[pend.length - 1];
    if (p?.side === 'BUY' && p?.amount) {
      const amt = p.amount.type === 'USD' ? formatUsd(p.amount.value) : `${fmtNative(p.amount.value)} ${nativeSym}`;
      return `Buying ${amt} of ${tokenSymbol}`;
    }
    if (p?.side === 'SELL' && p?.pct != null) return `Selling ${p.pct}% of position`;
    return undefined;
  }

  function tradeErrorDetails(): ToastDetail[] {
    const details = tradeDetails();
    const swapIds = tradeFailureSwapIds(data);
    if (swapIds.length > 0) details.push({ label: 'Swap', value: swapIds.join(', ') });
    return details;
  }

  switch (type) {
    case 'SWAP_SUBMITTED':
      addToast('info', `Swap Submitted${tokenLabel}`, pendingSummary() ?? 'Tx sent to network', 4000, tradeDetails());
      break;
    case 'BUY_SUBMITTED':
      addToast('info', `Buy Submitted${tokenLabel}`, pendingSummary() ?? 'Tx sent to network', 4000, tradeDetails());
      break;
    case 'SELL_SUBMITTED':
      addToast('info', `Sell Submitted${tokenLabel}`, pendingSummary() ?? 'Tx sent to network', 4000, tradeDetails());
      break;
    case 'SWAP_CONFIRMED':
    case 'SWAP_QUICK_CONFIRM':
      {
        const toastId = addToast('success', `Swap Confirmed${tokenLabel}`, executedSummary(), 5000, tradeDetails());
        if (detail?.swapId != null) rememberConfirmedToast(detail.swapId, toastId);
      }
      break;
    case 'SWAP_FINALIZED':
      // Finalize carries the executed amounts; upgrade the existing "Swap
      // Confirmed" toast in place (so the user sees the real figures) rather than
      // stacking a second toast. Fall back to a fresh toast if the confirmed one
      // is gone (dismissed / this client subscribed mid-flight).
      {
        const summary = executedSummary();
        if (!summary) break;
        const existingId = detail?.swapId != null ? confirmedSwapToasts.get(detail.swapId) : undefined;
        if (existingId !== undefined) {
          updateToast(existingId, { message: summary, details: tradeDetails() });
          if (detail?.swapId != null) confirmedSwapToasts.delete(detail.swapId);
        } else {
          addToast('success', `Swap Confirmed${tokenLabel}`, summary, 5000, tradeDetails());
        }
      }
      break;
    case 'SWAP_FAILED':
      {
        const side = tradeFailureSide(data, meta);
        const msg = tradeUpdateErrorMessage(data, side);
        tradeError = msg;
        addToast('error', `${tradeFailureTitle(side)}${tokenLabel}`, msg, 8000, tradeErrorDetails());
      }
      break;
    case 'TRADE_CANCEL_CONFIRMED':
    case 'TRADE_ABORT_CONFIRMED':
      addToast('success', `Order Cancelled${tokenLabel}`, undefined, 4000, tradeDetails());
      break;
    case 'BUY_CREATED':
      addToast('info', `Buy Created${tokenLabel}`, pendingSummary(), 4000, tradeDetails());
      break;
    case 'SELL_CREATED':
      addToast('info', `Sell Created${tokenLabel}`, pendingSummary(), 4000, tradeDetails());
      break;
    case 'SETTINGS_UPDATED':
      addToast('success', 'Settings Updated', undefined, 3000, tradeDetails());
      break;
    case 'TARGET_ADDED':
      addToast('success', `Target Added${tokenLabel}`, undefined, 3000, tradeDetails());
      break;
    case 'TARGET_UPDATED':
      addToast('success', `Target Updated${tokenLabel}`, undefined, 3000, tradeDetails());
      break;
    case 'TARGET_REMOVED':
      addToast('success', `Target Removed${tokenLabel}`, undefined, 3000, tradeDetails());
      break;
    case 'TARGET_MET':
      addToast('warning', `Target Met${tokenLabel}`, 'Sell target triggered', 6000, tradeDetails());
      break;
    case 'PRICE_UPDATED':
      break;
    case 'TRADE_UPDATE_ERROR':
      {
        const side = tradeFailureSide(data, meta);
        const msg = tradeUpdateErrorMessage(data, side);
        tradeError = msg;
        addToast('error', `${tradeFailureTitle(side)}${tokenLabel}`, msg, 8000, tradeErrorDetails());
      }
      break;
    default:
      break;
  }
}
