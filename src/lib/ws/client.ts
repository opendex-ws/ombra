import { getAuthToken } from '$lib/stores/auth.svelte';
import { WS_PROBE_INTERVAL_MS } from '$lib/utils/ws-health';
import { wsBase } from '$lib/api/config';
import { dev } from '$app/environment';

type MessageHandler = (event: string, data: any, topic: string, meta?: any) => void;

export type WsErrorReason =
	| 'CURSOR_EXPIRED'
	| 'CURSOR_KEY_MISMATCH'
	| 'CURSOR_INVALID'
	| 'PARAMS_INVALID'
	| 'TOPIC_INVALID'
	| 'SEED_TIMEOUT'
	| 'UNAUTHORIZED'
	| 'INTERNAL';

export type WsSubscribedWindow = {
	windowId: string;
	mode: 'fixed' | 'live';
	endCursor?: string | null;
	startCursor?: string | null;
};

export type WsErrorInfo = {
	message?: string;
	reason?: WsErrorReason;
	requestId?: string;
	topic?: string;
	params?: Record<string, any>;
};

export type SubscribeOptions = {
	onError?: (error: WsErrorInfo) => void;
	onSubscribed?: () => void;
	recovery?: 'resubscribe' | 'refetch';
	onReconnect?: () => void;
};

export function isCursorRecoveryReason(reason: WsErrorReason | undefined): boolean {
	return reason === 'CURSOR_EXPIRED' || reason === 'CURSOR_KEY_MISMATCH' || reason === 'CURSOR_INVALID';
}

type Subscription = {
	topic: string;
	params?: Record<string, any>;
	handler: MessageHandler;
	onError?: (error: WsErrorInfo) => void;
	onSubscribed?: () => void;
	recovery: 'resubscribe' | 'refetch';
	onReconnect?: () => void;
	serverKey?: string;
	localOnly?: boolean;
};

type ServerSubscription = {
	topic: string;
	params?: Record<string, any>;
	subId?: string;
	displayTopic?: string;
	pendingRequestId?: string;
	windows?: Record<string, WsSubscribedWindow>;
	failed?: boolean;
	traceRequestId?: string;
	traceSentAtMs?: number;
	traceAckAtMs?: number;
	traceFirstFrameAtMs?: number;
	traceFirstUpdateAtMs?: number;
};

let socket: WebSocket | null = null;
let subscriptions = new Map<string, Subscription>();
let serverSubscriptions = new Map<string, ServerSubscription>();
let pendingAcks = new Map<string, string>();
let subCounter = 0;
let requestCounter = 0;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
let closeTimeout: ReturnType<typeof setTimeout> | null = null;
let currentAuthToken: string | null = null;
let currentUserId: string | null = null;
let connectionGeneration = 0;
let reconnectAttempt = 0;
type InboundItem = { generation: number; raw: string; process: (raw: string) => void };
let inboundQueue: InboundItem[] = [];
let inboundQueueHead = 0;
let inboundQueueBytes = 0;
let drainScheduled = false;
let drainChannel: MessageChannel | null = null;
let outstandingPing: { requestId: string; generation: number; sentAt: number } | null = null;
let recoveryWatchdog: ReturnType<typeof setTimeout> | null = null;
let lifecycleInstalled = false;
type WsConnectionState = 'closed' | 'connecting' | 'open' | 'recovering';
let connectionState: WsConnectionState = 'closed';
let processedMessages = 0;
let lastRecoveryMs: number | undefined;
let lastPongRttMs: number | undefined;
let lastPongAtMs: number | undefined;
let lastServerTimestampMs: number | undefined;
let reconnectCount = 0;
let lastCloseCode: number | undefined;
let lastCloseReason: string | undefined;
const diagnosticsListeners = new Set<(diagnostics: WsDiagnostics) => void>();

const PROCESSING_SLICE_MS = 8;
const PROCESSING_SLICE_MESSAGES = 100;
// When the queue is backing up, widen the per-turn budget so we catch up instead
// of trickling ~100 msgs/turn while the backlog keeps growing.
const PROCESSING_SLICE_MS_BUSY = 12;
const PROCESSING_SLICE_MESSAGES_BUSY = 400;
const BACKLOG_BUSY_THRESHOLD = 200;
// Hard backpressure ceilings. If the main thread cannot keep up with the socket
// (queue grows past these), force a reconnect: the server re-seeds every live
// window via snapshots, so dropping the backlog is safe and bounds memory.
const MAX_INBOUND_QUEUE_MESSAGES = 20000;
const MAX_INBOUND_QUEUE_BYTES = 32 * 1024 * 1024;
const RECOVERY_STALL_MS = 30000;
// While the tab is hidden we STOP processing inbound frames (no parsing, no
// coalescer buffering, no reactive churn) — the browser doesn't throttle the
// socket/MessageChannel, so an hour in the background would otherwise build a
// giant backlog that floods the main thread on return (sustained low FPS). We
// keep only a small ring of the most recent frames while hidden, then drop it
// entirely on resume and let the server re-seed every live window.
const MAX_HIDDEN_QUEUE_MESSAGES = 2000;
// On resume, if we dropped more than this many hidden-tab frames, the UI has
// diverged enough that we force a reconnect + full server reseed. Below it, a
// quick tab switch, we keep the existing socket + subscriptions and just probe.
const RESUME_RESEED_BACKLOG = 100;

