<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onDestroy } from 'svelte';
	import { onVisibility, FLASH_MS, FLASH_COOLDOWN_MS, ROW_FLASH_MS } from '$lib/utils/visibility';
	import type { ScannerItem } from '$lib/api/types';
	import { formatMarketCap, formatPercent, formatNumber, formatCompactNumber, formatCompactCount, liveAge } from '$lib/utils/format';
	import { feeShareholders, feeShareTitle } from '$lib/utils/fee-sharing';
	import { buildSparkline } from '$lib/utils/sparkline';
	import { getRouterInfo, getRouterIconForChain } from '$lib/utils/routers';
	import { getNow } from '$lib/stores/tick.svelte';
	import { siX, siTelegram, siDiscord, siInstagram } from 'simple-icons';
	import DexPaidIcon from './DexPaidIcon.svelte';
	import Globe from 'lucide-svelte/icons/globe';
	import Flame from 'lucide-svelte/icons/flame';
	import Trophy from 'lucide-svelte/icons/trophy';
	import Coins from 'lucide-svelte/icons/coins';
	import Users from 'lucide-svelte/icons/users';
	import ChefHat from 'lucide-svelte/icons/chef-hat';
	import ChartPie from 'lucide-svelte/icons/chart-pie';
	import BadgeCheck from 'lucide-svelte/icons/badge-check';
	import Megaphone from 'lucide-svelte/icons/megaphone';
	import MessageSquareQuote from 'lucide-svelte/icons/message-square-quote';
	import MessagesSquare from 'lucide-svelte/icons/messages-square';
	import Repeat2 from 'lucide-svelte/icons/repeat-2';
	import SniperIcon from './SniperIcon.svelte';
	import BundlerIcon from './BundlerIcon.svelte';
	import InsiderIcon from './InsiderIcon.svelte';
	import type { RowFlashType } from '$lib/utils/scanner-ws';
	import { openSafeUrl, safeUrl } from '$lib/safeUrl';

	let { token, phase = 'new', live = false }: { token: ScannerItem; phase?: 'new' | 'graduating' | 'graduated'; live?: boolean } = $props();

	function percentColor(value: string | number | undefined | null): string {
		if (value === undefined || value === null) return 'text-g6';
		const num = typeof value === 'string' ? parseFloat(value) : value;
		if (isNaN(num)) return 'text-g6';
		return num > 0 ? 'text-grn' : num < 0 ? 'text-red' : 'text-g6';
	}

	/**
	 * The row/card is one big <a>, so a click on a social icon would still trigger
	 * the anchor's DEFAULT navigation — the icon's own handler cannot be relied on
	 * to cancel it (nothing calls preventDefault when `onselect` is absent, as on
	 * the scanner). Cancel it here in the CAPTURE phase, before the target runs, so
	 * the icon still opens its link but the row never navigates.
	 */
	function guardSocialClick(e: MouseEvent) {
		if ((e.target as HTMLElement | null)?.closest('[data-social]')) e.preventDefault();
	}

	function openSocial(e: MouseEvent, url: string | null | undefined) {
		e.preventDefault();
		e.stopPropagation();
		openSafeUrl(url);
	}

	const createdMs = $derived(token.createdAtTimestampStr ? Date.parse(token.createdAtTimestampStr) : NaN);

	let prev: Record<string, string> = {};
	let prevNum: Record<string, number> = {};
	let flashes: Record<string, 'up' | 'down'> = $state({});
	let timers: Record<string, ReturnType<typeof setTimeout>> = {};

	// Row flash is detected here rather than handed down from the page: a shared
	// flash map made every card in the column re-render on every WS frame.
	let rowFlash = $state<RowFlashType | null>(null);
	let rowFlashTimer: ReturnType<typeof setTimeout> | null = null;
	let prevRowKey: string | null = null;

	let lastRowFlashAt = 0;
	function triggerRowFlash(kind: RowFlashType) {
		if (!onScreen) return;
		const now = performance.now();
		if (now - lastRowFlashAt < FLASH_COOLDOWN_MS) return;
		lastRowFlashAt = now;
		rowFlash = kind;
		if (rowFlashTimer) clearTimeout(rowFlashTimer);
		rowFlashTimer = setTimeout(() => { rowFlash = null; rowFlashTimer = null; }, ROW_FLASH_MS);
	}

	onDestroy(() => {
		for (const key in timers) clearTimeout(timers[key]);
		if (rowFlashTimer) clearTimeout(rowFlashTimer);
	});

	// Offscreen cards skip flashing entirely, and a value that keeps churning
	// re-arms at most once per FLASH_COOLDOWN_MS instead of restarting the
	// animation on every frame.
	let onScreen = $state(true);
	let lastFlashAt: Record<string, number> = {};

	function flash(key: string, oldNum: number, newNum: number) {
		if (!onScreen) return;
		const now = performance.now();
		if (now - (lastFlashAt[key] ?? 0) < FLASH_COOLDOWN_MS) return;
		lastFlashAt[key] = now;
		const dir = newNum > oldNum ? 'up' : 'down';
		flashes = { ...flashes, [key]: dir };
		clearTimeout(timers[key]);
		timers[key] = setTimeout(() => {
			const { [key]: _, ...rest } = flashes;
			flashes = rest;
		}, FLASH_MS);
	}

	function fc(key: string): string {
		const f = flashes[key];
		if (!f) return '';
		return f === 'up' ? 'flash-up' : 'flash-down';
	}

	$effect(() => {
		const entries: [string, string | undefined | null, (v: any) => string][] = [
			['mcap', token.quote.marketCapUsdStr, formatMarketCap],
			['liq', token.quote.liquidityUsdStr, formatMarketCap],
			['pct', String(token.stats.timeframes['5m'].priceChangePct), formatPercent],
		];
		for (const [key, raw, fmt] of entries) {
			const num = parseFloat(raw ?? '');
			const display = fmt(raw);
			if (!isNaN(num) && prev[key] !== undefined && display !== prev[key]) {
				flash(key, prevNum[key], num);
			}
			if (!isNaN(num)) {
				prev[key] = display;
				prevNum[key] = num;
			}
		}

		const q = token.quote;
		const rowKey = `${q.priceUsd}|${q.marketCapUsd}|${q.liquidityUsd}`;
		if (prevRowKey === null) {
			prevRowKey = rowKey;
			if (live) triggerRowFlash('new');
		} else if (rowKey !== prevRowKey) {
			prevRowKey = rowKey;
			triggerRowFlash('update');
		}
	});

	let displayRouter = $derived(getRouterInfo(token.platformType ?? ''));
	let routerIconUrl = $derived(token.platformType ? getRouterIconForChain(token.platformType, token.chain) : '');

	let gradPercent = $derived.by(() => {
		if (!token.launchPad?.bondingCurve) return null;
		return token.launchPad.bondingCurve.progressPct ?? 0;
	});

	let isGraduated = $derived(token.launchPad?.bondingCurve?.state === 'Migrated');
	let migratedFromIcon = $derived.by(() => {
		const bc = token.launchPad?.bondingCurve;
		if (bc?.state !== 'Migrated' || !bc.migratedFromPlatformType) return '';
		return getRouterIconForChain(bc.migratedFromPlatformType, token.chain);
	});
	// Flatten the new nested social links to URL strings.
	let soc = $derived.by(() => {
		const l = token.socials?.links;
		return {
			website: safeUrl(l?.website),
			twitter: safeUrl(l?.twitter?.url),
			telegram: safeUrl(l?.telegram),
			discord: safeUrl(l?.discord),
			instagram: safeUrl(l?.instagram)
		};
	});
	let hasSocials = $derived(!!(soc.website || soc.twitter || soc.telegram || soc.discord || soc.instagram));

	let pumpfun = $derived(token.launchPad?.pumpfun ?? null);
	let isMayhem = $derived(pumpfun?.isMayhem ?? false);
	let isHolderReward = $derived(pumpfun?.isHolderReward ?? false);
	let cashbackPct = $derived(pumpfun?.cashbackPct ?? 0);
	let feeShares = $derived(feeShareholders(pumpfun));

	let act5m = $derived(token.stats.timeframes['5m']);
	let act1h = $derived(token.stats.timeframes['1h']);
	let act6h = $derived(token.stats.timeframes['6h']);
	let act24h = $derived(token.stats.timeframes['24h']);
	let vol24h = $derived(act24h?.volume ?? 0);
	let sec = $derived(token.audit);
	let h = $derived(token.holders);
	// A price-only WS update hands us a fresh token object (and a fresh sparkline
	// array) even when the series itself is unchanged, so rebuilding the path on
	// every frame is wasted work. Reuse the last result unless the series moved.
	let sparkMemo: { sig: string; val: ReturnType<typeof buildSparkline> } | null = null;
	let spark = $derived.by(() => {
		const pts = token.sparkline;
		const n = pts?.length ?? 0;
		const sig = n === 0 ? '0' : `${n}:${pts![0].value}:${pts![n - 1].value}`;
		if (sparkMemo && sparkMemo.sig === sig) return sparkMemo.val;
		const val = buildSparkline(pts, 240, 80, `ms-${token.pairAddress.slice(0, 10)}`);
		sparkMemo = { sig, val };
		return val;
	});
	let tweets = $derived(token.tweets ?? 0);
	let twFollowers = $derived(token.socials?.profile?.followersCount ?? 0);
	let twVerified = $derived(!!token.socials?.profile?.isBlueVerified);
	let communityN = $derived(token.socials?.community?.memberCount ?? 0);
	let serialLaunches = $derived(token.socials?.dev?.twitterCreateTokenCount ?? 0);
	let isAgent = $derived(!!pumpfun?.isAgent);
	let calls = $derived(token.calls ?? 0);
	let theses = $derived(token.theses ?? 0);
	const socialBtn =
		'flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md bg-s6 text-g11 ring-1 ring-bd hover:bg-s7 hover:text-wh';
	const statChip = 'flex shrink-0 items-center gap-0.5 text-[11px] font-semibold tabular-nums';
