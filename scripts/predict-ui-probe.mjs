/**
 * Predict UI probe — desktop + mobile screenshots and layout checks.
 * Usage: PREDICT_BASE_URL=http://127.0.0.1:5173 node scripts/predict-ui-probe.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.PREDICT_BASE_URL || 'http://127.0.0.1:4173';
const OUT = process.env.PREDICT_PROBE_OUT || path.join(process.cwd(), 'evidence/predict-llm-dev/probe');

fs.mkdirSync(OUT, { recursive: true });

function overlap(a, b, slop = 1) {
	return a.x < b.x + b.w - slop && a.x + a.w > b.x + slop && a.y < b.y + b.h - slop && a.y + a.h > b.y + slop;
}

async function cardLayoutIssues(page) {
	return page.evaluate((overlapSrc) => {
		const overlapFn = new Function('a', 'b', 'slop', `return (${overlapSrc})(a,b,slop)`);
		const hits = [];
		for (const card of document.querySelectorAll('[data-predict-updown-card]')) {
			const cr = card.getBoundingClientRect();
			if (card.scrollWidth > card.clientWidth + 2) {
				hits.push({ type: 'overflow', w: card.scrollWidth, cw: card.clientWidth });
			}
			const slots = [...card.querySelectorAll('[data-predict-card-slot]')].map((el) => {
				const r = el.getBoundingClientRect();
				return { slot: el.getAttribute('data-predict-card-slot'), x: r.x, y: r.y, w: r.width, h: r.height };
			});
			for (let i = 0; i < slots.length; i++) {
				for (let j = i + 1; j < slots.length; j++) {
					if (overlapFn(slots[i], slots[j], 1)) {
						hits.push({ type: 'overlap', a: slots[i].slot, b: slots[j].slot });
					}
				}
			}
			if (cr.width > 0 && cr.width < 120) hits.push({ type: 'too-narrow', w: cr.width });
		}
		const cards = [...document.querySelectorAll('[data-predict-updown-card]')].map((el) => {
			const r = el.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		});
		for (let i = 0; i < cards.length; i++) {
			for (let j = i + 1; j < cards.length; j++) {
				if (overlapFn(cards[i], cards[j], 2)) hits.push({ type: 'card-overlap', i, j });
			}
		}
		return hits;
	}, overlap.toString());
}

async function openCryptoAll1h(page) {
	await page.locator('[data-predict-chip="topic:crypto"]').click();
	await page.waitForTimeout(400);
	const interval = page.locator('[data-predict-chip="interval:1H"]');
	if (await interval.count()) await interval.click();
	const all = page.locator('[data-predict-chip="market:all"]');
	if (await all.count()) await all.click();
	await page.waitForTimeout(1500);
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const failures = [];

	async function probeDesktop() {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await page.goto(`${BASE}/predict`, { waitUntil: 'networkidle', timeout: 180_000 });
		await page.waitForSelector('[data-predict-root]', { timeout: 120_000 });
		await page.waitForSelector('[data-predict-desktop]', { timeout: 120_000 });
		await page.waitForSelector('[data-predict-browser]', { timeout: 60_000 });
		await page.waitForTimeout(2000);
		await openCryptoAll1h(page);
		await page.waitForSelector('[data-predict-updown-card]', { timeout: 60_000 });
		await page.waitForTimeout(1500);

		const layout = await cardLayoutIssues(page);
		const metrics = await page.evaluate(() => ({
			title: document.title,
			hasBrowser: !!document.querySelector('[data-predict-browser]'),
			hasCards: document.querySelectorAll('[data-predict-updown-card]').length,
			hasPressure: !!document.querySelector('[data-predict-pressure]'),
			hasBbo: !!document.querySelector('[data-predict-bbo]'),
			hasChartPane: !!document.querySelector('[data-predict-pane="chart"]'),
			loading: document.body.innerText.includes('Loading…'),
			dom: document.querySelectorAll('*').length
		}));
		metrics.layout = layout;

		if (metrics.loading) failures.push('desktop: stuck loading');
		if (!metrics.hasBrowser) failures.push('desktop: missing browser');
		if (!metrics.hasBbo) failures.push('desktop: missing BBO');
		if (!metrics.hasChartPane) failures.push('desktop: missing chart pane');
		if (metrics.hasCards === 0) failures.push('desktop: no updown cards');
		if (layout.length) failures.push(`desktop: card layout ${JSON.stringify(layout.slice(0, 8))}`);
		if (metrics.dom > 2500) failures.push(`desktop: dom too heavy (${metrics.dom})`);

		await page.screenshot({ path: path.join(OUT, 'desktop-predict.png'), fullPage: false });
		const browserBox = await page.locator('[data-predict-browser]').boundingBox();
		if (browserBox) {
			await page.screenshot({
				path: path.join(OUT, 'desktop-discover.png'),
				clip: {
					x: Math.max(0, browserBox.x),
					y: Math.max(0, browserBox.y),
					width: Math.min(browserBox.width, 1440),
					height: Math.min(browserBox.height, 900)
				}
			});
		}
		fs.writeFileSync(path.join(OUT, 'desktop-metrics.json'), JSON.stringify(metrics, null, 2));
		await page.close();
		return metrics;
	}

	async function probeMobile() {
		const ctx = await browser.newContext({ ...devices['iPhone 13'] });
		const page = await ctx.newPage();
		await page.goto(`${BASE}/predict`, { waitUntil: 'networkidle', timeout: 180_000 });
		await page.waitForSelector('[data-predict-root]', { timeout: 120_000 });
		await page.waitForSelector('[data-predict-action-row]', { timeout: 60_000 });
		await page.waitForTimeout(1500);
		await page.screenshot({ path: path.join(OUT, 'mobile-predict.png'), fullPage: false });

		await page.locator('[data-predict-header] button').first().click();
		await page.waitForSelector('[data-predict-browser]', { timeout: 30_000 });
		await page.waitForTimeout(800);
		await openCryptoAll1h(page);
		await page.screenshot({ path: path.join(OUT, 'mobile-markets.png'), fullPage: false });

		const cards = await page.locator('[data-predict-updown-card]').count();
		if (cards === 0) failures.push('mobile: no updown cards in browse');
		const layout = await cardLayoutIssues(page);
		if (layout.length) failures.push(`mobile: card layout ${JSON.stringify(layout.slice(0, 8))}`);

		await ctx.close();
	}

	const desktop = await probeDesktop();
	await probeMobile();

	const report = { ok: failures.length === 0, failures, out: OUT, desktop, base: BASE };
	fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));

	await browser.close();

	if (!report.ok) {
		console.error('PREDICT_UI_PROBE_FAIL');
		process.exit(1);
	}
	console.log('PREDICT_UI_PROBE_OK');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