function isDocHidden(): boolean {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function getWsUrl(): string {
	return `${wsBase()}/v2/ws`;
}

function safeSend(data: string) {
	try {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(data);
		}
	} catch { }
}

function paramsKeys(params?: Record<string, any>): string[] {
	return params ? Object.keys(params).sort() : [];
}

const WS_DEBUG_LOGS = false;
function wsLog(event: string, details: Record<string, unknown>) {
	if (dev && WS_DEBUG_LOGS) console.debug(`[WS] ${event}`, details);
}

function notifyDiagnostics() {
	const diagnostics = getWsDiagnostics();
	for (const listener of diagnosticsListeners) {
		try {
			listener(diagnostics);
		} catch (error) {
			wsLog('diagnostics:listener-error', { error: String(error) });
		}
	}
}

function setConnectionState(next: WsConnectionState) {
	if (connectionState === next) return;
	connectionState = next;
	notifyDiagnostics();
}

function clearRecoveryWatchdog() {
	if (recoveryWatchdog) clearTimeout(recoveryWatchdog);
	recoveryWatchdog = null;
}

function resetRecoveryWatchdog() {
	clearRecoveryWatchdog();
	const ping = outstandingPing;
	if (!ping || document.visibilityState === 'hidden') return;
	recoveryWatchdog = setTimeout(() => {
		if (!outstandingPing || outstandingPing.requestId !== ping.requestId || outstandingPing.generation !== ping.generation) return;
		wsLog('recovery:stalled', { requestId: ping.requestId, generation: ping.generation });
		forceReconnect('application pong made no progress');
	}, RECOVERY_STALL_MS);
}

function noteRecoveryProgress() {
	if (outstandingPing) resetRecoveryWatchdog();
}

function inboundQueueSize() {
	return inboundQueue.length - inboundQueueHead;
}

function resetInboundQueue() {
	inboundQueue = [];
	inboundQueueHead = 0;
	inboundQueueBytes = 0;
}

function compactInboundQueue() {
	if (inboundQueueHead === inboundQueue.length) {
		resetInboundQueue();
	} else if (inboundQueueHead >= 1024 && inboundQueueHead * 2 >= inboundQueue.length) {
		inboundQueue = inboundQueue.slice(inboundQueueHead);
		inboundQueueHead = 0;
	}
}

function scheduleInboundDrain() {
	// Don't process frames while hidden — they'd fan out into coalescers/reactive
	// state and accumulate for the whole background period. Frames stay queued
	// (bounded, see enqueueInbound) and are dropped on resume.
	if (drainScheduled || inboundQueueSize() === 0 || isDocHidden()) return;
	drainScheduled = true;
	if (!drainChannel && typeof MessageChannel !== 'undefined') {
		drainChannel = new MessageChannel();
		drainChannel.port1.onmessage = drainInboundQueue;
	}
	if (drainChannel) drainChannel.port2.postMessage(undefined);
	else setTimeout(drainInboundQueue, 0);
}

function drainInboundQueue() {
	drainScheduled = false;
	const busy = inboundQueueSize() >= BACKLOG_BUSY_THRESHOLD;
	const msgBudget = busy ? PROCESSING_SLICE_MESSAGES_BUSY : PROCESSING_SLICE_MESSAGES;
	const msBudget = busy ? PROCESSING_SLICE_MS_BUSY : PROCESSING_SLICE_MS;
	const startedAt = performance.now();
	let processed = 0;
	let sinceTimeCheck = 0;
	while (inboundQueueHead < inboundQueue.length && processed < msgBudget) {
		const item = inboundQueue[inboundQueueHead++];
		inboundQueueBytes = Math.max(0, inboundQueueBytes - item.raw.length);
		if (item.generation === connectionGeneration) {
			try {
				item.process(item.raw);
			} catch (error) {
				wsLog('message:handler-error', { error: String(error), generation: item.generation });
			}
			processedMessages++;
			noteRecoveryProgress();
		}
		processed++;
		// performance.now() is not free; sample it every 32 messages.
		if (++sinceTimeCheck >= 32) {
			sinceTimeCheck = 0;
			if (performance.now() - startedAt >= msBudget) break;
		}
	}
	compactInboundQueue();
	if (inboundQueueSize() > 0) scheduleInboundDrain();
}

