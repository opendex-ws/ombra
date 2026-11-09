import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// Cloudflare Rocket Loader (on for the opendex.ws zone) rewrites <script> tags and runs them
// inline, which the frame's CSP (script-src 'self') blocks: the frame never starts.
// data-cfasync="false" is Cloudflare's per-script opt-out.
const noRocketLoader = {
	name: 'export-frame:no-rocket-loader',
	transformIndexHtml: {
		order: 'post' as const,
		handler: (html: string) => html.replace(/<script(?![^>]*data-cfasync)/g, '<script data-cfasync="false"')
	}
};

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	base: '/auth/wallet-export/',
	publicDir: false,
	plugins: [
		tailwindcss(),
		svelte({ configFile: fileURLToPath(new URL('../svelte.config.js', import.meta.url)) }).map(
			(plugin) => plugin.name === 'vite-plugin-svelte'
				? { ...plugin, name: 'vite-plugin-svelte:config' }
				: plugin
		),
		noRocketLoader
	],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		assetsInlineLimit: 0,
		modulePreload: { polyfill: false },
		rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) }
	}
});