</script>

<a
	href="/?chain={token.chain}&token={token.tokenAddress}"
	use:onVisibility={(v) => (onScreen = v)}
	onclickcapture={guardSocialClick}
	class="glass-hover-card @container group relative block h-[152px] overflow-hidden rounded-xl border border-bd bg-s1 transition-colors duration-200 hover:border-bd3 hover:bg-wh/5 [contain:layout_paint_style] {rowFlash ? `card-flash-${rowFlash}` : ''}"
>
	{#if spark}
		<svg
			viewBox="0 0 {spark.w} {spark.h}"
			class="pointer-events-none absolute inset-y-0 right-0 z-0 h-full w-[46%]"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<!-- The left-edge fade used to be an SVG <mask>, which forces an offscreen
			     surface per card (~150 of them). Folding the fade into the gradients
			     keeps the look and lets the whole card paint in one pass. -->
			<defs>
				<linearGradient id="{spark.gradId}-fill" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stop-color={spark.color} stop-opacity="0" />
					<stop offset="45%" stop-color={spark.color} stop-opacity="0.10" />
					<stop offset="100%" stop-color={spark.color} stop-opacity="0.24" />
				</linearGradient>
				<linearGradient id="{spark.gradId}-line" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0%" stop-color={spark.color} stop-opacity="0" />
					<stop offset="22%" stop-color={spark.color} stop-opacity="0.08" />
					<stop offset="55%" stop-color={spark.color} stop-opacity="0.55" />
					<stop offset="100%" stop-color={spark.color} stop-opacity="1" />
				</linearGradient>
			</defs>
			<path d={spark.fillD} fill="url(#{spark.gradId}-fill)" />
			<path
				d={spark.d}
				fill="none"
				stroke="url(#{spark.gradId}-line)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			/>
		</svg>
	{/if}

	<div class="absolute right-2 top-2 z-10 flex items-center gap-0.5 @min-[360px]:right-2.5">
		<span
			class="inline-flex items-center gap-0.5 rounded bg-s6 px-1 py-px text-[9px] font-bold tabular-nums ring-1 ring-bd {percentColor(act5m?.priceChangePct)} {fc('pct')}"
			title="5m change"
		>
			<span class="text-g5">5m</span>
			{formatPercent(act5m?.priceChangePct)}
		</span>
		<span
			class="inline-flex items-center gap-0.5 rounded bg-s6 px-1 py-px text-[9px] font-bold tabular-nums ring-1 ring-bd {percentColor(act1h?.priceChangePct)}"
			title="1h change"
		>
			<span class="text-g5">1h</span>
			{formatPercent(act1h?.priceChangePct)}
		</span>
	</div>

	<div class="relative z-10 flex h-[96px] flex-col justify-between px-2.5 pt-2.5 pb-1 @min-[360px]:px-3">
		<div class="flex items-start gap-2">
			<div
				class="relative h-11 w-11 shrink-0 rounded-xl p-[2px]"
				style={isGraduated
					? 'background: var(--t-yel)'
					: gradPercent !== null && gradPercent > 0
						? `background: conic-gradient(var(--t-grn) ${gradPercent * 3.6}deg, var(--t-bd2) ${gradPercent * 3.6}deg)`
						: 'background: var(--t-s5)'}
			>
				{#if token.tokenAddress}
					<img src={tokenImage(token.chain, token.tokenAddress)} alt="" class="h-full w-full rounded-[10px] object-cover" />
				{:else}
					<div class="flex h-full w-full items-center justify-center rounded-[10px] bg-s7">
						<span class="text-sm font-bold text-g6">{token.tokenSymbol?.[0] ?? '?'}</span>
					</div>
				{/if}
				<span class="absolute -right-0.5 -top-0.5 inline-flex items-center" title={token.chain}>
					<img src="/icons/{token.chain?.toLowerCase()}.png" alt={token.chain} class="h-3.5 w-3.5 rounded-full ring-1 ring-s6" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
					{#if routerIconUrl}
						<img src={routerIconUrl} alt={displayRouter.name} title={displayRouter.name} class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" />
					{/if}
					{#if migratedFromIcon}
						<img src={migratedFromIcon} alt="Migrated from" class="absolute -top-1 left-0 h-2.5 w-2.5 rounded-full bg-s6 ring-1 ring-s6" title="Migrated from {(token.launchPad?.bondingCurve as any)?.migratedFromPlatformName ?? ''}" />
					{/if}
				</span>
				<span class="absolute -bottom-1 -left-0.5 rounded-md bg-s6 px-1 py-0.5 text-[9px] font-bold leading-none text-g9 ring-1 ring-bd">{liveAge(createdMs, getNow())}</span>
				{#if isGraduated}
					<span class="absolute -bottom-1 -right-1 rounded bg-s6 px-0.5 py-px text-[7px] font-bold text-yel ring-1 ring-yel/40">GRAD</span>
				{:else if gradPercent !== null && gradPercent > 0}
					<span class="absolute -bottom-1 -right-1 rounded bg-s6 px-0.5 py-px text-[7px] font-bold text-grn ring-1 ring-bd">{gradPercent.toFixed(0)}%</span>
				{/if}
			</div>

			<div class="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
				<div class="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap pr-[42%]">
					<span class="min-w-0 max-w-[55%] shrink truncate text-sm font-bold text-tx" title={token.tokenSymbol ?? ''}>{token.tokenSymbol}</span>
					{#if token.quoteTokenSymbol}<span class="shrink-0 text-[10px] text-g5">/{token.quoteTokenSymbol}</span>{/if}
					<span class="min-w-0 flex-1 truncate text-xs text-g8">{token.tokenName}</span>
					{#if isAgent}
						<span class="shrink-0 rounded bg-blu/20 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-blu">Agent</span>
					{/if}
				</div>

				<div class="flex h-4 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap pr-[42%]">
					{#if sec}
						<span class="flex shrink-0 items-center gap-0.5" title="Mint {!sec.mintable ? 'disabled' : 'enabled'}">
							<span class="inline-block h-1.5 w-1.5 rounded-full {!sec.mintable ? 'bg-grn' : 'bg-red'}"></span>
							<span class="text-[9px] font-medium {!sec.mintable ? 'text-g8' : 'text-red'}">Mint</span>
						</span>
						<span class="flex shrink-0 items-center gap-0.5" title="Freeze {!sec.freezable ? 'disabled' : 'enabled'}">
							<span class="inline-block h-1.5 w-1.5 rounded-full {!sec.freezable ? 'bg-grn' : 'bg-red'}"></span>
							<span class="text-[9px] font-medium {!sec.freezable ? 'text-g8' : 'text-red'}">Frz</span>
						</span>
						<span class="flex shrink-0 items-center gap-0.5" title={sec.honeypot ? 'Honeypot detected' : 'Not honeypot'}>
							<span class="inline-block h-1.5 w-1.5 rounded-full {sec.honeypot ? 'bg-red' : 'bg-grn'}"></span>
							<span class="text-[9px] font-medium {sec.honeypot ? 'text-red' : 'text-g8'}">HP</span>
						</span>
						{#if sec.renounced}<span class="shrink-0 text-[9px] font-bold text-grn">R</span>{/if}
						{#if sec.lpLocked}<span class="shrink-0 text-[9px] font-bold text-grn">LP</span>{/if}
						{#if sec.taxBuy || sec.taxSell}
							<span class="hidden shrink-0 text-[9px] text-yel @min-[360px]:inline">
								{#if sec.taxBuy}B{sec.taxBuy.toFixed(0)}{/if}{#if sec.taxSell} S{sec.taxSell.toFixed(0)}{/if}
							</span>
						{/if}
					{/if}
					{#if token.audit?.dexScreenerPaid}
						<DexPaidIcon class="h-3 w-3 shrink-0 text-yel" />
					{/if}
					{#if isMayhem}
						<span class="shrink-0 text-org" title="Mayhem"><Flame class="h-3 w-3" /></span>
					{/if}
					{#if isHolderReward}
						<span class="shrink-0 text-pnk" title="Holder rewards"><Trophy class="h-3 w-3" /></span>
					{/if}
					{#if cashbackPct > 0}
						<span class="shrink-0 text-grn" title="Cashback {cashbackPct}%"><Coins class="h-3 w-3" /></span>
					{/if}
					{#if feeShares.length > 0}
						<span class="shrink-0 text-blu" title={feeShareTitle(feeShares)}><Users class="h-3 w-3" /></span>
					{/if}
					{#if (token.holders?.snipers ?? 0) > 0}
						<span class="flex shrink-0 items-center gap-0.5 font-semibold text-red"><SniperIcon class="h-3 w-3" /><span class="text-[10px]">{token.holders?.snipers}</span></span>
					{/if}
					{#if (token.holders?.bundlers ?? 0) > 0}
						<span class="flex shrink-0 items-center gap-0.5 font-semibold text-yel"><BundlerIcon class="h-3 w-3" /><span class="text-[10px]">{token.holders?.bundlers}</span></span>
					{/if}
					{#if (token.holders?.insiders ?? 0) > 0}
						<span class="flex shrink-0 items-center gap-0.5 font-semibold text-org"><InsiderIcon class="h-3 w-3" /><span class="text-[10px]">{token.holders?.insiders}</span></span>
					{/if}
				</div>
			</div>
		</div>

		<div class="flex min-w-0 items-center gap-x-2.5 overflow-hidden whitespace-nowrap tabular-nums">
			<div class="shrink-0 {fc('mcap')}">
				<span class="text-[9px] font-medium text-g6">MC</span>
				<span class="ml-0.5 text-[13px] font-bold text-tx">{formatMarketCap(token.quote.marketCapUsdStr)}</span>
			</div>
			<div class="shrink-0 {fc('liq')}">
				<span class="text-[9px] font-medium text-g6">Liq</span>
				<span class="ml-0.5 text-[11px] font-semibold text-g10">{formatMarketCap(token.quote.liquidityUsdStr)}</span>
			</div>
			<div class="shrink-0">
				<span class="text-[9px] font-medium text-g6">V</span>
				<span class="ml-0.5 text-[11px] font-semibold text-g10">{formatMarketCap(vol24h)}</span>
			</div>
		</div>
	</div>

	<div class="relative z-10 flex h-7 items-center gap-1.5 overflow-hidden whitespace-nowrap border-t border-bd/40 px-2.5 text-[11px] @min-[360px]:px-3">
		{#if h}
			<span class="{statChip} text-g9" title="Holders">
				<Users class="h-3 w-3" strokeWidth={2.25} />
				{formatNumber(h.holderCount ?? 0)}
			</span>
			{#if h.devPct}
				<span class="{statChip} {h.devPct > 10 ? 'text-red' : h.devPct > 5 ? 'text-yel' : 'text-g9'}" title="Dev holdings">
					<ChefHat class="h-3 w-3" strokeWidth={2.25} />
					{h.devPct.toFixed(0)}%
				</span>
			{/if}
			{#if h.top10Pct}
				<span class="{statChip} {h.top10Pct > 50 ? 'text-red' : h.top10Pct > 30 ? 'text-yel' : 'text-g9'}" title="Top 10 holdings">
					<ChartPie class="h-3 w-3" strokeWidth={2.25} />
					{h.top10Pct.toFixed(0)}%
				</span>
			{/if}
		{/if}
		{#if calls > 0}
			<span class="{statChip} rounded bg-yel/10 px-1 text-yel" title="Calls">
				<Megaphone class="h-3 w-3" strokeWidth={2.25} />
				{formatCompactCount(calls)}
			</span>
		{/if}
		{#if theses > 0}
			<span class="{statChip} text-g9" title="Theses posted about this token">
				<MessageSquareQuote class="h-3 w-3" strokeWidth={2.25} />
				{formatCompactCount(theses)}
			</span>
		{/if}
		{#if tweets > 0}
			<span class="{statChip} rounded bg-wh/10 px-1 text-tx" title="X posts naming this token">
				<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg>
				{formatCompactCount(tweets)}
			</span>
		{/if}
		{#if twFollowers > 0}
			<span class="{statChip} hidden text-g9 @min-[280px]:flex" title="X followers">
				<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg>
				{formatCompactCount(twFollowers)}
				{#if twVerified}<BadgeCheck class="h-3 w-3 text-blu" strokeWidth={2.25} />{/if}
			</span>
		{/if}
		{#if communityN > 0}
			<span class="{statChip} hidden text-g9 @min-[340px]:flex" title="X community">
				<MessagesSquare class="h-3 w-3" strokeWidth={2.25} />
				{formatCompactCount(communityN)}
			</span>
		{/if}
		{#if serialLaunches > 1}
			<span class="{statChip} hidden text-yel @min-[320px]:flex" title="Tokens launched by this Twitter">
				<Repeat2 class="h-3 w-3" strokeWidth={2.25} />
				{serialLaunches}
			</span>
		{/if}
	</div>

	<div class="relative z-10 flex h-7 items-center gap-1 overflow-hidden whitespace-nowrap px-2.5 pb-1 @min-[360px]:px-3">
		{#each [
			{ label: '5m', row: act5m },
			{ label: '1h', row: act1h },
			{ label: '6h', row: act6h },
			{ label: '24h', row: act24h }
		] as tf}
			<span
				class="inline-flex items-center gap-0.5 rounded bg-s6 px-1 py-px text-[9px] font-bold tabular-nums ring-1 ring-bd"
				title="{tf.row?.traders ?? 0} traders"
			>
				<span class="text-g5">{tf.label}</span>
				<span class="text-grn">{tf.row?.buys ?? 0}</span><span class="text-g4">/</span><span class="text-red">{tf.row?.sells ?? 0}</span>
			</span>
		{/each}
		{#if hasSocials}
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{#if soc.twitter}
					<button data-social onclick={(e) => openSocial(e, soc.twitter)} class={socialBtn} title="Twitter">
						<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siX.path}/></svg>
					</button>
				{/if}
				{#if soc.website}
					<button data-social onclick={(e) => openSocial(e, soc.website)} class={socialBtn} title="Website">
						<Globe class="h-3 w-3" strokeWidth={2.25} />
					</button>
				{/if}
				{#if soc.telegram}
					<button data-social onclick={(e) => openSocial(e, soc.telegram)} class={socialBtn} title="Telegram">
						<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siTelegram.path}/></svg>
					</button>
				{/if}
				{#if soc.discord}
					<button data-social onclick={(e) => openSocial(e, soc.discord)} class={socialBtn} title="Discord">
						<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siDiscord.path}/></svg>
					</button>
				{/if}
				{#if soc.instagram}
					<button data-social onclick={(e) => openSocial(e, soc.instagram)} class={socialBtn} title="Instagram">
						<svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d={siInstagram.path}/></svg>
					</button>
				{/if}
			</div>
		{/if}
	</div>
</a>