function enqueueInbound(generation: number, raw: string, process: (raw: string) => void) {
	if (generation !== connectionGeneration) return;
	// While hidden we don't drain; keep only a small ring of the newest frames so
	// memory stays bounded no matter how long we're backgrounded. Dropping old
	// frames is safe — on resume we discard the backlog and the server reseeds.
	if (isDocHidden()) {
		inboundQueue.push({ generation, raw, process });
		inboundQueueBytes += raw.length;
		while (inboundQueueSize() > MAX_HIDDEN_QUEUE_MESSAGES) {
			const dropped = inboundQueue[inboundQueueHead++];
			inboundQueueBytes = Math.max(0, inboundQueueBytes - dropped.raw.length);
		}
		// Reclaim the dropped prefix so the backing array can't grow unbounded
		// over a long hidden period (head advances but slots stay allocated).
		if (inboundQueueHead >= MAX_HIDDEN_QUEUE_MESSAGES) {
			inboundQueue = inboundQueue.slice(inboundQueueHead);
			inboundQueueHead = 0;
		}
		return;
	}
	if (inboundQueueSize() >= MAX_INBOUND_QUEUE_MESSAGES || inboundQueueBytes >= MAX_INBOUND_QUEUE_BYTES) {
		wsLog('inbound:overflow', { queued: inboundQueueSize(), bytes: inboundQueueBytes });
		forceReconnect('inbound queue overflow');
		return;
	}
	inboundQueue.push({ generation, raw, process });
	inboundQueueBytes += raw.length;
	noteRecoveryProgress();
	scheduleInboundDrain();
}

function startApplicationProbe(reason: 'periodic' | 'resume' | 'open') {
	if (!socket || socket.readyState !== WebSocket.OPEN || document.visibilityState === 'hidden') return;
	if (outstandingPing?.generation === connectionGeneration) return;
	const requestId = `ws_ping_${connectionGeneration}_${++requestCounter}`;
	outstandingPing = { requestId, generation: connectionGeneration, sentAt: performance.now() };
	setConnectionState('recovering');
	wsLog('recovery:start', { reason, requestId, generation: connectionGeneration, queuedMessages: inboundQueueSize() });
	safeSend(JSON.stringify({ type: 'ping', requestId }));
	resetRecoveryWatchdog();
}

function handleApplicationPong(requestId: unknown, generation: number, serverTimestampMs: unknown) {
	const ping = outstandingPing;
	if (!ping || typeof requestId !== 'string' || requestId !== ping.requestId || generation !== ping.generation) return;
	const elapsed = performance.now() - ping.sentAt;
	lastPongRttMs = elapsed;
	lastRecoveryMs = elapsed;
	lastPongAtMs = Date.now();
	if (typeof serverTimestampMs === 'number' && Number.isFinite(serverTimestampMs)) {
		lastServerTimestampMs = serverTimestampMs;
	}
	outstandingPing = null;
	clearRecoveryWatchdog();
	notifyDiagnostics();
	requestAnimationFrame(() => {
		if (generation !== connectionGeneration) return;
		reconnectAttempt = 0;
		setConnectionState('open');
		wsLog('recovery:complete', { requestId, generation, elapsedMs: elapsed, queuedMessages: inboundQueueSize() });
	});
}

function reconnectDelay(closeCode?: number): number {
	if (closeCode === 1013) return 250 + Math.floor(Math.random() * 501);
	const base = Math.min(10000, 500 * 2 ** Math.min(reconnectAttempt, 5));
	const jitter = base * (Math.random() * 0.4 - 0.2);
	return Math.max(0, Math.round(base + jitter));
}

function scheduleReconnect(closeCode?: number) {
	if (intentionalClose || subscriptions.size === 0 || reconnectTimeout) return;
	const delay = reconnectDelay(closeCode);
	reconnectAttempt++;
	reconnectCount++;
	wsLog('reconnect:scheduled', { delay, closeCode, attempt: reconnectAttempt });
	reconnectTimeout = setTimeout(() => {
		reconnectTimeout = null;
		notifyDiagnostics();
		connect();
	}, delay);
	notifyDiagnostics();
}

