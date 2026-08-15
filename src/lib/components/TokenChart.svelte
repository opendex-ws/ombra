<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { dev } from '$app/environment';
	import { api } from '$lib/api/client';
	import type { Chain, CandleFrame, WatchlistCallItem } from '$lib/api/types';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import { formatPriceText, formatUsd, avatarUrl, shortAddress } from '$lib/utils/format';
	import { getWalletIconUrl, getWalletIconImage, getWalletAddress } from '$lib/utils/walleticon';
	import { SwapPrimitive, MigrationPrimitive, drawChefHat, type SwapIndicatorData, type SwapInfo } from '$lib/utils/chart-primitives';
	import type { ChartMarker, ChartMarkerSwap } from '$lib/api/types';
	import { getActiveTrades } from '$lib/stores/trade.svelte';
	import { createCoalescer } from '$lib/utils/coalesce';
	import { setCandleSeries, updateCandleSeries, type CandleCacheMode } from '$lib/stores/candleCache.svelte';
	import {
		applyCandleBatch,
		buildCandleIndex,
		candleHigh,
		latestCandlesByTime,
		normalizeCandle,
		type AreaPoint,
		type CandleColors,
		type CandlePoint,
		type RawCandleUpdate,
		type VolumePoint
	} from '$lib/utils/candle-updates';
	import { createCandleDiagnostics } from '$lib/utils/candle-diagnostics';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import Check from 'lucide-svelte/icons/check';
	import ChartLine from 'lucide-svelte/icons/chart-line';
	import { getSelectedFrame, setSelectedFrame, getShowMarketCap, setShowMarketCap, setLiveAthPrice } from '$lib/stores/chart.svelte';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import LineChart from 'lucide-svelte/icons/line-chart';
	import DollarSign from 'lucide-svelte/icons/dollar-sign';
	import BarChart3 from 'lucide-svelte/icons/chart-column';
	import Layers from 'lucide-svelte/icons/layers';
	import UserRound from 'lucide-svelte/icons/user-round';
	import Megaphone from 'lucide-svelte/icons/megaphone';
	import Crown from 'lucide-svelte/icons/crown';
	import { tc, getTheme, getThemeVersion } from '$lib/stores/theme.svelte';

	// Append a 2-char hex alpha to a color for lightweight-charts. The CSS
	// minifier can shrink `#00ff88` → `#0f8`, so naive concatenation would produce
	// invalid 5-char hex (`#0f84D`) → black. Expand shorthand hex first; for
	// non-hex inputs, fall back to rgba() so alpha still applies.
	function withHexAlpha(color: string, alphaHex: string): string {
		const c = (color ?? '').trim();
		if (/^#[0-9a-fA-F]{3}$/.test(c)) {
			// #rgb → #rrggbb
			return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}${alphaHex}`;
		}
		if (/^#[0-9a-fA-F]{6}$/.test(c)) return c + alphaHex;
		if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7) + alphaHex; // replace existing alpha
		// Unknown format (rgb()/hsl()/named/empty): approximate with rgba.
		const a = (parseInt(alphaHex, 16) / 255).toFixed(3);
		return `color-mix(in srgb, ${c || '#00ff88'} ${Math.round(Number(a) * 100)}%, transparent)`;
	}

	type Props = {
		chain: Chain | string;
		address: string;
		chartHeight?: number;
		athPrice?: string | null;
		athMcap?: string | null;
		onopentrader?: (walletAddress: string) => void;
		tokenSymbol?: string;
		active?: boolean;
	};
	type SwapChartMarker = Extract<
		ChartMarker,
		{ kind: 'KOL' | 'DEV' | 'USER_SWAP' }
	>;

	let { chain, address, chartHeight = 450, athPrice = null, athMcap = null, onopentrader, tokenSymbol = '', active = true }: Props = $props();

	let chartContainer: HTMLDivElement;
	let selectedFrame: string = $derived(getSelectedFrame());
	let showMarketCap: boolean = $derived(getShowMarketCap());

	const MARKER_VIS_KEY = 'ombra_chart_markers';
	function loadMarkerVis(): { user: boolean; calls: boolean; kols: boolean } {
		if (typeof localStorage === 'undefined') return { user: true, calls: true, kols: true };
		try {
			const raw = localStorage.getItem(MARKER_VIS_KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<{ user: boolean; calls: boolean; kols: boolean }>;
				return { user: v.user !== false, calls: v.calls !== false, kols: v.kols !== false };
			}
		} catch { /* ignore */ }
		return { user: true, calls: true, kols: true };
	}
	const initialMarkerVis = loadMarkerVis();
	let showUserSwaps = $state(initialMarkerVis.user);
	let showCalls = $state(initialMarkerVis.calls);
	let showKols = $state(initialMarkerVis.kols);
	let markerMenuOpen = $state(false);

	function toggleMarkerVis(kind: 'user' | 'calls' | 'kols') {
		if (kind === 'user') showUserSwaps = !showUserSwaps;
		else if (kind === 'calls') showCalls = !showCalls;
		else showKols = !showKols;
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem(MARKER_VIS_KEY, JSON.stringify({ user: showUserSwaps, calls: showCalls, kols: showKols }));
			} catch { /* ignore */ }
		}
		updateMarkers();
	}

	let loading: boolean = $state(true);
	let error: string = $state('');
	let candleWsKey: string | null = null;

	const frames: { label: string; value: CandleFrame }[] = [
		{ label: '1s', value: '1s' },
		{ label: '5s', value: '5s' },
		{ label: '1m', value: '1m' },
		{ label: '5m', value: '5m' },
		{ label: '15m', value: '15m' },
		{ label: '1h', value: '1h' },
		{ label: '4h', value: '4h' },
		{ label: '1d', value: '24h' }
	];

	const frameToWsTopic: Record<string, string> = {
		'1s': '1s', '5s': '5s', '15s': '15s', '30s': '30s',
		'1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
		'1h': '1h', '4h': '4h', '6h': '6h', '12h': '12h', '24h': '24h'
	};

	let chartInstance: any = $state(null);
	let candleSeries: any = null;
	let volumeSeries: any = null;
	let areaSeries: any = null;
	let markerPlugin: any = null;
	let lastClose: number = 0;
	let lastCloseStr: string = '0';
	let allCandleData: CandlePoint[] = [];
	let allVolumeData: VolumePoint[] = [];
	let allAreaData: AreaPoint[] = [];
	let candleIndexByTime = new Map<number, number>();
	// Seed with resolved theme colors (tc() falls back to the dark defaults even
	// before the stylesheet applies) so candles normalized before onMount/theme
	// effect run never get an empty ('4D'-only → black) volume color.
	let candleColors: CandleColors = { upVolume: withHexAlpha(tc('--t-grn'), '4D'), downVolume: withHexAlpha(tc('--t-red'), '4D') };
	let athSourceTime: number | null = null;
	let pendingCandles = new Map<number, RawCandleUpdate>();
	let candleFrameRequest = 0;
	let candleFallbackTimer: ReturnType<typeof setTimeout> | null = null;
	const candleDiagnostics = createCandleDiagnostics(dev);
	let documentVisible = $state(true);
	let canonicalVersion = 0;
	let projectedVersion = 0;
	let projectionDirty = false;
	let projectionInProgress = false;
	let pendingFirstPaint = true;
	let savedVisibleRange: { from: number; to: number } | null = null;
	let wasPinnedLive = true;
	let pendingWidth = 0;
	let projectionWaiters = new Set<() => void>();

	function canProject() {
		return active && documentVisible && !disposed;
	}

	function notifyProjectionWaiters() {
		if (!canProject()) return;
		for (const resolve of projectionWaiters) resolve();
		projectionWaiters.clear();
	}

	function waitForProjection() {
		if (canProject()) return Promise.resolve();
		return new Promise<void>((resolve) => projectionWaiters.add(resolve));
	}

	function captureViewport() {
		if (!chartInstance || pendingFirstPaint) return;
		const timeScale = chartInstance.timeScale();
		savedVisibleRange = timeScale.getVisibleRange() ?? null;
		wasPinnedLive = timeScale.scrollPosition() <= 1;
	}

	function projectCanonicalState() {
		if (!canProject() || !chartInstance || !candleSeries || !volumeSeries || projectionInProgress) return;
		if (!projectionDirty && projectedVersion === canonicalVersion && !pendingFirstPaint) return;
		candleDiagnostics.add('fullProjections');
		projectionInProgress = true;
		try {
			chartInstance.applyOptions(pendingWidth > 0 ? { width: pendingWidth, height: chartHeight } : { height: chartHeight });
			candleSeries.setData(allCandleData);
			volumeSeries.setData(allVolumeData);
			areaSeries?.setData(allAreaData);
			updatePriceLines();
			const timeScale = chartInstance.timeScale();
			if (pendingFirstPaint) timeScale.fitContent();
			else if (wasPinnedLive) timeScale.scrollToRealTime();
			else if (savedVisibleRange) timeScale.setVisibleRange(savedVisibleRange);
			updateAreaGradient();
			if (markerArraysDirty) rebuildMarkerArrays();
			updateMarkers();
			projectedVersion = canonicalVersion;
			projectionDirty = false;
			pendingFirstPaint = false;
		} finally {
			projectionInProgress = false;
		}
		if (initialLoadDone) {
			scheduleMarkersFetch();
			const range = chartInstance.timeScale().getVisibleLogicalRange();
			if (!noMoreCandles && !fetchingMore && needsMoreCandles(range)) fetchOlderCandles();
		}
	}
	let earliestTime: number = Infinity;
	let fetchingMore: boolean = $state(false);
	let noMoreCandles: boolean = $state(false);
	let historyRequestId = 0;
	let rangeHandler: any = null;
	let initialLoadDone = false;
	let createSeriesMarkersFn: any = null;
	let disposed = false;
	let priceLines: any[] = [];
	let LineStyleDashed: number = 2;
	let callAvatarPrimitive: any = null;
	let swapPrimitive: any = null;
	let migrationPrimitive: any = null;
	type MigrationMarker = Extract<ChartMarker, { kind: 'MIGRATION' }>;
	type UserSwapMarker = Extract<ChartMarker, { kind: 'USER_SWAP' }>;
	let kolMarkers: ChartMarkerSwap[] = [];
	let devMarkers: ChartMarkerSwap[] = [];
	let userSwapMarkers: UserSwapMarker[] = [];
	let callMarkers: WatchlistCallItem[] = [];
	let kolByCandle = new Map<number, ChartMarkerSwap[]>();
	let devByCandle = new Map<number, ChartMarkerSwap[]>();
	// Unified marker cache: every id-bearing marker (KOL/DEV/USER_SWAP/CALL) deduped
	// by id, tracking the contiguous time span already fetched so pans/zooms only
	// request the uncovered gap. Migration is idless and tracked separately.
	let markersById = new Map<string, ChartMarker>();
	let markerTimes = new Set<number>();
	let markerArraysDirty = false;
	let markersCoveredFrom = Infinity;
	let markersCoveredTo = -Infinity;
	let migrationMarker: MigrationMarker | null = null;
	let markersFetchTimer: ReturnType<typeof setTimeout> | null = null;
	let markersFetchGen = 0;
	let markersWsKey: string | null = null;
	const markersCoalescer = createCoalescer<ChartMarker>((batch) => {
		if (disposed) return;
		let changed = false;
		for (const m of batch) {
			if (m.kind === 'MIGRATION') { migrationMarker = m; changed = true; }
			else if ('id' in m && m.id && !markersById.has(m.id)) { markersById.set(m.id, m); changed = true; }
		}
		if (changed) {
			if (canProject()) {
				rebuildMarkerArrays();
				updateMarkers();
			} else {
				markerArraysDirty = true;
				projectionDirty = true;
			}
		}
	}, { maxBatch: 200 });
	type KolRow = { name: string; walletAddress: string; photoUrl: string | null; buys: number; sells: number; buyUsd: number; sellUsd: number; isDev?: boolean };
	type KolSummary = { time: number; rows: KolRow[]; totalBuyUsd: number; totalSellUsd: number; buyCount: number; sellCount: number };
	let chartTooltip: { x: number; y: number; lines?: string[]; kol?: KolSummary } | null = $state(null);
	let chartTooltipTimer: ReturnType<typeof setTimeout> | null = null;

	function showTooltip(x: number, y: number, lines: string[]) {
		chartTooltip = { x, y, lines };
		if (chartTooltipTimer) clearTimeout(chartTooltipTimer);
		chartTooltipTimer = setTimeout(() => { chartTooltip = null; }, 3000);
	}

	function buildKolSummary(time: number): KolSummary | null {
		const kolSwaps = kolByCandle.get(time) ?? [];
		const devSwaps = devByCandle.get(time) ?? [];
		if (kolSwaps.length === 0 && devSwaps.length === 0) return null;
		const byWallet = new Map<string, KolRow>();
		let totalBuyUsd = 0, totalSellUsd = 0, buyCount = 0, sellCount = 0;
		const add = (s: ChartMarkerSwap, isDev: boolean) => {
			const label = s.labels?.[0];
			let row = byWallet.get(s.walletAddress);
			if (!row) {
				row = { name: label?.label ?? (isDev ? 'Dev' : '?'), walletAddress: s.walletAddress, photoUrl: avatarUrl(label?.photoId ?? undefined), buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, isDev };
				byWallet.set(s.walletAddress, row);
			}
			if (isDev) row.isDev = true;
			if (s.side === 'BUY') { row.buys++; row.buyUsd += s.amountUsd; totalBuyUsd += s.amountUsd; buyCount++; }
			else { row.sells++; row.sellUsd += s.amountUsd; totalSellUsd += s.amountUsd; sellCount++; }
		};
		for (const s of devSwaps) add(s, true);
		for (const s of kolSwaps) add(s, false);
		const rows = [...byWallet.values()].sort((a, b) => (b.buyUsd + b.sellUsd) - (a.buyUsd + a.sellUsd));
		return { time, rows, totalBuyUsd, totalSellUsd, buyCount, sellCount };
	}

	function showKolInfo(x: number, y: number, summary: KolSummary) {
		chartTooltip = { x, y, kol: summary };
		if (chartTooltipTimer) clearTimeout(chartTooltipTimer);
	}

	let copyTradeState = $state<Record<string, 'idle' | 'adding' | 'done'>>({});
	async function copyTradeKol(row: KolRow) {
		if (!getIsLoggedIn()) { addToast('error', 'Sign in to copy trade'); return; }
		const st = copyTradeState[row.walletAddress];
		if (st === 'adding' || st === 'done') return;
		copyTradeState = { ...copyTradeState, [row.walletAddress]: 'adding' };
		try {
			const name = row.isDev
				? `$${tokenSymbol || '?'} Dev`
				: row.name !== '?' ? row.name : shortAddress(row.walletAddress);
			const { error } = await api.POST('/v2/watchlist/manage/wallets/create', {
				body: { name, chain: chain as Chain, walletAddress: row.walletAddress }
			});
			if (error) throw new Error();
			copyTradeState = { ...copyTradeState, [row.walletAddress]: 'done' };
			addToast('success', `Copy trading ${name}`);
		} catch {
			copyTradeState = { ...copyTradeState, [row.walletAddress]: 'idle' };
			addToast('error', 'Failed to add copy trade');
		}
	}

	// Shared per-avatar circular hit-test used by BOTH hover and click, so the
	// marker you click is exactly the one that highlighted on hover. Iterates in
	// reverse so the last-drawn (visually on-top) cluster wins on overlap.
	function hitTestAvatar(px: number, py: number): { time: number; idx: number; x: number; cy: number } | null {
		if (!callAvatarPrimitive || !chartInstance || !candleSeries) return null;
		const ts = chartInstance.timeScale();
		const sz = 18;
		const pad = 4;
		const step = sz * 0.55;
		const data = callAvatarPrimitive._data as CallAvatarData[];
		for (let di = data.length - 1; di >= 0; di--) {
			const d = data[di];
			const x = ts.timeToCoordinate(d.time);
			const priceY = candleSeries.priceToCoordinate(d.high);
			if (x === null || priceY === null) continue;
			const n = d.callers.length;
			const totalW = sz + step * (n - 1);
			const startX = x - totalW / 2;
			const cy = priceY - pad - sz / 2;
			for (let i = n - 1; i >= 0; i--) {
				const cx = startX + i * step + sz / 2;
				const dx = px - cx;
				const dy = py - cy;
				if (dx * dx + dy * dy <= (sz / 2) * (sz / 2)) {
					return { time: d.time, idx: i, x, cy };
				}
			}
		}
		return null;
	}

	function handleChartClick(param: any) {
		if (!param || !chartInstance || !candleSeries) { chartTooltip = null; return; }
		const clickX = param.point?.x;
		const clickY = param.point?.y;
		if (clickX == null || clickY == null) { chartTooltip = null; return; }
		const ts = chartInstance.timeScale();
		const sz = 18;
		const pad = 4;
		// KOL avatar clusters first (they sit above the candle high). Use the same
		// hit-test as hover so click matches what the user sees highlighted.
		const avatarHit = hitTestAvatar(clickX, clickY);
		if (avatarHit) {
			const summary = buildKolSummary(avatarHit.time);
			if (summary) {
				showKolInfo(Math.round(avatarHit.x), Math.round(avatarHit.cy - sz / 2 - 4), summary);
				return;
			}
		}
		if (swapPrimitive) {
			for (const d of swapPrimitive._data as SwapIndicatorData[]) {
				const x = ts.timeToCoordinate(d.time);
				const priceY = candleSeries.priceToCoordinate(d.price);
				if (x === null || priceY === null) continue;
				const cy = d.isBuy ? priceY + sz / 2 + pad : priceY - sz / 2 - pad;
				if (clickX >= x - sz / 2 && clickX <= x + sz / 2 && clickY >= cy - sz / 2 && clickY <= cy + sz / 2) {
					const lines = d.swaps.map(s => `${s.side} $${s.usd > 0 ? s.usd.toFixed(0) : '0'}`);
					showTooltip(clickX, cy - sz / 2 - 4, lines);
					return;
				}
			}
		}
		chartTooltip = null;
	}

	function handleCrosshairMove(param: any) {
		if (!callAvatarPrimitive || !chartInstance || !candleSeries) return;
		const mx = param?.point?.x;
		const my = param?.point?.y;
		if (mx == null || my == null) {
			callAvatarPrimitive.setHover(null);
			callAvatarPrimitive.setFocus(null);
			if (chartContainer) chartContainer.style.cursor = '';
			return;
		}
		const found = hitTestAvatar(mx, my);
		const hit = found ? { time: found.time, idx: found.idx } : null;
		callAvatarPrimitive.setHover(hit);
		let focusWallet: string | null = null;
		if (hit) {
			const d = (callAvatarPrimitive._data as CallAvatarData[]).find((x) => x.time === hit!.time);
			focusWallet = d?.callers[hit.idx]?.walletAddress ?? null;
		}
		callAvatarPrimitive.setFocus(focusWallet);
		if (chartContainer) chartContainer.style.cursor = hit ? 'pointer' : '';
	}

	const imgCache = new Map<string, HTMLImageElement>();
	function loadImg(url: string): HTMLImageElement | null {
		const cached = imgCache.get(url);
		if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.src = url;
		img.onload = () => { if (!disposed) updateCallAvatars(); };
		imgCache.set(url, img);
		return null;
	}

	type CallAvatarCaller = { photoUrl: string | null; walletAddress?: string; name: string; count?: number; isBuy?: boolean; isDev?: boolean };
	type CallAvatarData = { time: number; high: number; callers: CallAvatarCaller[] };

	class CallAvatarPrimitive {
		_data: CallAvatarData[] = [];
		_series: any = null;
		_chart: any = null;
		_requestUpdate?: () => void;
		_hover: { time: number; idx: number } | null = null;
		_focusWallet: string | null = null;

		setData(data: CallAvatarData[]) {
			this._data = data;
			this._requestUpdate?.();
		}

		setHover(h: { time: number; idx: number } | null) {
			const same = (h === null && this._hover === null) || (h !== null && this._hover !== null && h.time === this._hover.time && h.idx === this._hover.idx);
			if (same) return;
			this._hover = h;
			this._requestUpdate?.();
		}

		setFocus(wallet: string | null) {
			if (this._focusWallet === wallet) return;
			this._focusWallet = wallet;
			this._requestUpdate?.();
		}

		attached({ series, chart, requestUpdate }: any) {
			this._series = series;
			this._chart = chart;
			this._requestUpdate = requestUpdate;
		}

		detached() {
			this._series = null;
			this._chart = null;
			this._requestUpdate = undefined;
		}

		paneViews() {
			return [new CallAvatarPaneView(this)];
		}
	}

	class CallAvatarPaneView {
		_primitive: CallAvatarPrimitive;
		constructor(primitive: CallAvatarPrimitive) { this._primitive = primitive; }
		zOrder() { return 'top' as const; }
		renderer() { return new CallAvatarRenderer(this._primitive); }
	}

	class CallAvatarRenderer {
		_primitive: CallAvatarPrimitive;
		constructor(primitive: CallAvatarPrimitive) { this._primitive = primitive; }
		_drawAvatar(ctx: any, c: CallAvatarCaller, cx: number, cy: number, b: number, ratio: number) {
			if (c.isDev) {
				const fill = c.isBuy ? tc('--t-grn') : tc('--t-red');
				ctx.fillStyle = fill;
				ctx.beginPath();
				ctx.arc(cx, cy, b / 2, 0, Math.PI * 2);
				ctx.fill();
				drawChefHat(ctx, cx, cy, b * 0.62, tc('--t-s0'));
				ctx.strokeStyle = tc('--t-s0');
				ctx.lineWidth = Math.max(1.5, 2.5 * ratio);
				ctx.beginPath();
				ctx.arc(cx, cy, b / 2, 0, Math.PI * 2);
				ctx.stroke();
				if ((c.count ?? 1) > 1) {
					const badgeR = Math.round(b * 0.28);
					const bxp = cx + b / 2 - badgeR * 0.5;
					const byp = cy - b / 2 + badgeR * 0.5;
					ctx.fillStyle = fill;
					ctx.beginPath();
					ctx.arc(bxp, byp, badgeR, 0, Math.PI * 2);
					ctx.fill();
					ctx.strokeStyle = tc('--t-s0');
					ctx.lineWidth = Math.max(1, ratio);
					ctx.beginPath();
					ctx.arc(bxp, byp, badgeR, 0, Math.PI * 2);
					ctx.stroke();
					ctx.fillStyle = tc('--t-s0');
					ctx.font = `bold ${Math.round(badgeR * 1.2)}px sans-serif`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(String(c.count), bxp, byp + Math.round(0.5 * ratio));
				}
				return;
			}
			const img = c.photoUrl ? loadImg(c.photoUrl) : c.walletAddress ? getWalletIconImage(c.walletAddress, () => { if (!disposed) updateCallAvatars(); }) : null;
			if (img) {
				ctx.save();
				ctx.beginPath();
				ctx.arc(cx, cy, b / 2, 0, Math.PI * 2);
				ctx.closePath();
				ctx.clip();
				ctx.drawImage(img, cx - b / 2, cy - b / 2, b, b);
				ctx.restore();
			} else if (!c.photoUrl && !c.walletAddress) {
				ctx.fillStyle = tc('--t-s7');
				ctx.beginPath();
				ctx.arc(cx, cy, b / 2, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = tc('--t-g11');
				ctx.font = `bold ${Math.round(b * 0.5)}px sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(c.name[0]?.toUpperCase() ?? '?', cx, cy);
			}
			const ringColor = c.isBuy === undefined ? tc('--t-s0') : c.isBuy ? tc('--t-grn') : tc('--t-red');
			ctx.strokeStyle = ringColor;
			ctx.lineWidth = Math.max(1.5, 2.5 * ratio);
			ctx.beginPath();
			ctx.arc(cx, cy, b / 2, 0, Math.PI * 2);
			ctx.stroke();
			if ((c.count ?? 1) > 1) {
				const badgeR = Math.round(b * 0.28);
				const bxp = cx + b / 2 - badgeR * 0.5;
				const byp = cy - b / 2 + badgeR * 0.5;
				ctx.fillStyle = ringColor === tc('--t-s0') ? tc('--t-s5') : ringColor;
				ctx.beginPath();
				ctx.arc(bxp, byp, badgeR, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = tc('--t-s0');
				ctx.lineWidth = Math.max(1, ratio);
				ctx.beginPath();
				ctx.arc(bxp, byp, badgeR, 0, Math.PI * 2);
				ctx.stroke();
				ctx.fillStyle = tc('--t-s0');
				ctx.font = `bold ${Math.round(badgeR * 1.2)}px sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(String(c.count), bxp, byp + Math.round(0.5 * ratio));
			}
		}
		draw(target: any) {
			const p = this._primitive;
			if (!p._series || !p._chart || p._data.length === 0) return;
			target.useBitmapCoordinateSpace((scope: any) => {
				const ctx = scope.context;
				const ratio = scope.horizontalPixelRatio;
				const vRatio = scope.verticalPixelRatio;
				const ts = p._chart.timeScale();
				const sz = 18;
				const overlap = 0.55;
				const bsz = Math.round(sz * ratio);
				const step = Math.round(bsz * overlap);
				const pad = Math.round(4 * vRatio);
				let hovered: { c: CallAvatarCaller; cx: number; cy: number } | null = null;
				for (const d of p._data) {
					const x = ts.timeToCoordinate(d.time);
					if (x === null) continue;
					const priceY = p._series.priceToCoordinate(d.high);
					if (priceY === null) continue;
					const n = d.callers.length;
					const totalW = bsz + step * (n - 1);
					const startX = Math.round(x * ratio) - totalW / 2;
					const by = Math.round(priceY * vRatio) - bsz - pad;
					for (let i = n - 1; i >= 0; i--) {
						const c = d.callers[i];
						const cx = startX + i * step + bsz / 2;
						const cy = by + bsz / 2;
						if (p._hover && p._hover.time === d.time && p._hover.idx === i) {
							hovered = { c, cx, cy };
							continue;
						}
						const dimmed = p._focusWallet !== null && c.walletAddress !== p._focusWallet;
						if (dimmed) ctx.globalAlpha = 0.12;
						this._drawAvatar(ctx, c, cx, cy, bsz, ratio);
						if (dimmed) ctx.globalAlpha = 1;
					}
				}
				if (hovered) {
					const b2 = Math.round(bsz * 2);
					this._drawAvatar(ctx, hovered.c, hovered.cx, hovered.cy, b2, ratio);
					const sideStr = hovered.c.isBuy === undefined ? '' : hovered.c.isBuy ? ' · bought' : ' · sold';
					const countStr = (hovered.c.count ?? 1) > 1 ? ` ×${hovered.c.count}` : '';
					const label = `${hovered.c.name}${sideStr}${countStr}`;
					const fontPx = Math.round(10 * ratio);
					ctx.font = `600 ${fontPx}px sans-serif`;
					const tw = ctx.measureText(label).width;
					const px = Math.round(6 * ratio);
					const ph = Math.round(18 * vRatio);
					const lx = hovered.cx - tw / 2 - px;
					const ly = hovered.cy - b2 / 2 - ph - Math.round(4 * vRatio);
					const lw = tw + px * 2;
					ctx.fillStyle = tc('--t-s5');
					ctx.strokeStyle = tc('--t-bd');
					ctx.lineWidth = Math.max(1, ratio);
					ctx.beginPath();
					const r = Math.round(4 * ratio);
					ctx.roundRect(lx, ly, lw, ph, r);
					ctx.fill();
					ctx.stroke();
					ctx.fillStyle = tc('--t-tx');
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(label, hovered.cx, ly + ph / 2);
				}
			});
		}
	}



	function nearestCandle(tsSecs: number): any | null {
		const arr = allCandleData;
		if (arr.length === 0) return null;
		if (tsSecs <= arr[0].time) return arr[0];
		let lo = 0;
		let hi = arr.length - 1;
		if (tsSecs >= arr[hi].time) return arr[hi];
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (arr[mid].time <= tsSecs) lo = mid;
			else hi = mid - 1;
		}
		return arr[lo];
	}

	function buildSwapData(): SwapIndicatorData[] {
		// User's own swaps come from USER_SWAP chart markers (only present when authed).
		if (!showUserSwaps || userSwapMarkers.length === 0) return [];
		const grouped = new Map<string, { time: number; isBuy: boolean; candle: any; swaps: SwapInfo[] }>();
		for (const swap of userSwapMarkers) {
			const candle = nearestCandle(Math.floor(swap.timestamp / 1000));
			if (!candle) continue;
			const isBuy = swap.side === 'BUY';
			const key = `${candle.time}:${isBuy}`;
			const info: SwapInfo = { side: swap.side, usd: swap.value.amount.usd };
			const existing = grouped.get(key);
			if (existing) existing.swaps.push(info);
			else grouped.set(key, { time: candle.time, isBuy, candle, swaps: [info] });
		}
		const result: SwapIndicatorData[] = [];
		for (const g of grouped.values()) {
			const price = g.isBuy ? Math.min(g.candle.low, g.candle.open, g.candle.close) : Math.max(g.candle.high, g.candle.open, g.candle.close);
			result.push({ time: g.time, price, isBuy: g.isBuy, swaps: g.swaps });
		}
		return result;
	}

	function updateSwapIndicators() {
		if (!canProject() || !swapPrimitive) {
			projectionDirty = true;
			return;
		}
		swapPrimitive.setData(buildSwapData());
	}

	function visibleTimeWindow(): { from: number; to: number } | null {
		if (!chartInstance || allCandleData.length === 0) return null;
		// Clamp to the loaded candle range — there's nothing to place markers on
		// outside it, and requesting whitespace before the first / after the last
		// candle causes runaway empty refetches as the view drifts into it.
		const dataFrom = allCandleData[0].time;
		const dataTo = allCandleData[allCandleData.length - 1].time;
		const range = chartInstance.timeScale().getVisibleRange?.();
		let from = dataFrom, to = dataTo;
		if (range && typeof range.from === 'number' && typeof range.to === 'number') {
			from = Math.max(dataFrom, Math.floor(range.from));
			to = Math.min(dataTo, Math.ceil(range.to));
		}
		if (to <= from) return null;
		return { from, to };
	}

	function resetMarkerCache() {
		markersFetchGen += 1;
		markersById = new Map();
		markersCoveredFrom = Infinity;
		markersCoveredTo = -Infinity;
		kolMarkers = [];
		devMarkers = [];
		userSwapMarkers = [];
		callMarkers = [];
		kolByCandle = new Map();
		devByCandle = new Map();
		markerTimes = new Set();
		markerArraysDirty = false;
		migrationMarker = null;
	}

	function rebuildMarkerArrays() {
		kolMarkers = [];
		devMarkers = [];
		userSwapMarkers = [];
		callMarkers = [];
		for (const m of markersById.values()) {
			if ('timestamp' in m && typeof m.timestamp === 'number') markerTimes.add(Math.floor(m.timestamp / 1000));
			if (m.kind === 'KOL') kolMarkers.push(m as ChartMarkerSwap);
			else if (m.kind === 'DEV') devMarkers.push(m as ChartMarkerSwap);
			else if (m.kind === 'USER_SWAP') userSwapMarkers.push(m as UserSwapMarker);
			else if (m.kind === 'CALL') callMarkers.push(m as unknown as WatchlistCallItem);
		}
		markerArraysDirty = false;
	}

	async function fetchMarkerRange(from: number, to: number, gen: number): Promise<boolean> {
		if (to <= from) return true;
		const { data } = await api.GET('/v2/token/{chain}/{address}/chart-markers', {
			params: { path: { chain: chain as Chain, address }, query: { from, to } }
		});
		if (disposed || gen !== markersFetchGen) return false;
		for (const m of data?.markers ?? []) {
			if (m.kind === 'MIGRATION') migrationMarker = m;
			else if ('id' in m && m.id) markersById.set(m.id, m);
		}
		return true;
	}

	async function fetchChartMarkers() {
		if (!canProject()) {
			projectionDirty = true;
			return;
		}
		const win = visibleTimeWindow();
		if (!win) return;
		const dataFrom = allCandleData[0].time;
		const span = Math.max(1, win.to - win.from);
		const margin = Math.round(span * 0.25);
		// Left edge of what we want, clamped to loaded history. The RIGHT/live edge
		// is owned by the CHART_MARKERS WS tail, so REST only ever back-fills older
		// history when panning left — never toward "now" (that would refetch on
		// every new candle).
		const wantFrom = Math.max(dataFrom, win.from - margin);

		if (markersCoveredFrom === Infinity) {
			// First load: hydrate the whole loaded window, then let the WS own the
			// live edge forever (coveredTo = Infinity ⇒ no forward fetch).
			const gen = ++markersFetchGen;
			try {
				const dataTo = allCandleData[allCandleData.length - 1].time;
				if (!await fetchMarkerRange(wantFrom, dataTo, gen)) return;
				markersCoveredFrom = wantFrom;
				markersCoveredTo = Infinity;
				rebuildMarkerArrays();
				updateMarkers();
			} catch { /* ignore */ }
			return;
		}

		// Only back-fill when the view reveals history older than we've covered.
		if (wantFrom >= markersCoveredFrom) return;
		const gen = ++markersFetchGen;
		try {
			if (!await fetchMarkerRange(wantFrom, markersCoveredFrom, gen)) return;
			markersCoveredFrom = wantFrom;
			rebuildMarkerArrays();
			updateMarkers();
		} catch {
			/* ignore */
		}
	}

	function scheduleMarkersFetch() {
		if (!canProject()) return;
		if (markersFetchTimer) clearTimeout(markersFetchTimer);
		markersFetchTimer = setTimeout(() => { if (!disposed) fetchChartMarkers(); }, 400);
	}

	function cleanupMarkersWs() {
		if (markersWsKey) { unsubscribe(markersWsKey); markersWsKey = null; }
		markersCoalescer.clear();
	}

	function setupMarkersWs(c: string, a: string) {
		cleanupMarkersWs();
		const topic = `token:${c}:${a}:chart_markers`;
		markersWsKey = subscribe(topic, (event, data) => {
			if (event !== 'CHART_MARKERS' || !data) return;
			markersCoalescer.push(data as ChartMarker);
		});
	}

	function updateMigrationMarker() {
		if (!canProject() || !migrationPrimitive) {
			projectionDirty = true;
			return;
		}
		if (!migrationMarker) { migrationPrimitive.setData(null); return; }
		const mt = Math.floor(migrationMarker.migratedAtTimestamp / 1000);
		const candle = nearestCandle(mt);
		if (!candle) { migrationPrimitive.setData(null); return; }
		// Snap to an actual candle time so timeToCoordinate resolves on every frame
		// (raw sub-candle timestamps return null on larger timeframes).
		const price = Math.min(candle.low, candle.open, candle.close);
		migrationPrimitive.setData({ time: candle.time, price });
	}

	function buildCallAvatarData(): CallAvatarData[] {
		const useCalls = showCalls && callMarkers.length > 0;
		const useKols = showKols && (kolMarkers.length > 0 || devMarkers.length > 0);
		if (!useCalls && !useKols) {
			kolByCandle = new Map();
			devByCandle = new Map();
			return [];
		}
		// Group by candle, then dedupe by wallet/name within the candle so the same
		// caller/KOL hitting one candle collapses into a single avatar with a count.
		const grouped = new Map<number, Map<string, CallAvatarCaller>>();
		const pushAt = (ts: number, key: string, caller: CallAvatarCaller) => {
			const candle = nearestCandle(ts);
			if (!candle) return;
			let byKey = grouped.get(candle.time);
			if (!byKey) { byKey = new Map(); grouped.set(candle.time, byKey); }
			const existing = byKey.get(key);
			if (existing) existing.count = (existing.count ?? 1) + 1;
			else byKey.set(key, { ...caller, count: 1 });
		};
		if (useCalls) for (const call of callMarkers) {
			const name = 'name' in call.caller ? call.caller.name ?? '?' : '?';
			const pid = 'photoId' in call.caller ? call.caller.photoId : undefined;
			const wa = getWalletAddress(call.caller as Record<string, unknown>);
			pushAt(Math.floor(call.callDetails.calledAtTimestamp / 1000), wa ?? `n:${name}`, { photoUrl: avatarUrl(pid), walletAddress: wa, name });
		}
		kolByCandle = new Map();
		if (useKols) for (const kol of kolMarkers) {
			const label = kol.labels?.[0];
			const isBuy = kol.side === 'BUY';
			const candle = nearestCandle(Math.floor(kol.timestamp / 1000));
			if (candle) {
				const arr = kolByCandle.get(candle.time);
				if (arr) arr.push(kol);
				else kolByCandle.set(candle.time, [kol]);
			}
			pushAt(Math.floor(kol.timestamp / 1000), `${kol.walletAddress}:${isBuy ? 'b' : 's'}`, {
				photoUrl: avatarUrl(label?.photoId ?? undefined),
				walletAddress: kol.walletAddress,
				name: label?.label ?? '?',
				isBuy
			});
		}
		devByCandle = new Map();
		if (useKols) for (const dev of devMarkers) {
			const label = dev.labels?.[0];
			const isBuy = dev.side === 'BUY';
			const candle = nearestCandle(Math.floor(dev.timestamp / 1000));
			if (candle) {
				const arr = devByCandle.get(candle.time);
				if (arr) arr.push(dev);
				else devByCandle.set(candle.time, [dev]);
			}
			pushAt(Math.floor(dev.timestamp / 1000), `dev:${dev.walletAddress}:${isBuy ? 'b' : 's'}`, {
				photoUrl: avatarUrl(label?.photoId ?? undefined),
				walletAddress: dev.walletAddress,
				name: label?.label ?? 'Dev',
				isBuy,
				isDev: true
			});
		}
		const candleMap = new Map(allCandleData.map((c: any) => [c.time, c]));
		const result: CallAvatarData[] = [];
		for (const [time, byKey] of grouped) {
			const candle = candleMap.get(time);
			const high = candle ? Math.max(candle.open, candle.close, candle.high) : 0;
			if (!high) continue;
			result.push({ time, high, callers: [...byKey.values()] });
		}
		return result;
	}

	function updateCallAvatars() {
		if (!canProject() || !callAvatarPrimitive) {
			projectionDirty = true;
			return;
		}
		callAvatarPrimitive.setData(buildCallAvatarData());
	}
	let currentAthPrice: number = $state(0);
	let currentAthMcap: number = $state(0);
	let loadGeneration = 0;

	$effect(() => {
		const p = parseFloat(athPrice ?? '0');
		const m = parseFloat(athMcap ?? '0');
		untrack(() => {
			let changed = false;
			if (p > currentAthPrice) { currentAthPrice = p; setLiveAthPrice(currentAthPrice); changed = true; }
			if (m > currentAthMcap) { currentAthMcap = m; changed = true; }
			if (changed) updatePriceLines();
		});
	});

	function applyThemeColors() {
		candleColors = { upVolume: withHexAlpha(tc('--t-grn'), '4D'), downVolume: withHexAlpha(tc('--t-red'), '4D') };
		// Recolor existing volume points immediately (even before the chart/series
		// are ready) so a projection triggered by projectionDirty picks up the
		// current theme colors — otherwise cold-load bars stay their stale color.
		if (allVolumeData.length > 0 && allCandleData.length > 0) {
			for (let i = 0; i < allVolumeData.length; i++) {
				const candle = allCandleData[i];
				allVolumeData[i] = { ...allVolumeData[i], color: candle && candle.close > candle.open ? candleColors.upVolume : candleColors.downVolume };
			}
		}
		if (!chartInstance || !candleSeries || !canProject()) {
			projectionDirty = true;
			return;
		}
		chartInstance.applyOptions({
			layout: { background: { color: tc('--t-s4') }, textColor: tc('--t-g7') },
			grid: { vertLines: { color: tc('--t-s8') }, horzLines: { color: tc('--t-s8') } },
			timeScale: { borderColor: tc('--t-bd2') },
			rightPriceScale: { borderColor: tc('--t-bd2') }
		});
		candleSeries.applyOptions({
			upColor: tc('--t-grn'), downColor: tc('--t-red'),
			borderUpColor: tc('--t-grn'), borderDownColor: tc('--t-red'),
			wickUpColor: tc('--t-grn'), wickDownColor: tc('--t-red')
		});
		// Volume points were already recolored above; just push them to the series.
		if (volumeSeries && allVolumeData.length > 0) {
			volumeSeries.setData(allVolumeData);
		}
		if (areaSeries) updateAreaGradient();
		// Custom marker primitives read tc() at draw time — force a redraw so they
		// pick up correct colors (fixes cold-load markers rendered before the
		// stylesheet's CSS vars were resolvable).
		updateMarkers();
	}

	$effect(() => {
		const _theme = getTheme();
		const _ver = getThemeVersion();
		applyThemeColors();
	});

	function cleanupCandleWs() {
		if (candleWsKey) {
			unsubscribe(candleWsKey);
			candleWsKey = null;
		}
		pendingCandles.clear();
		if (candleFrameRequest) cancelAnimationFrame(candleFrameRequest);
		candleFrameRequest = 0;
		if (candleFallbackTimer) clearTimeout(candleFallbackTimer);
		candleFallbackTimer = null;
	}

	function cacheMode(): CandleCacheMode {
		return showMarketCap ? 'marketCap' : 'price';
	}

	function scheduleCandleDrain() {
		if (candleFrameRequest || candleFallbackTimer) return;
		if (document.hidden) {
			candleFallbackTimer = setTimeout(() => {
				candleFallbackTimer = null;
				drainCandles();
			}, 250);
		} else {
			candleFrameRequest = requestAnimationFrame(() => {
				candleFrameRequest = 0;
				drainCandles();
			});
		}
	}

	function drainCandles() {
		if (disposed || pendingCandles.size === 0) return;
		const batch = [...pendingCandles.values()];
		pendingCandles.clear();
		const previousAthSource = athSourceTime;
		const result = applyCandleBatch(batch, allCandleData, allVolumeData, allAreaData, candleIndexByTime, candleColors);
		if (result.changes.length === 0) return;
		candleDiagnostics.add('drains');
		candleDiagnostics.add('distinctCandles', result.changes.length);
		candleDiagnostics.add('seriesUpdates', canProject() ? result.changes.length * 3 : 0);
		if (result.rebuiltIndex) candleDiagnostics.add('indexRebuilds');
		candleDiagnostics.max('maxLoadedCandles', allCandleData.length);
		canonicalVersion += 1;
		if (canProject()) {
			for (const change of result.changes) {
				const isHistorical = change.index < allCandleData.length - 1;
				candleSeries.update(change.point.candle, isHistorical);
				volumeSeries.update(change.point.volume, isHistorical);
				areaSeries?.update(change.point.area, isHistorical);
			}
			if (result.changes.some((change) => markerTimes.has(change.point.candle.time))) updateMarkers();
			projectedVersion = canonicalVersion;
		} else {
			candleDiagnostics.add('suppressedProjections');
			projectionDirty = true;
		}

		const tip = allCandleData[allCandleData.length - 1];
		const lastChange = result.changes[result.changes.length - 1];
		const tipChange = lastChange?.point.candle.time === tip.time ? lastChange : undefined;
		if (tipChange) {
			lastClose = tip.close;
			lastCloseStr = tipChange.point.rawClose;
		}
		updateCandleSeries(chain as string, address, selectedFrame, cacheMode(), result.changes.map((change) => ({
			time: change.point.candle.time,
			close: change.point.candle.close
		})));

		let nextAth = showMarketCap ? currentAthMcap : currentAthPrice;
		let nextAthTime = athSourceTime;
		for (const change of result.changes) {
			if (change.point.candle.high > nextAth) {
				nextAth = change.point.candle.high;
				nextAthTime = change.point.candle.time;
			}
		}
		if (previousAthSource !== null) {
			const correctedSource = result.changes.find((change) => change.kind === 'correct' && change.point.candle.time === previousAthSource);
			if (correctedSource && correctedSource.point.candle.high < nextAth) {
				const maximum = candleHigh(allCandleData);
				candleDiagnostics.add('extremaScans');
				nextAth = maximum.value;
				nextAthTime = maximum.time;
			}
		}
		if (showMarketCap ? nextAth !== currentAthMcap : nextAth !== currentAthPrice) {
			athSourceTime = nextAthTime;
			if (showMarketCap) currentAthMcap = nextAth;
			else {
				currentAthPrice = nextAth;
				setLiveAthPrice(nextAth);
			}
			updatePriceLines();
		}
	}

	function setupCandleWs(c: string, a: string, frame: string, generation: number) {
		cleanupCandleWs();
		const wsTf = frameToWsTopic[frame] ?? frame;
		const candleType = showMarketCap ? 'marketCap' : 'price';
		const topic = `token:${c}:${a}:candle:${wsTf}:${candleType}`;

		candleWsKey = subscribe(topic, (event, payload) => {
			if (event !== 'TOKEN_CANDLE') return;
			if (disposed || generation !== loadGeneration || !payload) return;
			const candles = payload.candles;
			if (!Array.isArray(candles)) return;
			candleDiagnostics.add('rawCandles', candles.length);
			for (const data of candles as RawCandleUpdate[]) pendingCandles.set(data.time, data);
			candleDiagnostics.max('maxPendingCandles', pendingCandles.size);
			scheduleCandleDrain();
		});
	}

	function updateMarkers() {
		if (!canProject() || !candleSeries) {
			projectionDirty = true;
			return;
		}
		if (markerPlugin) markerPlugin.setMarkers([]);
		updateCallAvatars();
		updateSwapIndicators();
		updateMigrationMarker();
	}

	function updatePriceLines() {
		if (!canProject() || !candleSeries) {
			projectionDirty = true;
			return;
		}
		for (const pl of priceLines) {
			try { candleSeries.removePriceLine(pl); } catch {}
		}
		priceLines = [];
		if (getIsLoggedIn()) {
			const trades = getActiveTrades();
			const trade = trades.find(t => t.chain === chain && t.tokenAddress.toLowerCase() === address.toLowerCase());
			if (trade?.activeTargets || trade?.metTargets) {
				const entryVal = showMarketCap
					? trade.avgEntryMcap.usd
					: trade.avgEntryPrice.usd;
				const metIds = new Set((trade.metTargets ?? []).map((m: any) => m.id));
				const liveTargets = (trade.activeTargets ?? []).map((t: any) => ({ ...t, _met: t.status === 'MET' || metIds.has(t.id) }));
				const metOnly = (trade.metTargets ?? []).filter((m: any) => !liveTargets.some((l: any) => l.id === m.id)).map((t: any) => ({ ...t, _met: true }));
				const allTargets = [...liveTargets, ...metOnly];
				let tpIdx = 0;
				let slIdx = 0;
				for (const target of allTargets) {
					const isSl = target.kind === 'STOP_LOSS';
					const isMet = target._met;
					let val = 0;
					if (target.trigger.type === 'MULTIPLIER' && entryVal) {
						val = entryVal * target.trigger.multiplier;
					} else if (target.trigger.type === 'PERCENT' && entryVal) {
						const pct = target.trigger.changePct;
						val = isSl ? entryVal * (1 - Math.abs(pct) / 100) : entryVal * (1 + pct / 100);
					} else if (target.trigger.type === 'MARKET_CAP_USD') {
						const mcapTarget = target.trigger.marketCapUsd;
						if (showMarketCap) {
							val = mcapTarget;
						} else if (entryVal > 0 && trade) {
							const entryMcap = trade.avgEntryMcap.usd;
							if (entryMcap > 0) val = entryVal * (mcapTarget / entryMcap);
						}
					} else if (target.trigger.type === 'PRICE') {
						const usdTarget = target.trigger.priceUsd;
						if (!showMarketCap) {
							val = usdTarget;
						} else if (entryVal > 0 && trade) {
							const entryPrice = trade.avgEntryPrice.usd;
							if (entryPrice > 0) val = entryVal * (usdTarget / entryPrice);
						}
					}
					if (val > 0) {
						const label = isSl ? `SL${++slIdx}` : `TP${++tpIdx}`;
						const color = isSl ? tc('--t-red-dark') : tc('--t-grn-darker');
						const lineStyle = isMet ? 1 : LineStyleDashed;
						priceLines.push(candleSeries.createPriceLine({
							price: val,
							color,
							lineWidth: 1,
							lineStyle,
							axisLabelVisible: true,
							title: isMet ? `${label} \u2713` : label
						}));
					}
				}
				const pendingBuy = trade.pendingSwaps?.find(s => s.side === 'BUY');
				if (pendingBuy && pendingBuy.side === 'BUY' && 'strategy' in pendingBuy && pendingBuy.strategy.type === 'DIP' && entryVal) {
					const dipPct = pendingBuy.strategy.dipPct;
					const val = entryVal * (1 - dipPct / 100);
					if (val > 0) {
						priceLines.push(candleSeries.createPriceLine({
							price: val,
							color: tc('--t-blu-light'),
							lineWidth: 1,
							lineStyle: LineStyleDashed,
							axisLabelVisible: true,
							title: 'BUY'
						}));
					}
				}
			}
		}
		const athVal = showMarketCap ? currentAthMcap : currentAthPrice;
		if (athVal > 0) {
			priceLines.push(candleSeries.createPriceLine({
				price: athVal,
				color: tc('--t-yel'),
				lineWidth: 1,
				lineStyle: LineStyleDashed,
				axisLabelVisible: true,
				title: 'ATH'
			}));
		}
	}

	function processCandles(candles: RawCandleUpdate[]): { candleData: CandlePoint[]; volumeData: VolumePoint[]; areaData: AreaPoint[] } {
		const candleData: CandlePoint[] = [];
		const volumeData: VolumePoint[] = [];
		const areaData: AreaPoint[] = [];
		for (const candle of latestCandlesByTime(candles)) {
			const normalized = normalizeCandle(candle, candleColors);
			candleData.push(normalized.candle);
			volumeData.push(normalized.volume);
			areaData.push(normalized.area);
		}
		return { candleData, volumeData, areaData };
	}

	async function fetchOlderCandles() {
		if (disposed || fetchingMore || noMoreCandles || !candleSeries || !volumeSeries || !chartInstance) return;
		const requestId = ++historyRequestId;
		const generation = loadGeneration;
		const requestChain = chain;
		const requestAddress = address;
		const requestFrame = selectedFrame;
		const requestMode = showMarketCap;
		const ownsRequest = () => !disposed
			&& requestId === historyRequestId
			&& generation === loadGeneration
			&& requestChain === chain
			&& requestAddress === address
			&& requestFrame === selectedFrame
			&& requestMode === showMarketCap;
		fetchingMore = true;
		try {
			const { data: res } = await api.GET('/v2/token/{chain}/{address}/candles', {
				params: {
					path: { chain: chain as Chain, address },
					query: { timeframe: selectedFrame as CandleFrame, to: earliestTime - 1, count: 300, mode: showMarketCap ? 'marketCap' : undefined }
				}
			});
			if (!ownsRequest()) return;
			const candles = res?.candles ?? [];
			if (candles.length === 0) {
				noMoreCandles = true;
				return;
			}
			const olderCandles = candles.filter((c: any) => c.time < earliestTime && !candleIndexByTime.has(c.time));
			if (olderCandles.length === 0) {
				noMoreCandles = true;
				return;
			}
			captureViewport();
			const { candleData, volumeData, areaData } = processCandles(olderCandles as RawCandleUpdate[]);
			allCandleData = [...candleData, ...allCandleData];
			allVolumeData = [...volumeData, ...allVolumeData];
			allAreaData = [...areaData, ...allAreaData];
			candleIndexByTime = buildCandleIndex(allCandleData);
			earliestTime = candleData[0].time;

			canonicalVersion += 1;
			projectionDirty = true;
			projectCanonicalState();
			if (!res?.hasMore) noMoreCandles = true;
		} catch (e) {
			if (ownsRequest()) console.error('Failed to fetch older candles:', e);
		} finally {
			if (!ownsRequest()) return;
			fetchingMore = false;
			if (!noMoreCandles && chartInstance && canProject()) {
				const range = chartInstance.timeScale().getVisibleLogicalRange();
				if (needsMoreCandles(range)) fetchOlderCandles();
			}
		}
	}

	function updateAreaGradient() {
		if (!canProject() || !areaSeries || !chartInstance || allCandleData.length === 0) {
			projectionDirty = true;
			return;
		}
		const range = chartInstance.timeScale().getVisibleLogicalRange();
		if (!range) return;
		const from = Math.max(0, Math.floor(range.from));
		const to = Math.min(allCandleData.length - 1, Math.ceil(range.to));
		if (from >= to) return;
		const firstClose = allCandleData[from].close;
		const lastVisibleClose = allCandleData[to].close;
		const isUp = lastVisibleClose >= firstClose;
		const g = tc('--t-grn');
		const r = tc('--t-red');
		areaSeries.applyOptions({
			topColor: withHexAlpha(isUp ? g : r, '2E'),
			bottomColor: withHexAlpha(isUp ? g : r, '08'),
		});
	}

	function needsMoreCandles(logicalRange: any): boolean {
		if (!logicalRange) return false;
		const visibleBars = logicalRange.to - logicalRange.from;
		const threshold = Math.max(10, Math.round(visibleBars * 0.15));
		return logicalRange.from < threshold;
	}

	function onVisibleRangeChange(logicalRange: any) {
		if (!logicalRange || !canProject() || projectionInProgress) return;
		updateAreaGradient();
		if (initialLoadDone) scheduleMarkersFetch();
		if (!initialLoadDone || noMoreCandles || fetchingMore) return;
		if (needsMoreCandles(logicalRange)) {
			fetchOlderCandles();
		}
	}

	async function loadCandles(frame: string) {
		const gen = ++loadGeneration;
		historyRequestId += 1;
		cleanupCandleWs();
		const mcap = showMarketCap;
		loading = true;
		error = '';
		noMoreCandles = false;
		fetchingMore = false;
		initialLoadDone = false;
		try {
			const { data: res } = await api.GET('/v2/token/{chain}/{address}/candles', {
				params: {
					path: { chain: chain as Chain, address },
					query: { timeframe: frame as CandleFrame, mode: mcap ? 'marketCap' : undefined }
				}
			});

			if (gen !== loadGeneration) return;

			const candles = res?.candles ?? [];

			if (candles.length === 0) {
				error = 'No candle data available';
				loading = false;
				return;
			}

			const { candleData, volumeData, areaData } = processCandles(candles as RawCandleUpdate[]);
			allCandleData = candleData;
			allVolumeData = volumeData;
			allAreaData = areaData;
			// Re-derive theme colors now that we're on-screen (CSS vars are
			// guaranteed resolvable here) and recolor the just-built volume points,
			// so a prod build that read tc() before the stylesheet applied doesn't
			// leave black volume bars until a theme toggle.
			applyThemeColors();
			candleIndexByTime = buildCandleIndex(candleData);
			setCandleSeries(chain as string, address, frame, mcap ? 'marketCap' : 'price', candleData.map((candle) => ({ time: candle.time, close: candle.close })));
			earliestTime = candleData[0].time;
			lastClose = candleData[candleData.length - 1].close;
			lastCloseStr = candles[candles.length - 1].closeStr ?? String(lastClose);
			const maximum = candleHigh(candleData);
			canonicalVersion += 1;
			projectionDirty = true;
			const suppliedAthPrice = parseFloat(athPrice ?? '0');
			const suppliedAthMcap = parseFloat(athMcap ?? '0');
			currentAthPrice = showMarketCap ? suppliedAthPrice : Math.max(suppliedAthPrice, maximum.value);
			currentAthMcap = showMarketCap ? Math.max(suppliedAthMcap, maximum.value) : suppliedAthMcap;
			athSourceTime = maximum.value >= (showMarketCap ? suppliedAthMcap : suppliedAthPrice) ? maximum.time : null;
			setLiveAthPrice(currentAthPrice);
			projectCanonicalState();
			initialLoadDone = false;
			requestAnimationFrame(() => {
				if (gen !== loadGeneration || disposed) return;
				initialLoadDone = true;
				fetchChartMarkers();
			});

			setupCandleWs(chain as string, address, frame, gen);
		} catch (e: any) {
			if (gen !== loadGeneration) return;
			error = e?.message ?? 'Failed to load candles';
		} finally {
			if (gen === loadGeneration) loading = false;
		}
	}

	onMount(() => {
		let resizeObserver: ResizeObserver;
		documentVisible = !document.hidden;
		const onVisibilityChange = () => {
			documentVisible = !document.hidden;
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		(async () => {
		const { createChart, CandlestickSeries, HistogramSeries, AreaSeries, createSeriesMarkers, LineStyle } = await import('lightweight-charts');
		await waitForProjection();
		if (disposed) return;
		createSeriesMarkersFn = createSeriesMarkers;
		LineStyleDashed = LineStyle.Dashed;

		const cBg = tc('--t-s4');
		const cText = tc('--t-g7');
		const cGrid = tc('--t-s8');
		const cBorder = tc('--t-bd2');
			const cGrn = tc('--t-grn');
			const cRed = tc('--t-red');
			candleColors = { upVolume: withHexAlpha(cGrn, '4D'), downVolume: withHexAlpha(cRed, '4D') };

		chartInstance = createChart(chartContainer, {
			width: chartContainer.clientWidth,
			height: chartHeight,
			layout: {
				background: { color: cBg },
				textColor: cText,
				fontFamily: 'monospace'
			},
			grid: {
				vertLines: { color: cGrid },
				horzLines: { color: cGrid }
			},
			crosshair: {
				mode: 0
			},
			timeScale: {
				borderColor: cBorder,
				timeVisible: true,
				secondsVisible: false,
				allowShiftVisibleRangeOnWhitespaceReplacement: false,
				tickMarkFormatter: (time: number, tickMarkType: number) => {
					const d = new Date(time * 1000);
					if (tickMarkType >= 3) {
						return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
					}
					if (tickMarkType === 2) {
						return d.toLocaleDateString([], { day: 'numeric' });
					}
					if (tickMarkType === 1) {
						return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
					}
					return d.toLocaleDateString([], { year: 'numeric', month: 'short' });
				}
			},
			rightPriceScale: {
				borderColor: cBorder,
				mode: 0
			},
			localization: {
				priceFormatter: (price: number) => formatPriceText(price).replace('$', ''),
				timeFormatter: (time: number) =>
					new Date(time * 1000).toLocaleString([], {
						month: 'short', day: 'numeric',
						hour: '2-digit', minute: '2-digit'
					})
			}
		});

		candleSeries = chartInstance.addSeries(CandlestickSeries, {
			upColor: cGrn,
			downColor: cRed,
			borderUpColor: cGrn,
			borderDownColor: cRed,
			wickUpColor: cGrn,
			wickDownColor: cRed,
			priceFormat: {
				type: 'custom',
				formatter: (price: number) => formatPriceText(price).replace('$', ''),
				minMove: 1e-20
			}
		});

		volumeSeries = chartInstance.addSeries(HistogramSeries, {
			color: withHexAlpha(cGrn, '4D'),
			priceFormat: { type: 'volume' },
			priceScaleId: 'volume',
			lastValueVisible: false,
			baseLineVisible: false
		});

		chartInstance.priceScale('volume').applyOptions({
			scaleMargins: { top: 0.8, bottom: 0 },
			visible: false
		});

		areaSeries = chartInstance.addSeries(AreaSeries, {
			lineWidth: 0,
			lineColor: 'transparent',
			topColor: withHexAlpha(cGrn, '2E'),
			bottomColor: withHexAlpha(cGrn, '08'),
			lastValueVisible: false,
			priceLineVisible: false,
			crosshairMarkerVisible: false,
			priceFormat: { type: 'custom', formatter: (p: number) => formatPriceText(p).replace('$', ''), minMove: 1e-20 }
		});

		markerPlugin = createSeriesMarkersFn(candleSeries, []);
		callAvatarPrimitive = new CallAvatarPrimitive();
		candleSeries.attachPrimitive(callAvatarPrimitive);
		swapPrimitive = new SwapPrimitive();
		candleSeries.attachPrimitive(swapPrimitive);
		migrationPrimitive = new MigrationPrimitive();
		candleSeries.attachPrimitive(migrationPrimitive);

		rangeHandler = onVisibleRangeChange;
		chartInstance.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
		chartInstance.subscribeClick(handleChartClick);
		chartInstance.subscribeCrosshairMove(handleCrosshairMove);

		resizeObserver = new ResizeObserver((entries) => {
			if (disposed) return;
			for (const entry of entries) {
				pendingWidth = entry.contentRect.width;
				if (canProject()) chartInstance?.applyOptions({ width: entry.contentRect.width });
				else projectionDirty = true;
			}
		});
		resizeObserver.observe(chartContainer);

		// Cold-load fix: the chart/series/markers were created with tc() colors
		// that may have resolved to fallbacks if this ran before the app's
		// stylesheet applied its CSS vars. Re-apply colors after two frames, once
		// the browser has recalculated styles, so volume bars + markers get the
		// real theme colors without needing a manual theme toggle.
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (!disposed) applyThemeColors();
			});
		});
		})();

		return () => {
			disposed = true;
			for (const resolve of projectionWaiters) resolve();
			projectionWaiters.clear();
			cleanupCandleWs();
			cleanupMarkersWs();
			markersCoalescer.dispose();
			if (rangeHandler && chartInstance) {
				chartInstance.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler);
			}
			resizeObserver?.disconnect();
			document.removeEventListener('visibilitychange', onVisibilityChange);
			priceLines = [];
			if (markersFetchTimer) clearTimeout(markersFetchTimer);
			if (candleSeries) {
				if (callAvatarPrimitive) try { candleSeries.detachPrimitive(callAvatarPrimitive); } catch {}
				if (swapPrimitive) try { candleSeries.detachPrimitive(swapPrimitive); } catch {}
				if (migrationPrimitive) try { candleSeries.detachPrimitive(migrationPrimitive); } catch {}
			}
			callAvatarPrimitive = null;
			swapPrimitive = null;
			migrationPrimitive = null;
			if (chartTooltipTimer) clearTimeout(chartTooltipTimer);
			chartTooltip = null;
			chartInstance?.unsubscribeClick(handleChartClick);
			chartInstance?.unsubscribeCrosshairMove(handleCrosshairMove);
			candleSeries = null;
			volumeSeries = null;
			markerPlugin = null;
			chartInstance?.remove();
			chartInstance = null;
		};
	});

	let wasProjectable = false;
	$effect(() => {
		const projectable = active && documentVisible;
		untrack(() => {
			if (wasProjectable && !projectable) captureViewport();
			wasProjectable = projectable;
			if (!projectable && document.hidden && candleFrameRequest && pendingCandles.size > 0) {
				cancelAnimationFrame(candleFrameRequest);
				candleFrameRequest = 0;
				scheduleCandleDrain();
			}
			if (projectable) {
				notifyProjectionWaiters();
				projectCanonicalState();
			}
		});
	});

	$effect(() => {
		if (!disposed && chartInstance && chartHeight && canProject()) {
			chartInstance.applyOptions({ height: chartHeight });
		} else if (chartHeight) {
			projectionDirty = true;
		}
	});

	let prevMarkerToken = '';
	$effect(() => {
		const key = `${chain}:${address}`;
		if (key !== prevMarkerToken) {
			prevMarkerToken = key;
			untrack(() => {
				resetMarkerCache();
				setupMarkersWs(chain as string, address);
			});
		}
	});

	$effect(() => {
		if (!disposed && selectedFrame !== undefined && showMarketCap !== undefined) {
			loadCandles(selectedFrame);
		}
	});

	// Re-draw TP/SL price lines when the user's active-trade targets change.
	let prevTradeKey = '';
	$effect(() => {
		const active = getActiveTrades();
		const trade = active.find(t => t.chain === chain && t.tokenAddress.toLowerCase() === address.toLowerCase());
		const key = JSON.stringify({
			targets: trade?.activeTargets?.map((t: { kind: string; status: string }) => `${t.kind}:${t.status}`).join(','),
			metTargets: trade?.metTargets?.length
		});
		if (key !== prevTradeKey) {
			prevTradeKey = key;
			updatePriceLines();
		}
	});

</script>

<div class="relative overflow-hidden rounded-xl border border-bd/60 bg-s4">
	<div class="flex items-center gap-0.5 border-b border-bd/60 bg-s0 px-2 py-1.5">
		{#each frames as f}
			<button
				class="rounded-md px-2 py-1 text-sm font-medium transition-all duration-150 {selectedFrame === f.value
					? 'bg-wh/10 text-tx'
					: 'text-g5 hover:bg-s7 hover:text-g9'}"
				onclick={() => setSelectedFrame(f.value)}
			>
				{f.label}
			</button>
		{/each}
		<div class="ml-auto flex items-center gap-1.5">
			{#if fetchingMore}
				<div class="flex items-center gap-1.5 text-[11px] text-g5">
					<LoaderCircle class="h-3 w-3 animate-spin" />
					Loading...
				</div>
			{/if}
			<div class="relative">
				<button
					class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all duration-150 {markerMenuOpen
						? 'bg-wh/10 text-tx'
						: 'text-g5 hover:bg-s7 hover:text-g9'}"
					onclick={() => (markerMenuOpen = !markerMenuOpen)}
					title="Chart markers"
				>
					<Layers class="h-3.5 w-3.5" />
					Markers
				</button>
				{#if markerMenuOpen}
					<button type="button" class="fixed inset-0 z-20 cursor-default" onclick={() => (markerMenuOpen = false)} aria-label="Close markers menu"></button>
					<div class="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-bd bg-s5 py-1 shadow-2xl">
						{#snippet markerRow(label: string, active: boolean, Icon: any, kind: 'user' | 'calls' | 'kols')}
							<button
								class="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-wh/5 {active ? 'text-tx' : 'text-g5'}"
								onclick={() => toggleMarkerVis(kind)}
							>
								<Icon class="h-3.5 w-3.5 shrink-0" />
								<span class="flex-1 text-left">{label}</span>
								<span class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors {active ? 'bg-grn' : 'bg-bd2'}">
									<span class="absolute h-3 w-3 rounded-full bg-wh transition-all {active ? 'left-[14px]' : 'left-0.5'}"></span>
								</span>
							</button>
						{/snippet}
						{@render markerRow('Your swaps', showUserSwaps, UserRound, 'user')}
						{@render markerRow('Calls', showCalls, Megaphone, 'calls')}
						{@render markerRow('KOLs', showKols, Crown, 'kols')}
					</div>
				{/if}
			</div>
			<button
				class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all duration-150 {showMarketCap
					? 'bg-wh/10 text-tx'
					: 'text-g5 hover:bg-s7 hover:text-g9'}"
				onclick={() => setShowMarketCap(!showMarketCap)}
				title={showMarketCap ? 'Showing Market Cap' : 'Showing Price'}
			>
				{#if showMarketCap}
					<BarChart3 class="h-3.5 w-3.5" />
					MC
				{:else}
					<DollarSign class="h-3.5 w-3.5" />
					Price
				{/if}
			</button>
		</div>
	</div>
	<div class="relative" style="min-height:{chartHeight}px;">
		{#if loading}
			<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-s4/90">
				<LoaderCircle class="h-5 w-5 animate-spin text-tx" />
				<span class="text-sm text-g6">Loading chart...</span>
			</div>
		{/if}
		{#if error}
			<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-s4/90">
				<LineChart class="h-6 w-6 text-g6" strokeWidth={1.5} />
				<span class="text-sm text-g6">{error}</span>
			</div>
		{/if}
		<div bind:this={chartContainer} class="relative">
			{#if chartTooltip?.kol}
				{@const k = chartTooltip.kol}
				<div
					class="absolute z-20 w-64 rounded-lg border border-bd bg-s5 shadow-2xl"
					style="left: {chartTooltip.x}px; top: {chartTooltip.y}px; transform: translate(-50%, -100%);"
				>
					<div class="flex items-center justify-between border-b border-bd px-3 py-2">
						<span class="text-[11px] font-bold text-tx">{k.rows.length} wallet{k.rows.length !== 1 ? 's' : ''}</span>
						<button type="button" class="cursor-pointer text-g5 transition-colors hover:text-tx" onclick={() => (chartTooltip = null)} aria-label="Close"><span class="text-sm leading-none">&times;</span></button>
					</div>
					<div class="flex items-center gap-3 border-b border-bd px-3 py-1.5 text-[11px]">
						<span class="text-grn">{k.buyCount} buy{k.buyCount !== 1 ? 's' : ''} · {formatUsd(k.totalBuyUsd.toString())}</span>
						<span class="text-red">{k.sellCount} sell{k.sellCount !== 1 ? 's' : ''} · {formatUsd(k.totalSellUsd.toString())}</span>
					</div>
					<div class="max-h-52 overflow-y-auto py-1">
						{#each k.rows as r}
							{@const ctSt = copyTradeState[r.walletAddress] ?? 'idle'}
							<div class="flex items-center gap-2 px-3 py-1.5">
								<img src={r.photoUrl ?? getWalletIconUrl(r.walletAddress)} alt="" class="h-5 w-5 shrink-0 rounded-full object-cover" />
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1 truncate text-[11px] font-medium text-tx">{#if r.isDev}<span class="shrink-0 rounded bg-yel/20 px-1 py-px text-[9px] font-bold text-yel">DEV</span><span class="truncate font-mono">{shortAddress(r.walletAddress)}</span>{:else}<span class="truncate">{r.name !== '?' ? r.name : shortAddress(r.walletAddress)}</span>{/if}</div>
									<div class="flex items-center gap-2 text-[10px]">
										{#if r.buys > 0}<span class="text-grn">{r.buys} buy{r.buys !== 1 ? 's' : ''} · {formatUsd(r.buyUsd)}</span>{/if}
										{#if r.sells > 0}<span class="text-red">{r.sells} sell{r.sells !== 1 ? 's' : ''} · {formatUsd(r.sellUsd)}</span>{/if}
									</div>
								</div>
								{#if onopentrader}
									<button
										type="button"
										onclick={() => { onopentrader?.(r.walletAddress); chartTooltip = null; }}
										title="View trader details"
										class="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-bd px-1.5 py-1 text-[10px] font-medium text-g6 transition-colors hover:border-tx hover:text-tx"
									>
										<ChartLine class="h-3 w-3" />
									</button>
								{/if}
								<button
									type="button"
									disabled={ctSt !== 'idle'}
									onclick={() => copyTradeKol(r)}
									title="Copy trade"
									class="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors disabled:cursor-default {ctSt === 'done' ? 'border-grn/40 text-grn' : 'border-bd text-g6 hover:border-grn/40 hover:text-grn'}"
								>
									{#if ctSt === 'done'}<Check class="h-3 w-3" />{:else if ctSt === 'adding'}<LoaderCircle class="h-3 w-3 animate-spin" />{:else}<UserPlus class="h-3 w-3" />{/if}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{:else if chartTooltip?.lines}
				<div
					class="absolute z-20 rounded-lg border border-bd bg-s5 px-2.5 py-1.5 shadow-lg"
					style="left: {chartTooltip.x}px; top: {chartTooltip.y}px; transform: translate(-50%, -100%);"
				>
					{#each chartTooltip.lines as line}
						<div class="whitespace-nowrap text-[11px] font-medium text-tx">{line}</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
