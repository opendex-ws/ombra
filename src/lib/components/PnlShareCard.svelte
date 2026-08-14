<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import X from 'lucide-svelte/icons/x';
	import Download from 'lucide-svelte/icons/download';
	import { formatUsd, formatPriceText } from '$lib/utils/format';
	import type { CompletedTrade } from '$lib/api/types';

	import profitMoney from '$lib/assets/pnl-bg/profit-3.webp';
	import profitStonks from '$lib/assets/pnl-bg/profit-stonks.webp';
	import profitLeo from '$lib/assets/pnl-bg/profit-leo.webp';
	import profitKramer from '$lib/assets/pnl-bg/profit-kramer.webp';
	import profitBrrr from '$lib/assets/pnl-bg/profit-brrr.webp';
	import lossStorm from '$lib/assets/pnl-bg/loss-4.webp';
	import lossJoker from '$lib/assets/pnl-bg/loss-joker.webp';
	import lossNotStonks from '$lib/assets/pnl-bg/loss-notstonks.webp';
	import lossThisIsFine from '$lib/assets/pnl-bg/loss-thisisfine.webp';
	import lossNick from '$lib/assets/pnl-bg/loss-nick.webp';
	import lossSquidward from '$lib/assets/pnl-bg/loss-squidward.webp';

	let { show = $bindable(false), trade }: {
		show?: boolean;
		trade: CompletedTrade | null;
	} = $props();

	type BgOption = { label: string; src?: string; gradient?: [string, string, string]; pattern?: string };

	const PROFIT_BGS: BgOption[] = [
		{ label: 'Candles', gradient: ['#0a1a0f', '#0d2614', '#071a0a'], pattern: 'candles' },
		{ label: 'Matrix', gradient: ['#020d02', '#061206', '#020a02'], pattern: 'matrix' },
		{ label: 'Neon', gradient: ['#0a0815', '#100d20', '#08061a'], pattern: 'neon' },
		{ label: 'Money', src: profitMoney },
		{ label: 'Stonks', src: profitStonks },
		{ label: 'Brrr', src: profitBrrr },
		{ label: 'Leo', src: profitLeo },
		{ label: 'Kramer', src: profitKramer },
	];

	const LOSS_BGS: BgOption[] = [
		{ label: 'Blood', gradient: ['#1a0505', '#2e0a0a', '#140404'], pattern: 'candles' },
		{ label: 'Ember', gradient: ['#1a0808', '#150505', '#100303'], pattern: 'ember' },
		{ label: 'Storm', src: lossStorm },
		{ label: 'Joker', src: lossJoker },
		{ label: 'Not Stonks', src: lossNotStonks },
		{ label: 'This is Fine', src: lossThisIsFine },
		{ label: 'Nick Young', src: lossNick },
		{ label: 'Squidward', src: lossSquidward },
	];

	let selectedBg = $state(0);
	let previewUrl = $state('');
	let imgCache = new Map<string, HTMLImageElement>();

	function close() { show = false; previewUrl = ''; selectedBg = 0; }

	let isProfit = $derived(trade ? (trade.pnl.pct as number) >= 0 : true);
	let bgOptions = $derived(isProfit ? PROFIT_BGS : LOSS_BGS);

	function loadBgImage(src: string): Promise<HTMLImageElement> {
		const cached = imgCache.get(src);
		if (cached?.complete) return Promise.resolve(cached);
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => { imgCache.set(src, img); resolve(img); };
			img.onerror = reject;
			img.src = src;
		});
	}

	let prevTradeId: number | null = null;

	$effect(() => {
		if (!show || !trade) return;
		const tid = trade.id;
		if (tid !== prevTradeId) {
			prevTradeId = tid;
			selectedBg = 0;
		}
	});

	$effect(() => {
		const bg = selectedBg;
		const s = show;
		const t = trade;
		if (!s || !t) return;
		void doRender(t, bg);
	});

	async function doRender(t: CompletedTrade, bgIdx: number) {
		const opts = (t.pnl.pct as number) >= 0 ? PROFIT_BGS : LOSS_BGS;
		const bg = opts[bgIdx] ?? opts[0];
		let bgImg: HTMLImageElement | null = null;
		if (bg.src) {
			try { bgImg = await loadBgImage(bg.src); } catch {}
		}
		renderCard(t, bg, bgImg);
	}

	function drawProceduralBg(ctx: CanvasRenderingContext2D, w: number, h: number, bg: BgOption) {
		const g = bg.gradient!;
		const grad = ctx.createLinearGradient(0, 0, w, h);
		grad.addColorStop(0, g[0]);
		grad.addColorStop(0.5, g[1]);
		grad.addColorStop(1, g[2]);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, h);
		const accent = isProfit ? '#22c55e' : '#ef4444';

		if (bg.pattern === 'candles') {
			const candleCount = 24;
			const gap = w / candleCount;
			const opens: number[] = [];
			const closes: number[] = [];
			const startPrice = isProfit ? 0.75 : 0.25;
			const endPrice = isProfit ? 0.15 : 0.85;
			for (let i = 0; i < candleCount; i++) {
				const progress = i / (candleCount - 1);
				const target = startPrice + (endPrice - startPrice) * progress;
				const noise = (Math.random() - 0.5) * 0.12;
				const spike = Math.random() < 0.12 ? (Math.random() - 0.5) * 0.15 : 0;
				const open = Math.max(0.05, Math.min(0.95, target + noise + spike));
				const moveSize = 0.03 + Math.random() * 0.08;
				const moveBias = isProfit ? -0.3 : 0.3;
				const move = (Math.random() - 0.5 + moveBias) * moveSize;
				const close = Math.max(0.05, Math.min(0.95, open + move));
				opens.push(open);
				closes.push(close);
			}
			ctx.strokeStyle = accent + '12';
			ctx.lineWidth = 1;
			for (let gy = 0; gy < h; gy += h / 8) {
				ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
			}
			for (let i = 0; i < candleCount; i++) {
				const x = i * gap + gap * 0.15;
				const cw = gap * 0.6;
				const o = opens[i];
				const c = closes[i];
				const up = c < o;
				const hi = Math.min(o, c);
				const lo = Math.max(o, c);
				const wickTop = hi - (0.015 + Math.random() * 0.08);
				const wickBot = lo + (0.015 + Math.random() * 0.08);
				const bodyTop = hi * h * 0.7 + h * 0.1;
				const bodyBot = lo * h * 0.7 + h * 0.1;
				const bodyH = Math.max(4, bodyBot - bodyTop);
				const wTop = wickTop * h * 0.7 + h * 0.1;
				const wBot = wickBot * h * 0.7 + h * 0.1;
				const candleColor = up ? '#22c55e' : '#ef4444';
				ctx.fillStyle = candleColor + '40';
				ctx.fillRect(x, bodyTop, cw, bodyH);
				ctx.fillStyle = candleColor + '25';
				ctx.fillRect(x + cw / 2 - 1, wTop, 2, wBot - wTop);
			}
		} else if (bg.pattern === 'matrix') {
			const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
			ctx.font = '18px monospace';
			const cols = Math.floor(w / 22);
			const drops: number[] = [];
			for (let i = 0; i < cols; i++) drops.push(Math.random() * 40);
			for (let pass = 0; pass < 30; pass++) {
				for (let i = 0; i < cols; i++) {
					const x = i * 22;
					const rows = 3 + Math.floor(Math.random() * 15);
					for (let j = 0; j < rows; j++) {
						const y = (drops[i] + j) * 24;
						if (y > h) continue;
						const fade = 1 - j / rows;
						const alpha = Math.floor(fade * (j === 0 ? 200 : 80));
						ctx.fillStyle = accent + alpha.toString(16).padStart(2, '0');
						ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, y);
					}
					drops[i] += 0.5 + Math.random() * 2;
					if (drops[i] * 24 > h + 200) drops[i] = -Math.random() * 10;
				}
			}
			const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
			glow.addColorStop(0, accent + '08');
			glow.addColorStop(1, 'transparent');
			ctx.fillStyle = glow;
			ctx.fillRect(0, 0, w, h);
		} else if (bg.pattern === 'neon') {
			const purple = '#a855f7';
			const cyan = '#06b6d4';
			const pink = '#ec4899';
			const glow1 = ctx.createRadialGradient(w * 0.15, h * 0.8, 0, w * 0.15, h * 0.8, w * 0.5);
			glow1.addColorStop(0, purple + '35');
			glow1.addColorStop(0.4, purple + '10');
			glow1.addColorStop(1, 'transparent');
			ctx.fillStyle = glow1;
			ctx.fillRect(0, 0, w, h);
			const glow2 = ctx.createRadialGradient(w * 0.85, h * 0.2, 0, w * 0.85, h * 0.2, w * 0.45);
			glow2.addColorStop(0, cyan + '30');
			glow2.addColorStop(0.4, cyan + '0c');
			glow2.addColorStop(1, 'transparent');
			ctx.fillStyle = glow2;
			ctx.fillRect(0, 0, w, h);
			const glow3 = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.3);
			glow3.addColorStop(0, pink + '15');
			glow3.addColorStop(1, 'transparent');
			ctx.fillStyle = glow3;
			ctx.fillRect(0, 0, w, h);
			ctx.save();
			ctx.globalCompositeOperation = 'lighter';
			for (let i = 0; i < 3; i++) {
				const sx = w * 0.1 + i * w * 0.35;
				const sy = h * 0.9;
				const ex = sx + w * 0.15;
				const ey = h * 0.05;
				const col = [purple, cyan, pink][i];
				const grad = ctx.createLinearGradient(sx, sy, ex, ey);
				grad.addColorStop(0, col + '00');
				grad.addColorStop(0.3, col + '30');
				grad.addColorStop(0.6, col + '15');
				grad.addColorStop(1, col + '00');
				ctx.strokeStyle = grad;
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.moveTo(sx, sy);
				const cp1x = sx + (ex - sx) * 0.3 + (Math.random() - 0.5) * 200;
				const cp1y = sy + (ey - sy) * 0.3;
				const cp2x = sx + (ex - sx) * 0.7 + (Math.random() - 0.5) * 200;
				const cp2y = sy + (ey - sy) * 0.7;
				ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
				ctx.stroke();
				ctx.lineWidth = 12;
				ctx.strokeStyle = grad;
				ctx.globalAlpha = 0.15;
				ctx.stroke();
				ctx.globalAlpha = 1;
			}
			ctx.restore();
			for (let i = 0; i < 40; i++) {
				const px = Math.random() * w;
				const py = Math.random() * h;
				const sz = 1 + Math.random() * 3;
				const col = [purple, cyan, pink, '#ffffff'][Math.floor(Math.random() * 4)];
				ctx.fillStyle = col;
				ctx.globalAlpha = 0.2 + Math.random() * 0.5;
				ctx.beginPath();
				ctx.arc(px, py, sz, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
			ctx.strokeStyle = purple + '08';
			ctx.lineWidth = 1;
			for (let x = 0; x < w; x += 80) {
				ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
			}
			for (let y = 0; y < h; y += 80) {
				ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
			}
		} else if (bg.pattern === 'ember') {
			const glow = ctx.createRadialGradient(w * 0.5, h * 0.7, 0, w * 0.5, h * 0.7, w * 0.6);
			glow.addColorStop(0, '#f9731620');
			glow.addColorStop(0.3, '#ef444410');
			glow.addColorStop(1, 'transparent');
			ctx.fillStyle = glow;
			ctx.fillRect(0, 0, w, h);
			for (let i = 0; i < 60; i++) {
				const x = Math.random() * w;
				const y = h - Math.random() * h * 0.8;
				const sz = 2 + Math.random() * 6;
				const alpha = 0.1 + Math.random() * 0.4;
				const colors = ['#ef4444', '#f97316', '#fbbf24', '#fb923c'];
				const color = colors[Math.floor(Math.random() * colors.length)];
				ctx.fillStyle = color;
				ctx.globalAlpha = alpha;
				ctx.beginPath();
				ctx.arc(x, y, sz, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
			for (let i = 0; i < 8; i++) {
				const startX = Math.random() * w;
				const startY = h;
				ctx.strokeStyle = '#ef4444' + '15';
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(startX, startY);
				let cx = startX, cy = startY;
				for (let j = 0; j < 20; j++) {
					cx += (Math.random() - 0.5) * 40;
					cy -= 20 + Math.random() * 30;
					ctx.lineTo(cx, cy);
				}
				ctx.stroke();
			}
			ctx.fillStyle = '#f9731608';
			for (let i = 0; i < 4; i++) {
				ctx.beginPath();
				ctx.arc(w * 0.3 + Math.random() * w * 0.4, h * 0.5 + Math.random() * h * 0.3, 100 + Math.random() * 150, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	function renderCard(t: CompletedTrade, bg: BgOption, bgImg: HTMLImageElement | null) {
		const w = 1920;
		const h = 1080;
		const offscreen = document.createElement('canvas');
		offscreen.width = w;
		offscreen.height = h;
		const ctx = offscreen.getContext('2d');
		if (!ctx) return;

		if (bgImg) {
			const imgRatio = bgImg.width / bgImg.height;
			const canvasRatio = w / h;
			let sw = bgImg.width, sh = bgImg.height, sx = 0, sy = 0;
			if (imgRatio > canvasRatio) {
				sw = bgImg.height * canvasRatio;
				sx = (bgImg.width - sw) / 2;
			} else {
				sh = bgImg.width / canvasRatio;
				sy = (bgImg.height - sh) / 2;
			}
			ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, w, h);
			ctx.fillStyle = 'rgba(0,0,0,0.55)';
			ctx.fillRect(0, 0, w, h);
		} else {
			drawProceduralBg(ctx, w, h, bg);
		}

		const bottomGrad = ctx.createLinearGradient(0, h * 0.4, 0, h);
		bottomGrad.addColorStop(0, 'rgba(0,0,0,0)');
		bottomGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
		ctx.fillStyle = bottomGrad;
		ctx.fillRect(0, 0, w, h);

		const pnlPctVal = t.pnl.pct as number;
		const pnlUsdVal = t.pnl.usd as number;
		const pnlMultVal = t.pnl.multiplier as number;
		const profit = pnlPctVal >= 0;
		const pnlColor = profit ? '#22c55e' : '#ef4444';
		const sign = profit ? '+' : '';
		const pad = 80;
		const font = 'system-ui, -apple-system, sans-serif';

		ctx.fillStyle = '#ffffff';
		ctx.font = `bold 56px ${font}`;
		ctx.textAlign = 'left';
		ctx.fillText(t.tokenSymbol, pad, pad + 56);

		ctx.fillStyle = 'rgba(255,255,255,0.4)';
		ctx.font = `26px ${font}`;
		ctx.fillText(t.tokenName, pad, pad + 96);

		ctx.fillStyle = 'rgba(255,255,255,0.25)';
		ctx.font = `bold 22px ${font}`;
		ctx.fillText(t.chain, pad, pad + 130);

		const pnlPctText = `${sign}${pnlPctVal.toFixed(1)}%`;
		ctx.fillStyle = pnlColor;
		ctx.font = `bold 140px ${font}`;
		ctx.textAlign = 'left';
		ctx.fillText(pnlPctText, pad, h / 2 + 40);

		const pnlUsdText = `${sign}${formatUsd(pnlUsdVal)}`;
		ctx.fillStyle = pnlColor + 'cc';
		ctx.font = `bold 52px ${font}`;
		ctx.fillText(pnlUsdText, pad, h / 2 + 110);

		ctx.fillStyle = 'rgba(255,255,255,0.45)';
		ctx.font = `bold 38px ${font}`;
		ctx.fillText(`${pnlMultVal.toFixed(2)}x`, pad, h / 2 + 165);

		const statsY = h - 200;
		const stats = [
			{ label: 'Bought', value: formatUsd(t.totalBought.usd as number) },
			{ label: 'Sold', value: formatUsd(t.totalSold.usd as number) },
			{ label: 'Entry', value: formatPriceText(t.avgEntryPrice.usd) },
			{ label: 'Exit', value: formatPriceText(t.avgClosingPrice.usd) },
		];

		ctx.fillStyle = 'rgba(0,0,0,0.5)';
		roundRect(ctx, pad - 20, statsY - 65, w - pad * 2 + 40, 185, 16);
		ctx.fill();

		const statW = (w - pad * 2) / stats.length;
		for (let i = 0; i < stats.length; i++) {
			const x = pad + i * statW;
			ctx.fillStyle = 'rgba(255,255,255,0.8)';
			ctx.font = `bold 32px ${font}`;
			ctx.textAlign = 'left';
			ctx.fillText(stats[i].label, x, statsY);
			ctx.fillStyle = '#ffffff';
			ctx.font = `bold 50px ${font}`;
			ctx.fillText(stats[i].value, x, statsY + 65);
		}

		const logoSize = 28;
		const logoX = w - pad - 160;
		const logoY = h - 52;
		ctx.save();
		ctx.beginPath();
		ctx.arc(logoX, logoY, logoSize / 2, 0, Math.PI * 2);
		ctx.arc(logoX + logoSize * 0.3, logoY - logoSize * 0.05, logoSize / 2, 0, Math.PI * 2, true);
		ctx.fillStyle = 'rgba(255,255,255,0.25)';
		ctx.fill('evenodd');
		ctx.restore();
		ctx.fillStyle = 'rgba(255,255,255,0.25)';
		ctx.font = `bold 36px ${font}`;
		ctx.textAlign = 'left';
		ctx.fillText('OMBRA', logoX + logoSize / 2 + 12, logoY + 12);

		previewUrl = offscreen.toDataURL('image/png');
	}

	function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.lineTo(x + w - r, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + r);
		ctx.lineTo(x + w, y + h - r);
		ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
		ctx.lineTo(x + r, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - r);
		ctx.lineTo(x, y + r);
		ctx.quadraticCurveTo(x, y, x + r, y);
		ctx.closePath();
	}

	function downloadCard() {
		if (!previewUrl || !trade) return;
		const a = document.createElement('a');
		a.href = previewUrl;
		a.download = `${trade.tokenSymbol}-pnl.png`;
		a.click();
	}

	let copyLabel = $state('Copy');
	async function copyCard() {
		if (!previewUrl) return;
		try {
			const blob = await (await fetch(previewUrl)).blob();
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			copyLabel = 'Copied!';
			setTimeout(() => { copyLabel = 'Copy'; }, 1500);
		} catch {
			downloadCard();
		}
	}

	async function shareCard() {
		if (!previewUrl || !trade) return;
		if (!navigator.share) { downloadCard(); return; }
		try {
			const blob = await (await fetch(previewUrl)).blob();
			const file = new File([blob], `${trade.tokenSymbol}-pnl.png`, { type: 'image/png' });
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ files: [file], title: `${trade.tokenSymbol} PnL` });
				return;
			}
			const pnlSign = trade.pnl.usd >= 0 ? '+' : '';
			const text = `${trade.tokenSymbol} ${pnlSign}${Number(trade.pnl.pct).toFixed(1)}% PnL`;
			if (navigator.canShare?.({ text })) {
				await navigator.share({ text, title: `${trade.tokenSymbol} PnL` });
				return;
			}
			downloadCard();
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			downloadCard();
		}
	}
</script>

{#if show && trade}
	<div use:portal class="fixed inset-0 z-[250] flex items-center justify-center bg-s0/60 backdrop-blur-[2px]" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }} onkeydown={(e) => { if (e.key === 'Escape') close(); }}>
		<div class="relative mx-4 w-full max-w-2xl rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between border-b border-bd px-5 py-3">
				<h2 class="text-sm font-semibold text-tx">Share PnL</h2>
				<button onclick={close} class="cursor-pointer text-g4 transition-colors hover:text-tx"><X class="h-4 w-4" /></button>
			</div>
			<div class="p-4">
				<div class="mb-3 flex items-center justify-center gap-1.5 flex-wrap">
					{#each bgOptions as bg, i}
						<button
							onclick={() => { selectedBg = i; }}
							class="cursor-pointer rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors {selectedBg === i ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}"
						>{bg.label}</button>
					{/each}
				</div>
				{#if previewUrl}
					<img src={previewUrl} alt="PnL Card" class="mx-auto w-full rounded-xl" />
				{:else}
					<div class="flex h-48 items-center justify-center text-g5">Rendering...</div>
				{/if}
				<div class="mt-4 hidden gap-2 md:flex">
					<button onclick={downloadCard} class="btn-secondary flex-1 py-2.5 text-sm">Download</button>
					<button onclick={copyCard} class="btn-primary flex-1 py-2.5 text-sm">{copyLabel}</button>
				</div>
				<div class="mt-4 flex gap-2 md:hidden">
					<button onclick={downloadCard} class="btn-secondary flex-1 py-2.5 text-sm">Download</button>
					<button onclick={shareCard} class="btn-primary flex-1 py-2.5 text-sm">Share</button>
				</div>
			</div>
		</div>
	</div>
{/if}