function forceReconnect(reason: string) {
	const staleSocket = socket;
	connectionGeneration++;
	outstandingPing = null;
	clearRecoveryWatchdog();
	resetInboundQueue();
	socket = null;
	if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
	setConnectionState('closed');
	// Bumping the generation above makes the stale socket's onclose handler
	// early-return, so it will NOT clear the per-subscription server state. Clear
	// it here so the next onopen actually re-subscribes every live topic (a stale
	// subId would make onopen skip re-subscribing → silently missing feeds).
	serverSubscriptions.forEach((serverSub) => {
		serverSub.subId = undefined;
		serverSub.displayTopic = undefined;
		serverSub.pendingRequestId = undefined;
		serverSub.windows = undefined;
		serverSub.failed = false;
	});
	pendingAcks.clear();
	wsLog('reconnect:forced', { reason, generation: connectionGeneration });
	try { staleSocket?.close(); } catch { }
	scheduleReconnect();
}

function handleVisibilityChange() {
	if (document.visibilityState === 'hidden') {
		clearRecoveryWatchdog();
		return;
	}
	// Returning to a visible tab. Two cases:
	//  - Large backlog (long background period): drop it and force a clean
	//    reconnect so the server re-seeds every live window from scratch —
	//    replaying an hour of deltas would flood the main thread (low FPS), and
	//    the reseed makes the dropped deltas irrelevant.
	//  - Small backlog (a quick tab switch): just drain it normally on the
	//    existing socket (no flood risk) so no updates are lost, then probe.
	const staleBacklog = inboundQueueSize();
	if (socket?.readyState === WebSocket.OPEN) {
		if (staleBacklog >= RESUME_RESEED_BACKLOG) {
			resetInboundQueue();
			forceReconnect('resume with large stale backlog');
		} else {
			startApplicationProbe('resume');
			scheduleInboundDrain();
		}
	} else {
		resetInboundQueue();
		ensureConnected();
	}
}

function installLifecycleHandlers() {
	if (lifecycleInstalled || typeof window === 'undefined') return;
	document.addEventListener('visibilitychange', handleVisibilityChange);
	window.addEventListener('pageshow', handleVisibilityChange);
	window.addEventListener('online', handleVisibilityChange);
	lifecycleInstalled = true;
}

function removeLifecycleHandlers() {
	if (!lifecycleInstalled || typeof window === 'undefined') return;
	document.removeEventListener('visibilitychange', handleVisibilityChange);
	window.removeEventListener('pageshow', handleVisibilityChange);
	window.removeEventListener('online', handleVisibilityChange);
	lifecycleInstalled = false;
}

export type WsDiagnostics = {
	generation: number;
	state: WsConnectionState;
	queuedMessages: number;
	queuedBytes: number;
	processedMessages: number;
	lastRecoveryMs?: number;
	outstandingPingId?: string;
	lastPongRttMs?: number;
	lastPongAtMs?: number;
	lastServerTimestampMs?: number;
	reconnectCount: number;
	reconnectAttempt: number;
	reconnectScheduled: boolean;
	lastCloseCode?: number;
	lastCloseReason?: string;
};

export function getWsDiagnostics(): WsDiagnostics {
	return {
		generation: connectionGeneration,
		state: connectionState,
		queuedMessages: inboundQueueSize(),
		queuedBytes: inboundQueueBytes,
		processedMessages,
		lastRecoveryMs,
		outstandingPingId: outstandingPing?.requestId,
		lastPongRttMs,
		lastPongAtMs,
		lastServerTimestampMs,
		reconnectCount,
		reconnectAttempt,
		reconnectScheduled: reconnectTimeout !== null,
		lastCloseCode,
		lastCloseReason
	};
}

// Console diagnostic: run `__wsDiag()` in the browser console. Growing
// `queuedMessages` => FE parse/dispatch bound; near-zero while swaps still lag =>
// backend emit rate / network bound. Assigned at module load so it's available
// as soon as the WS client is imported (regardless of connection state).
if (typeof window !== 'undefined') {
	(globalThis as unknown as { __wsDiag?: () => WsDiagnostics }).__wsDiag = getWsDiagnostics;
}



/** Subscribe to connection diagnostics without polling the diagnostics snapshot. */
export function observeWsDiagnostics(listener: (diagnostics: WsDiagnostics) => void): () => void {
	diagnosticsListeners.add(listener);
	listener(getWsDiagnostics());
	return () => diagnosticsListeners.delete(listener);
}

function isScannerTopic(topic: string | undefined): boolean {
	return typeof topic === 'string' && topic.startsWith('scanner:');
}

