import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ dev: false, browser: true }));
vi.mock('$lib/stores/auth.svelte', () => ({ getAuthToken: () => null }));
vi.mock('$lib/stores/toast.svelte', () => ({ addToast: () => {} }));

class FakeSocket {
	static OPEN = 1;
	static CONNECTING = 0;
	static last: FakeSocket | null = null;
	readyState = FakeSocket.CONNECTING;
	sent: any[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((e: { data: string }) => void) | null = null;
	onclose: ((e: { code: number; reason: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	constructor() {
		FakeSocket.last = this;
	}
	send(raw: string) {
		this.sent.push(JSON.parse(raw));
	}
	close() {}
	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}
	receive(msg: unknown) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
	ofType(type: string) {
		return this.sent.filter((m) => m.type === type);
	}
}

const TOPIC = 'quote:SOL:Mint111';
const frame = (windowId: string, amount: string) => ({
	topic: TOPIC,
	event: 'TRADE_QUOTE',
	data: { quote: { amountInStr: amount } },
	meta: { windowId }
});

describe('updateParams', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubGlobal('WebSocket', FakeSocket);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	async function setup() {
		const ws = await import('./ws/client');
		const seen: string[] = [];
		const key = ws.subscribe(TOPIC, (_e, data) => seen.push(data.quote.amountInStr), { side: 'BUY', amount: '1' });
		const sock = FakeSocket.last!;
		sock.open();
		const sub = sock.ofType('subscribe')[0];
		sock.receive({ type: 'subscribed', requestId: sub.requestId, subId: 's1', topic: TOPIC, windows: { [TOPIC]: { windowId: 'w1', mode: 'live' } } });
		await vi.waitFor(() => expect(ws.getSubscriptionWindows(key)).toBeDefined());
		return { ws, key, sock, seen };
	}

	it('moves the subscription in place and gates frames on the new window', async () => {
		const { ws, key, sock, seen } = await setup();
		sock.receive(frame('w1', '1'));
		await vi.waitFor(() => expect(seen).toEqual(['1']));

		ws.updateParams(key, { side: 'BUY', amount: '2' });
		const upd = sock.ofType('update_params');
		expect(upd).toEqual([{ type: 'update_params', subId: 's1', params: { side: 'BUY', amount: '2' }, requestId: upd[0].requestId }]);
		expect(sock.ofType('unsubscribe')).toHaveLength(0);
		expect(sock.ofType('subscribe')).toHaveLength(1);

		sock.receive(frame('w1', '1'));
		sock.receive({ type: 'params_updated', requestId: upd[0].requestId, subId: 's1', windows: { [TOPIC]: { windowId: 'w2', mode: 'live' } } });
		sock.receive(frame('w1', '1'));
		sock.receive(frame('w2', '2'));
		await vi.waitFor(() => expect(seen).toEqual(['1', '2']));
	});

	it('falls back to a fresh subscribe when update_params is rejected', async () => {
		const { ws, key, sock } = await setup();
		ws.updateParams(key, { side: 'BUY', amount: '3' });
		const upd = sock.ofType('update_params')[0];
		sock.receive({ type: 'error', requestId: upd.requestId, reason: 'PARAMS_INVALID', message: 'nope' });
		await vi.waitFor(() => expect(sock.ofType('subscribe')).toHaveLength(2));
		expect(sock.ofType('unsubscribe')).toEqual([{ type: 'unsubscribe', subId: 's1' }]);
		expect(sock.ofType('subscribe')[1].params).toEqual({ side: 'BUY', amount: '3' });
	});

	it('resubscribes when the first subscribe is not acknowledged yet', async () => {
		const ws = await import('./ws/client');
		const key = ws.subscribe(TOPIC, () => {}, { side: 'BUY', amount: '1' });
		const sock = FakeSocket.last!;
		sock.open();
		ws.updateParams(key, { side: 'BUY', amount: '5' });
		expect(sock.ofType('update_params')).toHaveLength(0);
		expect(sock.ofType('subscribe').at(-1).params).toEqual({ side: 'BUY', amount: '5' });
	});

	it('resubscribes when another subscriber shares the old params', async () => {
		const { ws, key, sock } = await setup();
		ws.subscribe(TOPIC, () => {}, { side: 'BUY', amount: '1' });
		ws.updateParams(key, { side: 'BUY', amount: '4' });
		expect(sock.ofType('update_params')).toHaveLength(0);
		expect(sock.ofType('unsubscribe')).toHaveLength(0);
		expect(sock.ofType('subscribe').at(-1).params).toEqual({ side: 'BUY', amount: '4' });
	});
});
