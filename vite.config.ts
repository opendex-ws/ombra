import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

function asyncChunkSkipList(): Plugin {
	const jsonPath = path.resolve('.svelte-kit/async-chunks.json');
	const tsPath = path.resolve('src/lib/generated/async-chunks.ts');

	return {
		name: 'async-chunk-skip-list',
		apply: 'build',
		writeBundle(this: { environment?: { name?: string } }, _opts, bundle) {
			if (this.environment?.name && this.environment.name !== 'client') return;
			const skip = new Set<string>();
			for (const item of Object.values(bundle)) {
				if (item.type !== 'chunk') continue;
				const mods = item.moduleIds ?? [];
				const isAsyncPanel = mods.some(
					(id) =>
						id.includes('/WatchlistPanel.svelte') ||
						id.includes('/TwitterFeedPanel.svelte') ||
						id.includes('/FloatingTokenWindow.svelte') ||
						id.includes('/TraderOverviewDrawer.svelte') ||
						id.includes('/TraderPortfolioModal.svelte') ||
						id.includes('/MobileConnectModal.svelte') ||
						id.includes('/MobileScanModal.svelte') ||
						id.includes('/ThemeBuilderModal.svelte') ||
						id.includes('/PnlShareCard.svelte') ||
						id.includes('/CreateBotModal.svelte') ||
						id.includes('/UserListModal.svelte') ||
						id.includes('lightweight-charts') ||
						id.includes('/jsqr/') ||
						id.includes('/qrcode/') ||
						id.includes('/bs58/')
				);
				if (isAsyncPanel) skip.add(item.fileName.split('/').pop()!);
			}
			if (skip.size === 0) return;
			const list = [...skip].sort();
			fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
			fs.writeFileSync(jsonPath, JSON.stringify(list));
			fs.mkdirSync(path.dirname(tsPath), { recursive: true });
			fs.writeFileSync(
				tsPath,
				`export const ASYNC_CHUNK_FILES = new Set(${JSON.stringify(list)});\n`
			);
		}
	};
}

const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), 'PUBLIC_');
// Same-origin dev proxy — only enabled when PUBLIC_API_PROXY is set (and
// PUBLIC_API_BASE is present). Otherwise the browser calls the backend directly.
// See .env.example.
const API_BASE = (env.PUBLIC_API_BASE ?? '').replace(/\/$/, '');
const API_PROXY = /^(1|true|yes)$/i.test(env.PUBLIC_API_PROXY ?? '');
const WS_BASE = API_BASE.replace(/^http/, 'ws');

/* eslint-disable @typescript-eslint/no-explicit-any */
const stripIdentityHeaders = (proxy: any) => {
	proxy.on('proxyReq', (proxyReq: any) => { proxyReq.removeHeader('origin'); proxyReq.removeHeader('referer'); });
	proxy.on('proxyReqWs', (proxyReq: any) => { proxyReq.removeHeader('origin'); proxyReq.removeHeader('referer'); });
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), asyncChunkSkipList()],
	// Only force browser conditions on the client. Top-level `browser` breaks
	// SSR (e.g. `__SVELTEKIT_APP_VERSION__ is not defined` via $app/env).
	environments: {
		client: {
			resolve: {
				conditions: ['browser']
			}
		}
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./src/lib/test-setup.ts']
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/lightweight-charts')) return 'charts';
					if (id.includes('node_modules/jsqr') || id.includes('node_modules/qrcode')) return 'qr';
					if (id.includes('node_modules/bs58')) return 'bs58';
				}
			}
		}
	},
	// Dev-server proxy: forwards same-origin API requests to your backend so
	// the browser avoids CORS. Targets come from PUBLIC_API_BASE (.env.example).
	server: {
		proxy: API_PROXY && API_BASE
			? {
					// WebSocket first so it isn't shadowed by the generic /v2 rule.
					'/v2/ws': {
						target: WS_BASE,
						changeOrigin: true,
						ws: true,
						configure: stripIdentityHeaders
					},
					'/v2': {
						target: API_BASE,
						changeOrigin: true,
						configure: stripIdentityHeaders
					},
					'/polymarket': {
						target: API_BASE,
						changeOrigin: true,
						configure: stripIdentityHeaders
					},
					'/rpc/sol': {
						target: API_BASE,
						changeOrigin: true,
						configure: stripIdentityHeaders
					}
				}
			: {}
	}
});