function scannerWsTrace(event: string, details: Record<string, unknown>) {
	if (!dev || !WS_DEBUG_LOGS) return;
	console.info(`[SCANNER-WS-TRACE] ${event}`, {
		at: new Date().toISOString(),
		...details
	});
}

function isUserTopic(topic: string): boolean {
	return topic === 'user';
}

function serverKeyFor(topic: string, params?: Record<string, any>): string {
	return params ? `${topic}\n${JSON.stringify(params)}` : topic;
}

function topicMatches(expected: string, actual: string): boolean {
	return expected === actual || actual.startsWith(expected + ':') || expected.startsWith(actual + ':');
}

function frameWindowId(meta: any): string | undefined {
	const direct = meta?.windowId;
	if (typeof direct === 'string') return direct;
	const nested = meta?.window?.windowId;
	return typeof nested === 'string' ? nested : undefined;
}

function frameEndCursor(meta: any): string | undefined {
	const direct = meta?.endCursor;
	if (typeof direct === 'string') return direct;
	const nested = meta?.window?.endCursor;
	return typeof nested === 'string' ? nested : undefined;
}

function hasAcknowledgedWindow(serverSub: ServerSubscription, msgTopic: string, windowId: string, endCursor?: string): boolean {
	if (!serverSub.windows) return false;
	return Object.entries(serverSub.windows).some(([topic, window]) => {
		return window.windowId === windowId
			&& topicMatches(topic, msgTopic)
			&& (!endCursor || !window.endCursor || window.endCursor === endCursor);
	});
}

function hasLocalSubscribers(serverKey: string): boolean {
	for (const sub of subscriptions.values()) {
		if (sub.serverKey === serverKey) return true;
	}
	return false;
}

function deliverToSubscription(sub: Subscription, event: string, data: any, topic: string, meta?: any) {
	try {
		sub.handler(event, data, topic, meta);
	} catch (error) {
		wsLog('subscription:handler-error', { topic: sub.topic, event, error: String(error) });
	}
}

function takePendingServerKey(requestId: string): string | undefined {
	if (requestId) {
		const serverKey = pendingAcks.get(requestId);
		if (serverKey) pendingAcks.delete(requestId);
		return serverKey;
	}

	for (const [serverKey, sub] of serverSubscriptions) {
		if (sub.pendingRequestId) {
			pendingAcks.delete(sub.pendingRequestId);
			return serverKey;
		}
	}
}

function dispatchMessage(msgTopic: string, event: string, data: any, meta?: any) {
	let delivered = 0;
	let rejectedWindow = 0;
	const windowId = frameWindowId(meta);
	const endCursor = frameEndCursor(meta);
	subscriptions.forEach((sub) => {
		if (isUserTopic(sub.topic)) {
			if (
				currentUserId
				&& (msgTopic === `user:${currentUserId}` || msgTopic === 'user:favourites')
			) {
				delivered++;
				deliverToSubscription(sub, event, data, msgTopic, meta);
			}
			return;
		}

		const serverSub = sub.serverKey ? serverSubscriptions.get(sub.serverKey) : undefined;
		if (serverSub && !serverSub.pendingRequestId && !serverSub.failed) {
			const strictAckRouting = sub.topic.startsWith('twitter:') && !!serverSub.displayTopic;
			const displayMatch = serverSub.displayTopic ? (strictAckRouting ? serverSub.displayTopic === msgTopic : topicMatches(serverSub.displayTopic, msgTopic)) : false;
			const requestedMatch = strictAckRouting ? false : topicMatches(sub.topic, msgTopic);
			if (displayMatch || requestedMatch) {
				if (windowId && !hasAcknowledgedWindow(serverSub, msgTopic, windowId, endCursor)) {
					rejectedWindow++;
					return;
				}
				delivered++;
				deliverToSubscription(sub, event, data, msgTopic, meta);
			}
		}
	});
	if (dev && isScannerTopic(msgTopic)) {
		const now = Date.now();
		let matched = 0;
		serverSubscriptions.forEach((serverSub) => {
			if (!isScannerTopic(serverSub.topic) || serverSub.pendingRequestId || serverSub.failed) return;
			if (!topicMatches(serverSub.displayTopic ?? serverSub.topic, msgTopic)) return;
			if (windowId && !hasAcknowledgedWindow(serverSub, msgTopic, windowId, endCursor)) return;
			matched++;
			const common = {
				requestId: serverSub.traceRequestId,
				subId: serverSub.subId,
				topic: serverSub.topic,
				eventTopic: msgTopic,
				event,
				windowId,
				endCursor,
				delivered,
				rejectedWindow,
				tokenCount: Array.isArray(data?.tokens) ? data.tokens.length : Array.isArray(data?.snapshot?.tokens) ? data.snapshot.tokens.length : undefined,
				msSinceSend: serverSub.traceSentAtMs === undefined ? undefined : now - serverSub.traceSentAtMs,
				msSinceAck: serverSub.traceAckAtMs === undefined ? undefined : now - serverSub.traceAckAtMs
			};
			if (serverSub.traceFirstFrameAtMs === undefined) {
				serverSub.traceFirstFrameAtMs = now;
				scannerWsTrace('first-frame', common);
			}
			if (event === 'SCANNER_UPDATE' && serverSub.traceFirstUpdateAtMs === undefined) {
				serverSub.traceFirstUpdateAtMs = now;
				scannerWsTrace('first-update', common);
			}
		});
		if (matched === 0) {
			scannerWsTrace('unmatched-frame', {
				eventTopic: msgTopic,
				event,
				windowId,
				endCursor,
				delivered,
				rejectedWindow
			});
		}
	}
	wsLog('event:dispatch', { eventTopic: msgTopic, event, delivered, windowId, endCursor });
}

