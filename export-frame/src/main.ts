import { createExportFrame } from './frame';
import { parseSigners } from './signers';

const meta = document.querySelector('meta[name="export-signer-pubkeys"]');
const signers = parseSigners(meta?.getAttribute('content') ?? '') ?? [];
const root = document.getElementById('app');

if (root && window.parent !== window) {
	const frame = createExportFrame({
		root,
		parent: window.parent,
		signers,
		authOrigin: location.origin,
		post: (message, targetOrigin) => window.parent.postMessage(message, targetOrigin),
		discard: () => location.replace('about:blank')
	});
	window.addEventListener('message', (event) => {
		void frame.receive({ source: event.source, origin: event.origin, data: event.data });
	});
	window.addEventListener('pagehide', () => frame.destroy(), { once: true });
}
