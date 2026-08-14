import { tc } from '$lib/stores/theme.svelte';

export type SwapInfo = { side: string; usd: number };
export type SwapIndicatorData = { time: number; price: number; isBuy: boolean; swaps: SwapInfo[]; isDev?: boolean };

export function drawChefHat(ctx: any, cx: number, cy: number, s: number, color: string) {
	// Simple chef-hat glyph: puffy top (3 bumps) + a band at the bottom.
	ctx.fillStyle = color;
	const top = cy - s * 0.35;
	const r = s * 0.28;
	ctx.beginPath();
	ctx.arc(cx - r, top + r * 0.4, r * 0.8, 0, Math.PI * 2);
	ctx.arc(cx, top, r, 0, Math.PI * 2);
	ctx.arc(cx + r, top + r * 0.4, r * 0.8, 0, Math.PI * 2);
	ctx.fill();
	// band / base
	const bw = s * 0.72;
	const bh = s * 0.32;
	ctx.fillRect(cx - bw / 2, cy + s * 0.05, bw, bh);
}

export class SwapPrimitive {
	_data: SwapIndicatorData[] = [];
	_series: any = null;
	_chart: any = null;
	_requestUpdate?: () => void;

	setData(data: SwapIndicatorData[]) {
		this._data = data;
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
		return [new SwapPaneView(this)];
	}
}

class SwapPaneView {
	_primitive: SwapPrimitive;
	constructor(primitive: SwapPrimitive) { this._primitive = primitive; }
	zOrder() { return 'top' as const; }
	renderer() { return new SwapRenderer(this._primitive); }
}

class SwapRenderer {
	_primitive: SwapPrimitive;
	constructor(primitive: SwapPrimitive) { this._primitive = primitive; }
	_drawMarker(ctx: any, d: SwapIndicatorData, bx: number, by: number, bsz: number, ratio: number) {
		const color = d.isBuy ? tc('--t-grn') : tc('--t-red');
		ctx.fillStyle = color;
		ctx.globalAlpha = 0.85;
		ctx.beginPath();
		ctx.arc(bx, by, bsz / 2, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.strokeStyle = tc('--t-s0');
		ctx.lineWidth = Math.max(1, 1.5 * ratio);
		ctx.beginPath();
		ctx.arc(bx, by, bsz / 2, 0, Math.PI * 2);
		ctx.stroke();
		if (d.isDev) {
			drawChefHat(ctx, bx, by, bsz * 0.62, tc('--t-s0'));
		} else {
			const arrowSz = Math.round(bsz * 0.28);
			const arrowY = d.isBuy ? 1 : -1;
			ctx.fillStyle = tc('--t-s0');
			ctx.beginPath();
			ctx.moveTo(bx, by - arrowSz * arrowY);
			ctx.lineTo(bx - arrowSz * 0.7, by + arrowSz * 0.5 * arrowY);
			ctx.lineTo(bx + arrowSz * 0.7, by + arrowSz * 0.5 * arrowY);
			ctx.closePath();
			ctx.fill();
		}
		if (d.swaps.length > 1) {
			const badgeSz = Math.round(bsz * 0.56);
			const badgeX = bx + bsz / 2 - badgeSz / 3;
			const badgeY = by - bsz / 2;
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(badgeX, badgeY, badgeSz / 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = tc('--t-s0');
			ctx.lineWidth = Math.max(1, ratio);
			ctx.beginPath();
			ctx.arc(badgeX, badgeY, badgeSz / 2, 0, Math.PI * 2);
			ctx.stroke();
			ctx.fillStyle = tc('--t-s0');
			ctx.font = `bold ${Math.round(badgeSz * 0.7)}px sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(d.swaps.length), badgeX, badgeY);
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
			const bsz = Math.round(sz * ratio);
			const pad = Math.round(4 * vRatio);
			for (const d of p._data) {
				const x = ts.timeToCoordinate(d.time);
				if (x === null) continue;
				const priceY = p._series.priceToCoordinate(d.price);
				if (priceY === null) continue;
				const bx = Math.round(x * ratio);
				const by = d.isBuy
					? Math.round(priceY * vRatio) + pad + bsz / 2
					: Math.round(priceY * vRatio) - pad - bsz / 2;
				this._drawMarker(ctx, d, bx, by, bsz, ratio);
			}
		});
	}
}

export type MigrationMarkerData = { time: number; price?: number | null };

export class MigrationPrimitive {
	_data: MigrationMarkerData | null = null;
	_series: any = null;
	_chart: any = null;
	_requestUpdate?: () => void;

	setData(data: MigrationMarkerData | null) {
		this._data = data;
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
		return [new MigrationPaneView(this)];
	}
}

class MigrationPaneView {
	_primitive: MigrationPrimitive;
	constructor(primitive: MigrationPrimitive) { this._primitive = primitive; }
	zOrder() { return 'top' as const; }
	renderer() { return new MigrationRenderer(this._primitive); }
}

class MigrationRenderer {
	_primitive: MigrationPrimitive;
	constructor(primitive: MigrationPrimitive) { this._primitive = primitive; }
	draw(target: any) {
		const p = this._primitive;
		if (!p._chart || !p._data) return;
		target.useBitmapCoordinateSpace((scope: any) => {
			const ctx = scope.context;
			const ratio = scope.horizontalPixelRatio;
			const vRatio = scope.verticalPixelRatio;
			const ts = p._chart.timeScale();
			const x = ts.timeToCoordinate(p._data!.time);
			if (x === null) return;
			const bx = Math.round(x * ratio);
			const h = scope.bitmapSize?.height ?? ctx.canvas.height;
			const color = tc('--t-yel');
			// Vertical dashed guide line.
			ctx.strokeStyle = color;
			ctx.globalAlpha = 0.35;
			ctx.lineWidth = Math.max(1, 1.5 * ratio);
			ctx.setLineDash([Math.round(4 * ratio), Math.round(4 * ratio)]);
			ctx.beginPath();
			ctx.moveTo(bx, 0);
			ctx.lineTo(bx, h);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.globalAlpha = 1;

			// Flag anchored near the candle (below it) instead of at the very top.
			const priceY = p._series && p._data!.price != null ? p._series.priceToCoordinate(p._data!.price) : null;
			const gap = Math.round(14 * vRatio);
			const poleH = Math.round(22 * vRatio);
			const baseY = priceY != null ? Math.round(priceY * vRatio) + gap : Math.round(h * 0.5);
			const topY = baseY - poleH;
			// Pole
			ctx.strokeStyle = color;
			ctx.lineWidth = Math.max(1.5, 2 * ratio);
			ctx.beginPath();
			ctx.moveTo(bx, baseY);
			ctx.lineTo(bx, topY);
			ctx.stroke();
			// Flag (triangle pennant)
			const fw = Math.round(16 * ratio);
			const fh = Math.round(12 * vRatio);
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(bx, topY);
			ctx.lineTo(bx + fw, topY + fh * 0.4);
			ctx.lineTo(bx, topY + fh * 0.8);
			ctx.closePath();
			ctx.fill();
			// Small "M" on the flag for clarity.
			ctx.fillStyle = tc('--t-s0');
			ctx.font = `bold ${Math.round(7 * ratio)}px sans-serif`;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			ctx.fillText('M', bx + Math.round(3 * ratio), topY + fh * 0.4);
			// Base dot
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(bx, baseY, Math.max(2, 2.5 * ratio), 0, Math.PI * 2);
			ctx.fill();
		});
	}
}