function notifyServerSubscriptionError(serverKey: string | undefined, error: WsErrorInfo) {
	if (!serverKey) return;
	const serverSub = serverSubscriptions.get(serverKey);
	const enriched: WsErrorInfo = {
		...error,
		topic: serverSub?.topic,
		params: serverSub?.params
	};
	for (const sub of subscriptions.values()) {
		if (sub.serverKey === serverKey) {
			sub.onError?.(enriched);
		}
	}
}

function retryServerSubscription(serverKey: string, delayMs: number) {
	const generation = connectionGeneration;
	setTimeout(() => {
		if (generation !== connectionGeneration) return;
		const serverSub = serverSubscriptions.get(serverKey);
		if (!serverSub || !hasLocalSubscribers(serverKey) || serverSub.pendingRequestId || serverSub.subId) return;
		serverSub.failed = false;
		sendSubscribe(serverKey, serverSub);
	}, delayMs);
}

function refetchSubscribers(serverKey: string): Subscription[] {
	return Array.from(subscriptions.values()).filter((sub) => sub.serverKey === serverKey && sub.recovery === 'refetch');
}

function connect() {
	if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

	intentionalClose = false;
	const generation = ++connectionGeneration;
	const ws = new WebSocket(getWsUrl());
	socket = ws;
	setConnectionState('connecting');

	ws.onopen = () => {
		if (generation !== connectionGeneration || socket !== ws) return;
		setConnectionState('open');
		if (!currentAuthToken) {
			const stored = getAuthToken();
			if (stored) currentAuthToken = stored;
		}
		wsLog('connected', { authToken: currentAuthToken ? 'present' : 'none' });
		if (currentAuthToken) {
			wsLog('auth:send', {});
			safeSend(JSON.stringify({ type: 'auth', token: currentAuthToken }));
		}

		serverSubscriptions.forEach((serverSub, key) => {
			const refetch = refetchSubscribers(key);
			if (refetch.length > 0) {
				queueMicrotask(() => {
					if (generation !== connectionGeneration) return;
					for (const sub of refetch) sub.onReconnect?.();
				});
				return;
			}
			if (!serverSub.subId) sendSubscribe(key, serverSub);
		});

		if (pingInterval) clearInterval(pingInterval);
		pingInterval = setInterval(() => {
			startApplicationProbe('periodic');
		}, WS_PROBE_INTERVAL_MS);
		startApplicationProbe('open');
	};

	const processMessage = (raw: string) => {
		if (generation !== connectionGeneration) return;
		let msg: any;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}

		if (msg.type === 'subscribed') {
			if (typeof msg.topic === 'string' && msg.topic.startsWith('user:')) {
				wsLog('subscribe:ack:user-topic', {
					requestId: msg.requestId,
					ackTopic: msg.topic
				});
				return;
			}
			const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
			const serverKey = takePendingServerKey(requestId);
			if (serverKey) {
				const serverSub = serverSubscriptions.get(serverKey);
				wsLog('subscribe:ack', {
					requestId,
					topic: serverSub?.topic,
					paramsKeys: paramsKeys(serverSub?.params),
					ackTopic: msg.topic
				});
				if (serverSub) {
					const ackAtMs = Date.now();
					serverSub.subId = msg.subId;
					serverSub.displayTopic = msg.topic;
					serverSub.pendingRequestId = undefined;
					serverSub.windows = msg.windows && typeof msg.windows === 'object' ? msg.windows : undefined;
					serverSub.failed = false;
					serverSub.traceAckAtMs = ackAtMs;
					subscriptions.forEach((sub) => {
						if (sub.serverKey === serverKey && sub.onSubscribed) {
							try { sub.onSubscribed(); } catch {}
						}
					});
					if (isScannerTopic(serverSub.topic)) {
						scannerWsTrace('subscribe-ack', {
							requestId,
							subId: msg.subId,
							topic: serverSub.topic,
							ackTopic: msg.topic,
							windows: msg.windows,
							msSinceSend: serverSub.traceSentAtMs === undefined ? undefined : ackAtMs - serverSub.traceSentAtMs
						});
					}
				} else {
					safeSend(JSON.stringify({ type: 'unsubscribe', subId: msg.subId }));
				}
			} else if (msg.subId) {
				safeSend(JSON.stringify({ type: 'unsubscribe', subId: msg.subId }));
			}
			return;
		}

		if (msg.type === 'auth_success') {
			wsLog('auth:success', { userId: msg.userId });
			currentUserId = msg.userId ?? null;
			return;
		}

		if (msg.type === 'auth_error') {
			wsLog('auth:error', { message: msg.message });
			return;
		}

		if (msg.type === 'error') {
			const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
			const serverKey = requestId ? pendingAcks.get(requestId) : undefined;
			if (requestId) pendingAcks.delete(requestId);
			if (serverKey) {
				const serverSub = serverSubscriptions.get(serverKey);
				wsLog('error', {
					requestId,
					topic: serverSub?.topic,
					paramsKeys: paramsKeys(serverSub?.params),
					reason: msg.reason,
					message: msg.message
				});
				if (serverSub && serverSub.pendingRequestId === requestId) {
					serverSub.pendingRequestId = undefined;
					serverSub.failed = true;
				}
				const reason = typeof msg.reason === 'string' ? msg.reason as WsErrorReason : undefined;
				notifyServerSubscriptionError(serverKey, {
					message: typeof msg.message === 'string' ? msg.message : undefined,
					reason,
					requestId
				});
				if (reason === 'SEED_TIMEOUT' || reason === 'INTERNAL') {
					retryServerSubscription(serverKey, 3000);
				} else if (reason === 'UNAUTHORIZED' && currentAuthToken) {
					safeSend(JSON.stringify({ type: 'auth', token: currentAuthToken }));
					retryServerSubscription(serverKey, 500);
				}
			}
			return;
		}

		if (msg.type === 'pong') {
			handleApplicationPong(msg.requestId, generation, msg.serverTimestampMs);
			return;
		}

		if (msg.type === 'unsubscribed') {
			return;
		}

		if (msg.topic && msg.event !== undefined) {
			dispatchMessage(msg.topic, msg.event, msg.data, msg.meta);
		}
	};

	ws.onmessage = (event) => {
		const raw = typeof event.data === 'string' ? event.data : String(event.data);
		enqueueInbound(generation, raw, processMessage);
	};

	ws.onclose = (event) => {
		if (generation !== connectionGeneration || socket !== ws) return;
		socket = null;
		lastCloseCode = event.code;
		lastCloseReason = event.reason;
		outstandingPing = null;
		clearRecoveryWatchdog();
		inboundQueue = inboundQueue.slice(inboundQueueHead).filter((item) => item.generation !== generation);
		inboundQueueHead = 0;
		inboundQueueBytes = inboundQueue.reduce((total, item) => total + item.raw.length, 0);
		if (pingInterval) clearInterval(pingInterval);
		pingInterval = null;
		setConnectionState('closed');

		serverSubscriptions.forEach((serverSub) => {
			serverSub.subId = undefined;
			serverSub.displayTopic = undefined;
			serverSub.pendingRequestId = undefined;
			serverSub.windows = undefined;
			serverSub.failed = false;
		});
		pendingAcks.clear();

		scheduleReconnect(event.code);
	};

	ws.onerror = () => {
		if (generation === connectionGeneration) wsLog('socket:error', { generation });
	};
}

