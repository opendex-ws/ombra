<script lang="ts">
	import { tokenImage } from '$lib/api/config';
	import { onMount, onDestroy, untrack } from 'svelte';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import LoaderCircle from 'lucide-svelte/icons/loader-circle';
	import Users from 'lucide-svelte/icons/users';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Search from 'lucide-svelte/icons/search';
	import Plus from 'lucide-svelte/icons/plus';
	import Check from 'lucide-svelte/icons/check';
	import PictureInPicture2 from 'lucide-svelte/icons/picture-in-picture-2';
	import Minimize2 from 'lucide-svelte/icons/minimize-2';
	import Filter from 'lucide-svelte/icons/funnel';
	import { portal } from '$lib/actions/portal';
	import { siX } from 'simple-icons';
	import { api } from '$lib/api/client';
	import { subscribe, unsubscribe } from '$lib/ws/client';
	import { createCoalescer } from '$lib/utils/coalesce';
	import { timeAgo, fullDateTime, formatMarketCap, formatCompactNumber } from '$lib/utils/format';
	import { getNow } from '$lib/stores/tick.svelte';
	import { getIsLoggedIn } from '$lib/stores/auth.svelte';
	import { getTwitterFeedCollapsed, toggleTwitterFeedCollapsed, getTwitterFeedHeightPct, setTwitterFeedHeightPct, getTwitterFeedPopout, setTwitterFeedPopout, getTwitterFeedFloat, setTwitterFeedFloatPos, setTwitterFeedFloatSize } from '$lib/stores/feSettings.svelte';
	import { getPanelZ, bringToFront } from '$lib/stores/floatingPanels.svelte';
	import type { components } from '$lib/api/v2.d.ts';

	type TwitterEvent = components['schemas']['TwitterEvent'];
	type TwitterAuthor = components['schemas']['TwitterAuthor'];
	type TwitterAction = components['schemas']['TwitterAction'];

	function actionStr(a: TwitterAction | undefined): string {
		return a ?? '';
	}

	function mediaTypeStr(t: components['schemas']['TwitterMediaType'] | undefined): string {
		return t ?? '';
	}

	let {
		mobile = false,
		active = true,
		compact = false,
		initialSearch = '',
		initialSearchMode = 'KEYWORD'
	}: {
		mobile?: boolean;
		active?: boolean;
		/** Embedded mode: plain in-column panel, no popout/collapse/resize chrome. */
		compact?: boolean;
		/** Pre-fill the keyword search (e.g. a host component pins a topic). */
		initialSearch?: string;
		initialSearchMode?: 'BOTH' | 'TOKEN' | 'KEYWORD';
	} = $props();
	const MAX_EVENTS = 500;
	const MAX_LOADED_EVENTS = 2000;

	let events = $state<TwitterEvent[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let nextCursor = $state<string | undefined>(undefined);
	let onlyCa = $state(false);
	let feedMode = $state<'all' | 'mine'>('all');
	let view = $state<'feed' | 'manage'>('feed');
	let wsKey: string | null = null;
	const seen = new Set<string>();

	const eventCoalescer = createCoalescer<TwitterEvent>((batch) => {
		events = [...batch.reverse(), ...events].slice(0, MAX_EVENTS);
		pruneSeen();
	}, { maxBatch: 200 });

	// `seen` is an O(1) pre-filter for the WS handler; without pruning it would
	// accumulate a key for every event ever seen. Re-derive it from the capped
	// `events` list (≤ MAX_EVENTS) after each flush so it stays bounded.
	function pruneSeen() {
		if (seen.size <= events.length + MAX_EVENTS) return;
		seen.clear();
		for (const e of events) seen.add(dedupeKey(e));
	}

	let subscribedHandles = $state<Set<string>>(new Set());
	let authors = $state<TwitterAuthor[]>([]);
	let authorsLoading = $state(false);
	let authorsLoadingMore = $state(false);
	let authorsCursor = $state<string | undefined>(undefined);
	let authorSearch = $state('');
	let authorSearchDebounce: ReturnType<typeof setTimeout> | null = null;
	let mutatingIds = $state<Set<number>>(new Set());
	let manageTab = $state<'browse' | 'following'>('browse');

	function dedupeKey(e: TwitterEvent): string {
		return `${actionStr(e.action)}:${e.tweetId ?? `${e.timestamp}:${e.author?.handle}`}`;
	}

	const ACTION_FILTERS: { label: string; key: string }[] = [
		{ label: 'Tweet', key: 'tweet' },
		{ label: 'Retweet', key: 'repost' },
		{ label: 'Quote', key: 'quote' },
		{ label: 'Reply', key: 'reply' },
		{ label: 'Deleted Tweet', key: 'delete_post' },
		{ label: 'Pin', key: 'pin' },
		{ label: 'Unpin', key: 'unpin' },
		{ label: 'Follow', key: 'follow' },
		{ label: 'Unfollow', key: 'unfollow' },
		{ label: 'Upd. Banner', key: 'banner' },
		{ label: 'Upd. Photo', key: 'photo' },
		{ label: 'Upd. Nickname', key: 'name' },
		{ label: 'Upd. Handle', key: 'handle' },
		{ label: 'Upd. Bio', key: 'description' }
	];

	const TAG_FILTERS: { label: string; key: string }[] = [
		{ label: 'KOL', key: 'kol' },
		{ label: 'Trader', key: 'trader' },
		{ label: 'Master', key: 'master' },
		{ label: 'Politics', key: 'politics' },
		{ label: 'Media', key: 'media' },
		{ label: 'Companies', key: 'companies' },
		{ label: 'Founders', key: 'founder' },
		{ label: 'Exchanges', key: 'exchange' },
		{ label: 'Celebrity', key: 'celebrity' },
		{ label: 'Binance Square', key: 'binance_square' },
		{ label: 'Ins', key: 'instagram' },
		{ label: 'Exchange Listing', key: 'exchange_listing' },
		{ label: 'Others', key: 'other' }
	];

	let showTypeFilter = $state(false);
	let selectedActions = $state<Set<string>>(new Set());
	let selectedTags = $state<Set<string>>(new Set());
	let minFollowers = $state('');
	// One-time seed of the search from props; the reactive $effect below owns
	// subsequent updates when the host changes `initialSearch`.
	// svelte-ignore state_referenced_locally
	let showSearch = $state(!!initialSearch);
	// svelte-ignore state_referenced_locally
	let searchText = $state(initialSearch);
	// svelte-ignore state_referenced_locally
	let searchMode = $state<'BOTH' | 'TOKEN' | 'KEYWORD'>(initialSearch ? initialSearchMode : 'BOTH');
	let filterDebounce: ReturnType<typeof setTimeout> | null = null;

	const minFollowersNum = $derived.by(() => {
		const n = parseInt(minFollowers, 10);
		return isFinite(n) && n > 0 ? n : 0;
	});
	const typeFilterCount = $derived((selectedActions.size > 0 ? 1 : 0) + (selectedTags.size > 0 ? 1 : 0) + (minFollowersNum > 0 ? 1 : 0));

	function applyTypeFilters() {
		if (filterDebounce) clearTimeout(filterDebounce);
		filterDebounce = setTimeout(() => {
			loadInitial();
			setupWs();
		}, 300);
	}

	function toggleActionFilter(key: string) {
		const next = new Set(selectedActions);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedActions = next;
		applyTypeFilters();
	}

	function toggleTagFilter(key: string) {
		const next = new Set(selectedTags);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedTags = next;
		applyTypeFilters();
	}

	function clearActionFilters() {
		if (selectedActions.size === 0) return;
		selectedActions = new Set();
		applyTypeFilters();
	}

	function clearAllTypeFilters() {
		selectedActions = new Set();
		selectedTags = new Set();
		minFollowers = '';
		applyTypeFilters();
	}

	const visibleEvents = $derived.by(() => {
		const out: TwitterEvent[] = [];
		const keys = new Set<string>();
		for (const e of events) {
			const k = dedupeKey(e);
			if (keys.has(k)) continue;
			keys.add(k);
			out.push(e);
		}
		return out;
	});

	async function fetchPage(cursor?: string) {
		const query: Record<string, unknown> = {};
		if (cursor) query.cursor = cursor;
		if (onlyCa) query.onlyCa = true;
		if (selectedActions.size > 0) query.actions = [...selectedActions].map(a => a.toUpperCase()).sort().join(',');
		if (selectedTags.size > 0) query.tags = [...selectedTags].sort().join(',');
		if (minFollowersNum > 0) query.minFollowers = minFollowersNum;
		if (searchText.trim()) {
			query.search = searchText.trim();
			if (searchMode !== 'BOTH') query.searchMode = searchMode;
		}
		const path = feedMode === 'mine' ? '/v2/twitter/feed' : '/v2/twitter/events';
		const { data } = await api.GET(path as '/v2/twitter/events', { params: { query } } as never);
		return data as components['schemas']['TwitterEventsResponse'] | undefined;
	}

	async function loadInitial() {
		loading = true;
		try {
			const data = await fetchPage();
			const incoming = data?.events ?? [];
			seen.clear();
			for (const e of incoming) seen.add(dedupeKey(e));
			events = incoming;
			nextCursor = data?.nextCursor ?? undefined;
			autoFillFeed();
		} catch {
			events = [];
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore || !nextCursor) return;
		loadingMore = true;
		try {
			const data = await fetchPage(nextCursor);
			const incoming = (data?.events ?? []).filter(e => !seen.has(dedupeKey(e)));
			for (const e of incoming) seen.add(dedupeKey(e));
			events = [...events, ...incoming].slice(0, MAX_LOADED_EVENTS);
			nextCursor = events.length < MAX_LOADED_EVENTS ? (data?.nextCursor ?? undefined) : undefined;
			pruneSeen();
			autoFillFeed();
		} catch {} finally {
			loadingMore = false;
		}
	}

	let feedScrollEl = $state<HTMLDivElement | null>(null);
	let authorsScrollEl = $state<HTMLDivElement | null>(null);

	function handleFeedScroll(e: Event) {
		if (loadingMore || !nextCursor) return;
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMore();
	}

	function autoFillFeed() {
		if (!nextCursor) return;
		requestAnimationFrame(() => {
			const el = feedScrollEl;
			if (el && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight) loadMore();
		});
	}

	function handleAuthorsScroll(e: Event) {
		if (authorsLoadingMore || !authorsCursor) return;
		const el = e.currentTarget as HTMLElement;
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMoreAuthors();
	}

	function autoFillAuthors() {
		if (!authorsCursor) return;
		requestAnimationFrame(() => {
			const el = authorsScrollEl;
			if (el && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight) loadMoreAuthors();
		});
	}

	function setMode(mode: 'all' | 'mine') {
		if (feedMode === mode) return;
		feedMode = mode;
		loadInitial();
		setupWs();
	}

	function setOnlyCa(value: boolean) {
		if (onlyCa === value) return;
		onlyCa = value;
		loadInitial();
		setupWs();
	}

	let firstAck = true;

	async function backfillGap() {
		if (firstAck) {
			firstAck = false;
			return;
		}
		try {
			const data = await fetchPage();
			const incoming = (data?.events ?? []).filter(e => !seen.has(dedupeKey(e)));
			if (incoming.length > 0) {
				for (const e of incoming) seen.add(dedupeKey(e));
				events = [...incoming, ...events].slice(0, MAX_EVENTS);
			}
		} catch {}
	}

	function setupWs() {
		if (wsKey) {
			unsubscribe(wsKey);
			wsKey = null;
		}
		if (!active) return;
		eventCoalescer.clear();
		firstAck = true;
		const topic = feedMode === 'mine' ? 'twitter:personal' : 'twitter:feed';
		const params: Record<string, unknown> = {};
		if (onlyCa) params.onlyCa = true;
		if (selectedActions.size > 0) params.actions = [...selectedActions].map(a => a.toUpperCase()).sort();
		if (selectedTags.size > 0) params.tags = [...selectedTags].sort();
		if (minFollowersNum > 0) params.minFollowers = minFollowersNum;
		if (searchText.trim()) {
			params.search = searchText.trim();
			if (searchMode !== 'BOTH') params.searchMode = searchMode;
		}
		wsKey = subscribe(topic, (event, data) => {
			if (event !== 'TWITTER_EVENT' || !data) return;
			const e = data as TwitterEvent;
			const key = dedupeKey(e);
			if (seen.has(key)) return;
			seen.add(key);
			eventCoalescer.push(e);
		}, Object.keys(params).length > 0 ? params : undefined, { onSubscribed: backfillGap });
	}

	$effect(() => {
		if (!active) {
			if (wsKey) {
				unsubscribe(wsKey);
				wsKey = null;
			}
			eventCoalescer.clear();
			return;
		}
		untrack(() => setupWs());
	});

	// Compact/embedded mode: when the host changes the pinned keyword,
	// re-seed the search and reload REST + WS.
	// svelte-ignore state_referenced_locally
	let boundInitialSearch = initialSearch;
	$effect(() => {
		const next = initialSearch;
		if (!compact || next === boundInitialSearch) return;
		boundInitialSearch = next;
		untrack(() => {
			searchText = next;
			searchMode = next ? initialSearchMode : 'BOTH';
			showSearch = !!next;
			loadInitial();
			setupWs();
		});
	});

	async function fetchSubscriptions() {
		if (!getIsLoggedIn()) return;
		try {
			const { data } = await api.GET('/v2/twitter/subscriptions');
			const resp = data as components['schemas']['TwitterAuthorsResponse'] | undefined;
			subscribedHandles = new Set((resp?.authors ?? []).map((a: TwitterAuthor) => a.handle.toLowerCase()));
		} catch {}
	}

	async function fetchAuthorsPage(cursor?: string) {
		const path = manageTab === 'following' ? '/v2/twitter/subscriptions' : '/v2/twitter/authors';
		const query: Record<string, unknown> = {};
		const q = authorSearch.trim();
		if (q) query.query = q;
		if (cursor) query.cursor = cursor;
		const { data } = await api.GET(path as '/v2/twitter/authors', { params: { query } } as never);
		return data as components['schemas']['TwitterAuthorsResponse'] | undefined;
	}

	async function loadAuthors() {
		authorsLoading = true;
		try {
			const data = await fetchAuthorsPage();
			authors = data?.authors ?? [];
			authorsCursor = data?.nextCursor;
			autoFillAuthors();
		} catch {
			authors = [];
			authorsCursor = undefined;
		} finally {
			authorsLoading = false;
		}
	}

	async function loadMoreAuthors() {
		if (authorsLoadingMore || !authorsCursor) return;
		authorsLoadingMore = true;
		try {
			const data = await fetchAuthorsPage(authorsCursor);
			const known = new Set(authors.map(a => a.id));
			authors = [...authors, ...(data?.authors ?? []).filter(a => !known.has(a.id))];
			authorsCursor = data?.nextCursor;
			autoFillAuthors();
		} catch {} finally {
			authorsLoadingMore = false;
		}
	}

	function setManageTab(tab: 'browse' | 'following') {
		if (manageTab === tab) return;
		manageTab = tab;
		loadAuthors();
	}

	function onAuthorSearchInput(v: string) {
		authorSearch = v;
		if (authorSearchDebounce) clearTimeout(authorSearchDebounce);
		authorSearchDebounce = setTimeout(loadAuthors, 300);
	}

	async function toggleSubscription(author: TwitterAuthor) {
		if (mutatingIds.has(author.id)) return;
		mutatingIds = new Set([...mutatingIds, author.id]);
		try {
			const isSubbed = author.subscribed || subscribedHandles.has(author.handle.toLowerCase());
			if (isSubbed) {
				await api.DELETE('/v2/twitter/subscriptions/{authorId}', { params: { path: { authorId: author.id } } });
			} else {
				await api.POST('/v2/twitter/subscriptions', { body: { authorId: author.id } });
			}
			const next = new Set(subscribedHandles);
			if (isSubbed) next.delete(author.handle.toLowerCase());
			else next.add(author.handle.toLowerCase());
			subscribedHandles = next;
			authors = authors.map(a => a.id === author.id ? { ...a, subscribed: !isSubbed } : a);
			fetchSubscriptions();
			if (feedMode === 'mine') loadInitial();
		} catch {} finally {
			const next = new Set(mutatingIds);
			next.delete(author.id);
			mutatingIds = next;
		}
	}

	function openManage() {
		view = 'manage';
		authorSearch = '';
		manageTab = 'browse';
		loadAuthors();
	}

	let handleMutating = $state<Set<string>>(new Set());

	async function toggleFollowHandle(handle: string) {
		const h = handle.toLowerCase();
		if (handleMutating.has(h)) return;
		handleMutating = new Set([...handleMutating, h]);
		try {
			const { data } = await api.GET('/v2/twitter/authors', { params: { query: { query: handle } } });
			const resp = data as components['schemas']['TwitterAuthorsResponse'] | undefined;
			const author = (resp?.authors ?? []).find(a => a.handle.toLowerCase() === h);
			if (author) await toggleSubscription(author);
		} catch {} finally {
			const next = new Set(handleMutating);
			next.delete(h);
			handleMutating = next;
		}
	}

	onMount(() => {
		loadInitial();
		fetchSubscriptions();
	});

	onDestroy(() => {
		if (wsKey) unsubscribe(wsKey);
		eventCoalescer.dispose();
		if (authorSearchDebounce) clearTimeout(authorSearchDebounce);
		if (filterDebounce) clearTimeout(filterDebounce);
	});

	function actionBadge(action: TwitterAction): { label: string; cls: string } {
		const a = actionStr(action).toLowerCase();
		switch (a) {
			case 'tweet':
			case 'post': return { label: 'tweet', cls: 'bg-blu/10 text-blu' };
			case 'reply': return { label: 'reply', cls: 'bg-s7 text-g7' };
			case 'repost': return { label: 'repost', cls: 'bg-grn/10 text-grn' };
			case 'quote': return { label: 'quote', cls: 'bg-yel/10 text-yel' };
			case 'follow': return { label: 'follow', cls: 'bg-grn/10 text-grn' };
			case 'unfollow': return { label: 'unfollow', cls: 'bg-red/10 text-red' };
			case 'photo': return { label: 'avatar', cls: 'bg-pnk/10 text-pnk' };
			case 'description': return { label: 'bio', cls: 'bg-pnk/10 text-pnk' };
			case 'banner': return { label: 'banner', cls: 'bg-pnk/10 text-pnk' };
			case 'handle': return { label: 'handle', cls: 'bg-pnk/10 text-pnk' };
			case 'name': return { label: 'name', cls: 'bg-pnk/10 text-pnk' };
			case 'pin': return { label: 'pin', cls: 'bg-yel/10 text-yel' };
			case 'unpin': return { label: 'unpin', cls: 'bg-s7 text-g7' };
			case 'delete_post':
			case 'deletepost': return { label: 'deleted', cls: 'bg-red/10 text-red' };
			default: return { label: a || '?', cls: 'bg-s7 text-g6' };
		}
	}

	function tokenHref(e: TwitterEvent): string | null {
		const t = e.token;
		if (!t?.address || !t.chain) return null;
		return `/?chain=${t.chain}&token=${t.address}`;
	}

	function tokenImg(e: TwitterEvent): string | null {
		const t = e.token;
		if (!t) return null;
		if (t.image) return t.image;
		if (t.address && t.chain) {
			return tokenImage(t.chain, t.address);
		}
		return null;
	}

	function hideImg(ev: Event) {
		(ev.currentTarget as HTMLImageElement).style.display = 'none';
	}

	type MediaDisplay = { kind: 'video'; url: string; poster?: string } | { kind: 'image'; url: string; label?: string };

	function isNativeVideo(url: string): boolean {
		return /\.(mp4|webm|mov)(\?|$)/i.test(url);
	}

	function displayMedia(media: components['schemas']['TwitterMediaItem'][] | undefined): MediaDisplay[] {
		if (!media?.length) return [];
		const out: MediaDisplay[] = [];
		const thumbs = media.filter(m => mediaTypeStr(m.type).toUpperCase() === 'THUMBNAIL' && m.url);
		const usedThumbs = new Set<string>();
		let thumbIdx = 0;
		for (const m of media) {
			if (!m.url) continue;
			const t = mediaTypeStr(m.type).toUpperCase();
			if (t === 'VIDEO') {
				const poster = thumbs[thumbIdx++]?.url ?? undefined;
				if (poster) usedThumbs.add(poster);
				out.push({ kind: 'video', url: m.url, poster });
			} else if (t === 'THUMBNAIL') {
				continue;
			} else {
				out.push({ kind: 'image', url: m.url, label: t !== 'IMAGE' ? t.toLowerCase() : undefined });
			}
		}
		for (const th of thumbs) {
			if (th.url && !usedThumbs.has(th.url)) out.push({ kind: 'image', url: th.url });
		}
		return out;
	}

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function linkify(text: string): string {
		let out = escapeHtml(text);
		out = out.replace(/https?:\/\/[^\s<]+/g, (m) => {
			const label = m.replace(/^https?:\/\/(www\.)?/, '');
			const short = label.length > 40 ? `${label.slice(0, 40)}…` : label;
			return `<a href="${m}" target="_blank" rel="noopener" class="text-blu hover:underline">${short}</a>`;
		});
		out = out.replace(/(^|[^\w/])@(\w{1,15})/g, (_m, pre: string, h: string) =>
			`${pre}<a href="https://x.com/${h}" target="_blank" rel="noopener" class="text-blu hover:underline">@${h}</a>`);
		return out;
	}

	let panelEl = $state<HTMLDivElement | null>(null);
	let resizing = $state(false);
	let resizeStartY = 0;
	let resizeStartPct = 0;

	function onResizeMove(ev: MouseEvent) {
		if (!resizing || !panelEl?.parentElement) return;
		const parentH = panelEl.parentElement.clientHeight;
		if (parentH <= 0) return;
		const deltaPct = ((resizeStartY - ev.clientY) / parentH) * 100;
		setTwitterFeedHeightPct(resizeStartPct + deltaPct);
	}

	function onResizeUp() {
		resizing = false;
		window.removeEventListener('mousemove', onResizeMove);
		window.removeEventListener('mouseup', onResizeUp);
		document.body.style.userSelect = '';
	}

	function onResizeDown(ev: MouseEvent) {
		ev.preventDefault();
		resizing = true;
		resizeStartY = ev.clientY;
		resizeStartPct = getTwitterFeedHeightPct();
		window.addEventListener('mousemove', onResizeMove);
		window.addEventListener('mouseup', onResizeUp);
		document.body.style.userSelect = 'none';
	}

	let floatEl = $state<HTMLDivElement | null>(null);
	let floatDragging = $state(false);
	let floatDragStartX = 0;
	let floatDragStartY = 0;
	let floatDragStartPos = { x: 0, y: 0 };

	function onFloatDragMove(ev: MouseEvent) {
		if (!floatDragging) return;
		const nx = Math.max(0, Math.min(window.innerWidth - 120, floatDragStartPos.x + ev.clientX - floatDragStartX));
		const ny = Math.max(48, Math.min(window.innerHeight - 48, floatDragStartPos.y + ev.clientY - floatDragStartY));
		setTwitterFeedFloatPos(nx, ny);
	}

	function onFloatDragUp() {
		floatDragging = false;
		window.removeEventListener('mousemove', onFloatDragMove);
		window.removeEventListener('mouseup', onFloatDragUp);
		document.body.style.userSelect = '';
	}

	function onFloatDragDown(ev: MouseEvent) {
		if (mobile || !getTwitterFeedPopout()) return;
		const t = ev.target as HTMLElement;
		if (t.closest('button, a, input, select')) return;
		ev.preventDefault();
		floatDragging = true;
		floatDragStartX = ev.clientX;
		floatDragStartY = ev.clientY;
		const f = getTwitterFeedFloat();
		floatDragStartPos = { x: f.x, y: f.y };
		window.addEventListener('mousemove', onFloatDragMove);
		window.addEventListener('mouseup', onFloatDragUp);
		document.body.style.userSelect = 'none';
	}

	$effect(() => {
		if (!floatEl) return;
		const el = floatEl;
		const ro = new ResizeObserver(() => {
			if (getTwitterFeedCollapsed()) return;
			if (el.offsetWidth > 0 && el.offsetHeight > 0) {
				setTwitterFeedFloatSize(el.offsetWidth, el.offsetHeight);
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
</script>

{#if compact}
	<div class="relative flex h-full min-h-0 flex-col bg-s1">
		{@render panelInner()}
	</div>
{:else if mobile}
	<div class="flex min-h-0 flex-1 flex-col bg-s0">
		{@render panelInner()}
	</div>
{:else if getTwitterFeedPopout()}
	{@const f = getTwitterFeedFloat()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		bind:this={floatEl}
		class="fixed flex flex-col overflow-hidden rounded-xl border border-bd bg-s2 shadow-2xl glass-strong"
		style="left: {f.x}px; top: {f.y}px; width: {f.w}px; {getTwitterFeedCollapsed() ? 'height: auto;' : `height: ${f.h}px; resize: both; min-height: 240px;`} min-width: 280px; z-index: {getPanelZ('twitter')};"
		onmousedown={() => bringToFront('twitter')}
	>
		{@render panelInner()}
	</div>
{:else}
	<div
		bind:this={panelEl}
		class="relative z-10 flex min-h-0 shrink-0 flex-col bg-s0 {getTwitterFeedCollapsed() ? 'border-t border-bd' : ''}"
		style={getTwitterFeedCollapsed() ? '' : `height: ${getTwitterFeedHeightPct()}%`}
	>
		{#if !getTwitterFeedCollapsed()}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group/n flex h-2 shrink-0 cursor-n-resize items-center justify-center border-t border-bd/40 transition-colors hover:bg-s7 touch-none {resizing ? 'bg-s7' : ''}"
				onmousedown={onResizeDown}
			>
				<div class="h-[2px] w-10 rounded-full bg-g1 transition-colors group-hover/n:bg-grn {resizing ? '!bg-grn' : ''}"></div>
			</div>
		{/if}
		{@render panelInner()}
	</div>
{/if}

{#snippet panelInner()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex shrink-0 items-center gap-2 border-b border-bd px-3 py-1.5 {!mobile && getTwitterFeedPopout() ? (floatDragging ? 'cursor-grabbing' : 'cursor-grab') : ''}"
		onmousedown={onFloatDragDown}
	>
		<svg viewBox="0 0 24 24" class="h-3 w-3 shrink-0 fill-tx"><path d={siX.path} /></svg>
		{#if view === 'manage'}
			<button onclick={() => (view = 'feed')} class="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-tx transition-colors hover:text-g8">
				<ArrowLeft class="h-3 w-3" /> Manage Users
			</button>
		{:else}
			<span class="text-[11px] font-bold text-tx">Feed</span>
			{#if getIsLoggedIn()}
				<div class="flex gap-0.5 rounded bg-s4 p-0.5">
					<button
						onclick={() => setMode('all')}
						class="cursor-pointer rounded px-1.5 py-px text-[9px] font-semibold transition-colors {feedMode === 'all' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
					>
						All
					</button>
					<button
						onclick={() => setMode('mine')}
						class="cursor-pointer rounded px-1.5 py-px text-[9px] font-semibold transition-colors {feedMode === 'mine' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
					>
						Mine
					</button>
				</div>
			{/if}
			<button
				onclick={() => setOnlyCa(!onlyCa)}
				class="cursor-pointer rounded px-1.5 py-px text-[10px] font-semibold transition-colors {onlyCa ? 'bg-grn/20 text-grn' : 'bg-s4 text-g5 hover:text-g8'}"
				title="Only events with a token contract"
			>
				CA
			</button>
			<button
				onclick={() => (showTypeFilter = !showTypeFilter)}
				class="relative cursor-pointer p-0.5 transition-colors {showTypeFilter ? 'text-tx' : typeFilterCount > 0 ? 'text-grn' : 'text-g4 hover:text-tx'}"
				title="Filter by type and tags"
			>
				<Filter class="h-3 w-3" strokeWidth={2} />
				{#if typeFilterCount > 0}
					<span class="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-grn px-0.5 text-[8px] font-bold text-s0">{typeFilterCount}</span>
				{/if}
			</button>
			<button
				onclick={() => { showSearch = !showSearch; if (!showSearch && searchText) { searchText = ''; applyTypeFilters(); } }}
				class="cursor-pointer p-0.5 transition-colors {showSearch || searchText ? 'text-grn' : 'text-g4 hover:text-tx'}"
				title="Search tokens and keywords"
			>
				<Search class="h-3 w-3" strokeWidth={2} />
			</button>
		{/if}
		<div class="ml-auto flex items-center gap-1">
			{#if getIsLoggedIn() && view === 'feed'}
				<button
					onclick={openManage}
					class="cursor-pointer p-0.5 text-g4 transition-colors hover:text-tx"
					aria-label="Manage followed users"
					title="Manage followed users"
				>
					<Users class="h-3.5 w-3.5" />
				</button>
			{/if}
			{#if !mobile && !compact}
				<button
					onclick={() => { const next = !getTwitterFeedPopout(); setTwitterFeedPopout(next); if (next) bringToFront('twitter'); }}
					class="cursor-pointer p-0.5 text-g4 transition-colors hover:text-tx"
					aria-label={getTwitterFeedPopout() ? 'Dock feed' : 'Pop out feed'}
					title={getTwitterFeedPopout() ? 'Dock back to sidebar' : 'Pop out to floating window'}
				>
					{#if getTwitterFeedPopout()}
						<Minimize2 class="h-3.5 w-3.5" />
					{:else}
						<PictureInPicture2 class="h-3.5 w-3.5" />
					{/if}
				</button>
				<button
					onclick={toggleTwitterFeedCollapsed}
					class="cursor-pointer p-0.5 text-g4 transition-colors hover:text-tx"
					aria-label={getTwitterFeedCollapsed() ? 'Expand feed' : 'Collapse feed'}
				>
					<ChevronDown class="h-3.5 w-3.5 transition-transform duration-200 {getTwitterFeedCollapsed() ? 'rotate-180' : ''}" />
				</button>
			{/if}
		</div>
	</div>

	{#if showSearch && view === 'feed'}
		<div class="flex shrink-0 items-center gap-1.5 border-b border-bd p-2">
			<div class="relative min-w-0 flex-1">
				<Search class="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-g4" />
				<input
					type="text"
					value={searchText}
					oninput={(e) => { searchText = (e.target as HTMLInputElement).value; applyTypeFilters(); }}
					placeholder={searchMode === 'TOKEN' ? 'Symbol or contract address...' : searchMode === 'KEYWORD' ? 'Keyword or author...' : 'Token, keyword, or author...'}
					class="w-full rounded-lg border border-bd bg-s4 py-1 pl-7 pr-2 text-[11px] text-tx outline-none placeholder:text-g4"
				/>
			</div>
			<div class="flex shrink-0 gap-0.5 rounded-md bg-s4 p-0.5">
				{#each ['BOTH', 'TOKEN', 'KEYWORD'] as const as mode}
					<button
						onclick={() => { searchMode = mode; if (searchText.trim()) applyTypeFilters(); }}
						class="cursor-pointer rounded px-1.5 py-px text-[9px] font-semibold transition-colors {searchMode === mode ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
					>
						{mode === 'BOTH' ? 'All' : mode === 'TOKEN' ? 'Token' : 'Text'}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if showTypeFilter}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-30" onclick={() => (showTypeFilter = false)}></div>
		<div class="absolute left-1 right-1 top-9 z-40 flex flex-col overflow-hidden rounded-xl border border-bd bg-s5 shadow-2xl shadow-s0/60 {compact ? 'max-h-[calc(100%-2.75rem)]' : ''}">
			<div class="flex shrink-0 items-center justify-between border-b border-s7 px-4 py-2.5">
				<span class="text-[11px] font-bold uppercase tracking-widest text-g7">Feed Filters</span>
				{#if typeFilterCount > 0}
					<button onclick={clearAllTypeFilters} class="cursor-pointer text-[10px] font-medium text-red transition-colors hover:text-red-light">Clear All</button>
				{/if}
			</div>
			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 {compact ? '' : 'max-h-[50vh]'}">
				<div>
					<span class="text-xs font-medium text-g8 mb-1 block">Type</span>
					<div class="grid grid-cols-3 gap-x-1 gap-y-px">
						<button onclick={clearActionFilters} class="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition-all {selectedActions.size === 0 ? 'text-grn' : 'text-g6 hover:bg-wh/5 hover:text-g9'}">
							<span class="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] {selectedActions.size === 0 ? 'bg-grn text-s0' : 'bg-s7 ring-1 ring-bd'}">
								{#if selectedActions.size === 0}<Check class="h-2 w-2" strokeWidth={3.5} />{/if}
							</span>
							All
						</button>
						{#each ACTION_FILTERS as f (f.key)}
							{@const on = selectedActions.has(f.key)}
							<button onclick={() => toggleActionFilter(f.key)} class="flex cursor-pointer items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium transition-all {on ? 'text-grn' : 'text-g6 hover:bg-wh/5 hover:text-g9'}">
								<span class="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] {on || selectedActions.size === 0 ? 'bg-grn text-s0' : 'bg-s7 ring-1 ring-bd'}">
									{#if on || selectedActions.size === 0}<Check class="h-2 w-2" strokeWidth={3.5} />{/if}
								</span>
								<span class="truncate">{f.label}</span>
							</button>
						{/each}
					</div>
				</div>
				<div class="h-px bg-bd"></div>
				<div>
					<span class="text-xs font-medium text-g8 mb-1.5 block">Min Followers</span>
					<input
						type="number"
						min="0"
						placeholder="e.g. 1000"
						value={minFollowers}
						oninput={(e) => { minFollowers = (e.target as HTMLInputElement).value; applyTypeFilters(); }}
						class="w-full rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx placeholder-g3 outline-none transition-all focus:border-grn/40 focus:bg-s5"
					/>
				</div>
				<div class="h-px bg-bd"></div>
				<div>
					<span class="text-xs font-medium text-g8 mb-1.5 block">Labels</span>
					<div class="flex flex-wrap gap-1.5">
						{#each TAG_FILTERS as t (t.key)}
							{@const on = selectedTags.has(t.key)}
							<button
								onclick={() => toggleTagFilter(t.key)}
								class="cursor-pointer rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all {on
									? 'bg-grn/10 text-grn ring-1 ring-grn/20'
									: 'bg-s7 text-g4 ring-1 ring-bd hover:text-g7'}"
							>
								{t.label}
							</button>
						{/each}
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if mobile || !getTwitterFeedCollapsed()}
		{#if view === 'manage'}
			<div class="flex shrink-0 items-center gap-1.5 border-b border-bd p-2">
				<div class="flex gap-0.5 rounded-md bg-s4 p-0.5">
					<button
						onclick={() => setManageTab('browse')}
						class="cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-colors {manageTab === 'browse' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
					>
						Browse
					</button>
					<button
						onclick={() => setManageTab('following')}
						class="cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-colors {manageTab === 'following' ? 'bg-bd text-tx' : 'text-g5 hover:text-g8'}"
					>
						Following
					</button>
				</div>
				<div class="relative min-w-0 flex-1">
					<Search class="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-g4" />
					<input
						type="text"
						value={authorSearch}
						oninput={(e) => onAuthorSearchInput((e.target as HTMLInputElement).value)}
						placeholder={manageTab === 'browse' ? 'Search all authors...' : 'Search following...'}
						class="w-full rounded-lg border border-bd bg-s4 py-1 pl-7 pr-2 text-[11px] text-tx outline-none placeholder:text-g4"
					/>
				</div>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto" bind:this={authorsScrollEl} onscroll={handleAuthorsScroll}>
				{#if authorsLoading}
					<div class="flex justify-center py-4"><LoaderCircle class="h-4 w-4 animate-spin text-g5" /></div>
				{:else if authors.length === 0}
					<div class="flex h-20 items-center justify-center text-[11px] text-g5">{authorSearch ? 'No authors found' : manageTab === 'following' ? 'Not following anyone yet' : 'No tracked authors'}</div>
				{:else}
					{#each authors as author (author.id)}
						{@const subbed = author.subscribed || subscribedHandles.has(author.handle.toLowerCase())}
						<div class="flex items-center gap-2 border-b border-bd/30 px-3 py-1.5">
							{#if author.avatar}
								<img src={author.avatar} alt="" class="h-6 w-6 shrink-0 rounded-full" loading="lazy" onerror={hideImg} />
							{:else}
								<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-s7 text-[10px] font-bold text-g8">{author.handle[0]?.toUpperCase()}</div>
							{/if}
							<div class="min-w-0 flex-1">
								<div class="truncate text-[11px] font-semibold text-tx">{author.name ?? author.handle}</div>
								<div class="truncate text-[10px] text-g5">@{author.handle} · {formatCompactNumber(author.followers ?? 0)}{#if author.subscriptionCount > 0} · <span class="text-grn">{formatCompactNumber(author.subscriptionCount)} subs</span>{/if}</div>
							</div>
							<button
								onclick={() => toggleSubscription(author)}
								disabled={mutatingIds.has(author.id)}
								class="{subbed ? 'btn-secondary' : 'btn-primary'} shrink-0 px-2 py-0.5 text-[10px] disabled:opacity-50"
							>
								{subbed ? 'Following' : 'Follow'}
							</button>
						</div>
					{/each}
					{#if authorsLoadingMore}
						<div class="flex items-center justify-center py-2"><LoaderCircle class="h-3 w-3 animate-spin text-g5" /></div>
					{/if}
				{/if}
			</div>
		{:else}
		<div class="min-h-0 flex-1 overflow-y-auto" bind:this={feedScrollEl} onscroll={handleFeedScroll}>
			{#if loading}
				<div class="space-y-1.5 p-2">
					{#each Array(5) as _, i}
						<div class="skeleton h-14 rounded-lg" style="animation-delay: {i * 60}ms"></div>
					{/each}
				</div>
			{:else if visibleEvents.length === 0}
				<div class="flex h-24 items-center justify-center text-xs text-g5">{feedMode === 'mine' ? 'No events from followed users' : 'No events'}</div>
			{:else}
				{#each visibleEvents as e (dedupeKey(e))}
					{@const badge = actionBadge(e.action)}
					{@const href = tokenHref(e)}
					{@const timg = tokenImg(e)}
					{@const subbed = subscribedHandles.has(e.author.handle?.toLowerCase() ?? '')}
					{@const mediaItems = displayMedia(e.content?.media)}
					<div class="flex gap-2 border-b border-bd/30 px-3 py-2 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_76px]">
						<div class="group/av relative h-7 w-7 shrink-0 self-start" style="margin-top: 2px;">
							<a href="https://x.com/{e.author.handle}" target="_blank" rel="noopener">
								{#if e.author.avatar}
									<img src={e.author.avatar} alt="" class="h-7 w-7 rounded-full ring-1 ring-bd" loading="lazy" onerror={hideImg} />
								{:else}
									<div class="flex h-7 w-7 items-center justify-center rounded-full bg-s7 text-[11px] font-bold text-g8">{e.author.handle?.[0]?.toUpperCase() ?? '?'}</div>
								{/if}
							</a>
							{#if getIsLoggedIn() && e.author.handle}
								<button
									onclick={() => toggleFollowHandle(e.author.handle ?? '')}
									disabled={handleMutating.has(e.author.handle.toLowerCase())}
									class="absolute -bottom-1 -right-1 hidden h-4 w-4 cursor-pointer items-center justify-center rounded-full ring-1 ring-bd transition-colors group-hover/av:flex disabled:opacity-50 {subbed ? 'bg-grn text-s0 hover:bg-red hover:text-s0' : 'bg-s7 text-tx hover:bg-grn hover:text-s0'}"
									title={subbed ? 'Remove from my feed' : 'Add to my feed'}
								>
									{#if handleMutating.has(e.author.handle.toLowerCase())}
										<LoaderCircle class="h-2.5 w-2.5 animate-spin" />
									{:else if subbed}
										<Check class="h-2.5 w-2.5" strokeWidth={3} />
									{:else}
										<Plus class="h-2.5 w-2.5" strokeWidth={3} />
									{/if}
								</button>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<a href="https://x.com/{e.author.handle}" target="_blank" rel="noopener" class="truncate text-[11px] font-semibold text-tx hover:underline">{e.author.name ?? e.author.handle}</a>
								<span class="shrink-0 text-[10px] text-g5">{formatCompactNumber(e.author.followers ?? 0)}</span>
								{#each (e.author.tags ?? []).slice(0, 2) as tag}
									<span class="shrink-0 rounded bg-s7 px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-g6">{tag}</span>
								{/each}
								<span class="shrink-0 rounded px-1 py-px text-[9px] font-semibold {badge.cls}">{badge.label}</span>
								{#if e.timestamp}
									{#if e.tweetId}
										<a
											href="https://x.com/{e.author.handle}/status/{e.tweetId}"
											target="_blank"
											rel="noopener"
											class="ml-auto shrink-0 text-[10px] text-g4 transition-colors hover:text-tx hover:underline cursor-help"
											title={fullDateTime(e.timestamp)}
										>
											{timeAgo(e.timestamp, getNow())}
										</a>
									{:else}
										<span class="ml-auto shrink-0 text-[10px] text-g4 cursor-help" title={fullDateTime(e.timestamp)}>{timeAgo(e.timestamp, getNow())}</span>
									{/if}
								{/if}
							</div>
						{#if e.content?.text}
							<div class="mt-0.5 whitespace-pre-line break-words text-[11px] leading-snug text-g8">{@html linkify(e.content.text)}</div>
						{/if}
						{#if mediaItems.length > 0}
							<div class="mt-1 grid gap-1 {mediaItems.length > 1 ? 'grid-cols-2' : ''}">
								{#each mediaItems as m}
									{#if m.kind === 'video' && isNativeVideo(m.url)}
										<!-- svelte-ignore a11y_media_has_caption -->
										<video
											controls
											preload="none"
											playsinline
											poster={m.poster}
											src={m.url}
											class="max-h-48 w-full rounded-lg border border-bd/40 bg-s0 object-contain"
										></video>
									{:else if m.kind === 'video'}
										<a
											href={e.tweetId && e.author.handle ? `https://x.com/${e.author.handle}/status/${e.tweetId}` : m.url}
											target="_blank"
											rel="noopener"
											class="group/vid relative block overflow-hidden rounded-lg border border-bd/40 bg-s0"
											title="Watch on X"
										>
											{#if m.poster}
												<img src={m.poster} alt="" class="max-h-48 w-full object-cover opacity-80 transition-opacity group-hover/vid:opacity-100" loading="lazy" onerror={hideImg} />
											{:else}
												<div class="h-24 w-full"></div>
											{/if}
											<span class="absolute inset-0 flex items-center justify-center">
												<span class="flex h-9 w-9 items-center justify-center rounded-full bg-s0/70 ring-1 ring-bd transition-transform group-hover/vid:scale-110">
													<svg class="ml-0.5 h-4 w-4 fill-tx" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
												</span>
											</span>
										</a>
									{:else}
										<a href={m.url} target="_blank" rel="noopener" class="relative block overflow-hidden rounded-lg border border-bd/40">
											<img src={m.url} alt="" class="max-h-48 w-full object-cover" loading="lazy" onerror={hideImg} />
											{#if m.label}
												<span class="absolute bottom-1 left-1 rounded bg-s6 px-1 py-px text-[9px] font-medium lowercase text-tx">{m.label}</span>
											{/if}
										</a>
									{/if}
								{/each}
							</div>
						{/if}
							{#if (actionStr(e.action).toLowerCase() === 'follow' || actionStr(e.action).toLowerCase() === 'unfollow') && e.unfollowTarget}
								{@const t = e.unfollowTarget}
								<a
									href="https://x.com/{t.handle}"
									target="_blank"
									rel="noopener"
									class="mt-1 flex gap-2 rounded-lg border {actionStr(e.action).toLowerCase() === 'follow' ? 'border-grn/20' : 'border-red/20'} bg-s1 p-2 transition-colors hover:bg-wh/5"
								>
									{#if t.avatar}
										<img src={t.avatar} alt="" class="h-8 w-8 shrink-0 rounded-full ring-1 ring-bd" loading="lazy" onerror={hideImg} />
									{:else}
										<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-s7 text-xs font-bold text-g8">{t.handle?.[0]?.toUpperCase() ?? '?'}</div>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1.5">
											<span class="truncate text-[11px] font-semibold text-tx">{t.name ?? t.handle}</span>
											<span class="truncate text-[10px] text-g5">@{t.handle}</span>
										</div>
										<div class="text-[10px] text-g5">
											<span class="font-semibold text-g8">{formatCompactNumber(t.followers ?? 0)}</span> followers
											<span class="mx-0.5 text-g3">·</span>
											<span class="font-semibold text-g8">{formatCompactNumber(t.following ?? 0)}</span> following
										</div>
										{#if t.bio}
											<div class="mt-0.5 line-clamp-2 text-[10px] leading-snug text-g6">{t.bio}</div>
										{/if}
									</div>
								</a>
							{/if}
							{#if e.reference && (e.reference.text || e.reference.media?.length)}
								<div class="mt-1 rounded-md border-l-2 border-bd bg-s1 px-2 py-1">
									<span class="text-[10px] font-medium text-g6">@{e.reference.authorHandle}</span>
									{#if e.reference.text}
										<div class="whitespace-pre-line break-words text-[10px] leading-snug text-g6">{@html linkify(e.reference.text)}</div>
									{/if}
									{#if e.reference.media?.length && e.reference.media[0].url}
										<a href={e.reference.media[0].url} target="_blank" rel="noopener" class="mt-1 block overflow-hidden rounded border border-bd/40">
											<img src={e.reference.media[0].url} alt="" class="max-h-24 w-full object-cover" loading="lazy" onerror={hideImg} />
										</a>
									{/if}
									{#if e.reference.reference && (e.reference.reference.text || e.reference.reference.media?.length)}
										{@const nested = e.reference.reference}
										<div class="mt-1 rounded-md border-l-2 border-bd bg-s0/60 px-2 py-1">
											<span class="text-[10px] font-medium text-g5">@{nested.authorHandle}</span>
											{#if nested.text}
												<div class="whitespace-pre-line break-words text-[10px] leading-snug text-g5">{@html linkify(nested.text)}</div>
											{/if}
											{#if nested.media?.length && nested.media[0].url}
												<a href={nested.media[0].url} target="_blank" rel="noopener" class="mt-1 block overflow-hidden rounded border border-bd/40">
													<img src={nested.media[0].url} alt="" class="max-h-20 w-full object-cover" loading="lazy" onerror={hideImg} />
												</a>
											{/if}
										</div>
									{/if}
								</div>
							{/if}
							{#if e.token?.symbol}
								{@const chip = `${e.token.symbol}${e.token.marketCapUsdStr ?? e.token.marketCapUsd ? ` · ${formatMarketCap(e.token.marketCapUsdStr ?? e.token.marketCapUsd)}` : ''}`}
								{#if href}
									<a {href} class="mt-1 inline-flex items-center gap-1.5 rounded-md bg-grn/10 px-1.5 py-0.5 text-[10px] font-semibold text-grn hover:bg-grn/20">
										{#if timg}<img src={timg} alt="" class="h-3.5 w-3.5 rounded-[3px]" loading="lazy" onerror={hideImg} />{/if}
										{chip}
									</a>
								{:else}
									<span class="mt-1 inline-flex items-center gap-1.5 rounded-md bg-s4 px-1.5 py-0.5 text-[10px] font-semibold text-g8">
										{#if timg}<img src={timg} alt="" class="h-3.5 w-3.5 rounded-[3px]" loading="lazy" onerror={hideImg} />{/if}
										{chip}
									</span>
								{/if}
							{/if}
						</div>
					</div>
				{/each}
				{#if loadingMore}
					<div class="flex items-center justify-center py-2"><LoaderCircle class="h-3 w-3 animate-spin text-g5" /></div>
				{/if}
			{/if}
		</div>
		{/if}
	{/if}
{/snippet}