function sendSubscribe(serverKey: string, sub: ServerSubscription) {
	if (sub.pendingRequestId || socket?.readyState !== WebSocket.OPEN) return;
	const requestId = `ws_sub_${++requestCounter}`;
	sub.pendingRequestId = requestId;
	sub.failed = false;
	const msg: any = { type: 'subscribe', topic: sub.topic, requestId };
	if (sub.params) msg.params = sub.params;
	if (isScannerTopic(sub.topic)) {
		sub.traceRequestId = requestId;
		sub.traceSentAtMs = Date.now();
		sub.traceAckAtMs = undefined;
		sub.traceFirstFrameAtMs = undefined;
		sub.traceFirstUpdateAtMs = undefined;
		scannerWsTrace('subscribe-send', {
			requestId,
			topic: sub.topic,
			params: sub.params
		});
	}
	safeSend(JSON.stringify(msg));
	pendingAcks.set(requestId, serverKey);
	wsLog('subscribe:send', {
		requestId,
		topic: sub.topic,
		paramsKeys: paramsKeys(sub.params)
	});
}

function ensureConnected() {
	if (typeof window === 'undefined') return;
	if (closeTimeout) {
		clearTimeout(closeTimeout);
		closeTimeout = null;
	}
	if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
		connect();
	}
}

function scheduleClose() {
	if (closeTimeout) clearTimeout(closeTimeout);
	closeTimeout = setTimeout(() => {
		if (subscriptions.size === 0 && socket) {
			intentionalClose = true;
			connectionGeneration++;
			socket.close();
			socket = null;
			if (pingInterval) clearInterval(pingInterval);
			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
				reconnectTimeout = null;
				notifyDiagnostics();
			}
			setConnectionState('closed');
			removeLifecycleHandlers();
		}
		closeTimeout = null;
	}, 2000);
}

export function subscribe(topic: string, handler: MessageHandler, params?: Record<string, any>, options?: SubscribeOptions): string {
	if (options?.recovery === 'refetch' && !options.onReconnect) {
		throw new Error('WebSocket refetch recovery requires onReconnect');
	}
	const key = `sub_${++subCounter}`;
	const localOnly = isUserTopic(topic);
	const sub: Subscription = {
		topic,
		handler,
		params,
		localOnly,
		onError: options?.onError,
		onSubscribed: options?.onSubscribed,
		recovery: options?.recovery ?? 'resubscribe',
		onReconnect: options?.onReconnect
	};
	if (!localOnly) {
		const serverKey = serverKeyFor(topic, params);
		sub.serverKey = serverKey;
		if (!serverSubscriptions.has(serverKey)) {
			serverSubscriptions.set(serverKey, { topic, params });
		}
	}
	subscriptions.set(key, sub);
	installLifecycleHandlers();
	wsLog('subscribe', {
		key,
		topic,
		localOnly,
		paramsKeys: paramsKeys(params)
	});

	ensureConnected();

	if (sub.serverKey) {
		const serverSub = serverSubscriptions.get(sub.serverKey);
		if (socket?.readyState === WebSocket.OPEN) {
			sendSubscribe(sub.serverKey, serverSub!);
		}
	}

	return key;
}

export function getSubscriptionWindows(key: string): Record<string, WsSubscribedWindow> | undefined {
	const sub = subscriptions.get(key);
	if (!sub?.serverKey) return undefined;
	return serverSubscriptions.get(sub.serverKey)?.windows;
}

export function getTopicWindows(topic: string, params?: Record<string, any>): Record<string, WsSubscribedWindow> | undefined {
	return serverSubscriptions.get(serverKeyFor(topic, params))?.windows;
}

export function unsubscribe(key: string) {
	const sub = subscriptions.get(key);
	if (!sub) return;


	subscriptions.delete(key);

	if (sub.serverKey && !hasLocalSubscribers(sub.serverKey)) {
		const serverSub = serverSubscriptions.get(sub.serverKey);
		if (serverSub?.pendingRequestId) pendingAcks.delete(serverSub.pendingRequestId);
		if (serverSub?.subId) {
			safeSend(JSON.stringify({ type: 'unsubscribe', subId: serverSub.subId }));
		}
		serverSubscriptions.delete(sub.serverKey);
	}

	if (subscriptions.size === 0) {
		scheduleClose();
	}
}

export function authenticate(token: string | null) {
	currentAuthToken = token;
	if (!token) {
		currentUserId = null;
		return;
	}
	if (socket?.readyState === WebSocket.OPEN) {
		safeSend(JSON.stringify({ type: 'auth', token }));
	}
}

export function disconnect() {
	intentionalClose = true;
	connectionGeneration++;
	subscriptions.clear();
	serverSubscriptions.clear();
	pendingAcks.clear();
	currentUserId = null;
	outstandingPing = null;
	resetInboundQueue();
	clearRecoveryWatchdog();
	removeLifecycleHandlers();
	if (pingInterval) clearInterval(pingInterval);
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}
	if (closeTimeout) clearTimeout(closeTimeout);
	if (socket) {
		socket.close();
		socket = null;
	}
	setConnectionState('closed');
	notifyDiagnostics();
}
