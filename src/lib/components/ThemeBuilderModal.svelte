<script lang="ts">
	import { portal } from '$lib/actions/portal';
	import { onMount } from 'svelte';
	import Palette from 'lucide-svelte/icons/palette';
	import Wand2 from 'lucide-svelte/icons/wand-2';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Check from 'lucide-svelte/icons/check';
	import Sun from 'lucide-svelte/icons/sun';
	import Moon from 'lucide-svelte/icons/moon';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import ImageIcon from 'lucide-svelte/icons/image';
	import Upload from 'lucide-svelte/icons/upload';
	import X from 'lucide-svelte/icons/x';
	import { setCustomTheme, getCustomSeed, resetToBuiltin, previewTheme, getTheme, initTheme } from '$lib/stores/theme.svelte';
	import { getThemeBg, setThemeBg, clearThemeBg, getCustomWallpapers, addCustomWallpaper, removeCustomWallpaper } from '$lib/stores/themeBg.svelte';

	const BG_FULL = 'auto=format&fit=crop&w=3840&q=80';
	const BG_THUMB = 'auto=format&fit=crop&w=320&q=60';
	const BG_PRESETS: { name: string; id?: string; url?: string }[] = [
		{ name: 'Midnight Blue', id: 'photo-1451187580459-43490279c0fa' },
		{ name: 'Aurora', id: 'photo-1483086431886-3590a88317fe' },
		{ name: 'Nebula', id: 'photo-1462331940025-496dfbfc7564' },
		{ name: 'Deep Space', id: 'photo-1419242902214-272b3f66ee7a' },
		{ name: 'Totoro', url: 'https://r4.wallpaperflare.com/wallpaper/726/707/600/movie-my-neighbor-totoro-satsuki-kusakabe-studio-ghibli-totoro-my-neighbor-totoro-hd-wallpaper-c9e025a1e76f433b6236526265d9d976.jpg' },
		{ name: 'Dusk Guardian', url: 'https://raw.githubusercontent.com/basecamp/omarchy/master/themes/retro-82/backgrounds/2-dusk-guardian.jpg' }
	];

	function bgFull(p: { id?: string; url?: string }): string {
		return p.url ?? `https://images.unsplash.com/${p.id}?${BG_FULL}`;
	}
	function bgThumb(p: { id?: string; url?: string }): string {
		return p.url ?? `https://images.unsplash.com/${p.id}?${BG_THUMB}`;
	}

	let bgUrl = $state('');
	let bgDim = $state(0.55);
	let bgBlur = $state(2);
	let bgAlpha = $state(0.72);

	function syncBgFromStore() {
		const b = getThemeBg();
		bgUrl = b.url;
		bgDim = b.dim;
		bgBlur = b.blur;
		bgAlpha = b.surfaceAlpha;
	}

	function applyBg() {
		setThemeBg({ url: bgUrl.trim(), dim: bgDim, blur: bgBlur, surfaceAlpha: bgAlpha });
	}

	function selectBgPreset(url: string) {
		bgUrl = url;
		applyBg();
	}

	function removeBg() {
		bgUrl = '';
		clearThemeBg();
		syncBgFromStore();
	}

	let uploadError = $state('');
	let uploading = $state(false);
	let showUrlInput = $state(false);
	let urlDraft = $state('');

	async function onBgFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) { uploadError = 'Not an image file'; return; }
		uploadError = '';
		uploading = true;
		try {
			const dataUrl = await downscaleImage(file, 2560, 0.82);
			const wp = addCustomWallpaper(dataUrl, file.name.replace(/\.[^.]+$/, '') || undefined);
			bgUrl = wp.url;
			applyBg();
		} catch {
			uploadError = 'Could not read image';
		} finally {
			uploading = false;
		}
	}

	function addUrlWallpaper() {
		const u = urlDraft.trim();
		if (!u) return;
		const wp = addCustomWallpaper(u);
		bgUrl = wp.url;
		applyBg();
		urlDraft = '';
		showUrlInput = false;
	}

	function downscaleImage(file: File, maxDim: number, quality: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const img = new Image();
				img.onload = () => {
					let { width, height } = img;
					const scale = Math.min(1, maxDim / Math.max(width, height));
					width = Math.round(width * scale);
					height = Math.round(height * scale);
					const canvas = document.createElement('canvas');
					canvas.width = width;
					canvas.height = height;
					const ctx = canvas.getContext('2d');
					if (!ctx) { reject(new Error('no ctx')); return; }
					ctx.drawImage(img, 0, 0, width, height);
					resolve(canvas.toDataURL('image/jpeg', quality));
				};
				img.onerror = () => reject(new Error('img load'));
				img.src = reader.result as string;
			};
			reader.onerror = () => reject(new Error('read'));
			reader.readAsDataURL(file);
		});
	}
	import {
		type ThemeSeed, type HarmonyType,
		hexToHsl, hslToHex,
		seedToVars, autoGenerateSeed, autoGenerateFromTwo, flipSeed,
		DARK_SEED, LIGHT_SEED, PRESETS
	} from '$lib/utils/themeColors';

	let { show = $bindable(false) }: { show: boolean } = $props();

	let seed = $state<ThemeSeed>({ ...DARK_SEED });
	let savedSeed = $state<ThemeSeed | null>(null);
	let autoMode = $state<'one' | 'two'>('one');
	let autoBg = $state('#000000');
	let autoPrimary = $state('#00ff88');
	let autoAccent = $state('#ff4466');
	let autoHarmony = $state<HarmonyType>('split-complementary');
	let activeSection = $state<'manual' | 'auto' | 'presets' | 'background'>('presets');
	let ready = $state(false);

	function seedsMatch(a: ThemeSeed, b: ThemeSeed): boolean {
		return a.bg === b.bg && a.green === b.green && a.red === b.red && a.isDark === b.isDark;
	}

	function activePresetName(): string | null {
		for (const p of PRESETS) {
			if (seedsMatch(seed, p.dark)) return p.name + '-dark';
			if (seedsMatch(seed, p.light)) return p.name + '-light';
		}
		return null;
	}

	$effect(() => {
		if (show && !ready) {
			const existing = getCustomSeed();
			if (existing) seed = { ...existing };
			else seed = getTheme() === 'light' ? { ...LIGHT_SEED } : { ...DARK_SEED };
			savedSeed = { ...seed };
			syncBgFromStore();
			ready = true;
		}
		if (!show) ready = false;
	});

	$effect(() => {
		const s = seed;
		if (ready) {
			previewTheme(s);
		}
	});

	function apply() {
		setCustomTheme({ ...seed });
		show = false;
	}

	function cancel() {
		if (savedSeed) {
			const wasCustom = getCustomSeed();
			if (wasCustom) previewTheme(wasCustom);
			else initTheme();
		}
		show = false;
	}

	function reset(mode: 'dark' | 'light') {
		resetToBuiltin(mode);
		seed = mode === 'dark' ? { ...DARK_SEED } : { ...LIGHT_SEED };
	}

	function loadPreset(presetSeed: ThemeSeed) {
		seed = { ...presetSeed };
		previewTheme(seed);
	}

	function presetVariant(preset: typeof PRESETS[0]): ThemeSeed {
		return seed.isDark ? preset.dark : preset.light;
	}

	function generateAuto() {
		const isDark = hexToHsl(autoBg).l < 50;
		if (autoMode === 'one') {
			seed = { ...autoGenerateSeed(autoPrimary, isDark), bg: autoBg };
		} else {
			seed = { ...autoGenerateFromTwo(autoPrimary, autoAccent, isDark), bg: autoBg };
		}
	}

	function randomHue(): string {
		return hslToHex(Math.floor(Math.random() * 360), 80 + Math.floor(Math.random() * 20), seed.isDark ? 50 : 40);
	}

	function randomize() {
		autoPrimary = randomHue();
		autoAccent = randomHue();
		const isDark = Math.random() > 0.3;
		autoBg = isDark ? hslToHex(Math.floor(Math.random() * 360), Math.floor(Math.random() * 20), Math.floor(Math.random() * 8)) : hslToHex(Math.floor(Math.random() * 360), Math.floor(Math.random() * 15), 95 + Math.floor(Math.random() * 5));
		generateAuto();
	}

	const colorFields: { key: keyof ThemeSeed; label: string; desc: string }[] = [
		{ key: 'bg', label: 'Background', desc: 'Base surface color' },
		{ key: 'green', label: 'Positive', desc: 'Buy, gains, success' },
		{ key: 'red', label: 'Negative', desc: 'Sell, losses, errors' },
		{ key: 'yellow', label: 'Warning', desc: 'Alerts, pending, stars' },
		{ key: 'blue', label: 'Info', desc: 'Links, info badges' },
		{ key: 'orange', label: 'Accent', desc: 'Filled targets, highlights' },
		{ key: 'pink', label: 'Favourite', desc: 'Hearts, favourites' },
	];

	const harmonyOptions: { value: HarmonyType; label: string }[] = [
		{ value: 'split-complementary', label: 'Split' },
		{ value: 'complementary', label: 'Complement' },
		{ value: 'analogous', label: 'Analogous' },
		{ value: 'triadic', label: 'Triadic' },
	];

	function surfacePreview(): string[] {
		const vars = seedToVars(seed);
		return Array.from({ length: 10 }, (_, i) => vars[`--t-s${i}`]);
	}

	function grayPreview(): string[] {
		const vars = seedToVars(seed);
		return Array.from({ length: 11 }, (_, i) => vars[`--t-g${i + 1}`]);
	}
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div use:portal class="fixed inset-0 z-[200] flex items-center justify-center bg-s0/60 backdrop-blur-[2px] p-2 md:p-4" onclick={(e) => { if (e.target === e.currentTarget) cancel(); }}>
		<div class="flex h-[85vh] md:h-[80vh] w-full max-w-md flex-col rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl" onclick={(e) => e.stopPropagation()}>
			<div class="flex shrink-0 items-center justify-between border-b border-bd px-4 py-3">
				<div class="flex items-center gap-2">
					<Palette class="h-4 w-4 text-grn" strokeWidth={1.5} />
					<span class="text-sm font-bold text-tx">Theme Builder</span>
				</div>
				<div class="flex items-center gap-1.5">
					<button onclick={() => {
						const active = activePresetName();
						if (active) {
							const name = active.replace(/-dark$|-light$/, '');
							const preset = PRESETS.find(p => p.name === name);
							if (preset) {
								loadPreset(seed.isDark ? preset.light : preset.dark);
								return;
							}
						}
						seed = flipSeed(seed);
						previewTheme(seed);
					}} class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-bd bg-s4 text-g7 transition-colors hover:text-tx">
						{#if seed.isDark}<Moon class="h-3.5 w-3.5" strokeWidth={1.5} />{:else}<Sun class="h-3.5 w-3.5" strokeWidth={1.5} />{/if}
					</button>
					<button onclick={() => reset('dark')} class="cursor-pointer rounded-lg border border-bd bg-s4 px-2 py-1 text-[10px] text-g7 transition-colors hover:text-tx">
						<RotateCcw class="inline h-3 w-3" strokeWidth={2} />
					</button>
					<button onclick={cancel} class="cursor-pointer text-g4 transition-colors hover:text-tx">
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>

			<div class="flex-1 flex flex-col overflow-hidden px-4 py-3 space-y-3">
				<div class="shrink-0 flex gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
				{#each [{ id: 'presets' as const, label: 'Presets', icon: Sparkles }, { id: 'auto' as const, label: 'Generate', icon: Wand2 }, { id: 'manual' as const, label: 'Manual', icon: Palette }, { id: 'background' as const, label: 'Background', icon: ImageIcon }] as tab}
					{@const Icon = tab.icon}
					<button
						onclick={() => (activeSection = tab.id)}
						class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-medium transition-colors {activeSection === tab.id ? 'text-tx bg-s7' : 'text-g5 hover:text-g9'}"
					>
						<Icon class="h-3 w-3" strokeWidth={1.5} />
						{tab.label}
					</button>
				{/each}
				</div>

				{#if activeSection === 'presets'}
					<div class="space-y-1.5 overflow-y-auto min-h-0 flex-1">
						{#each PRESETS as preset (preset.name)}
							{@const shown = presetVariant(preset)}
							{@const vars = seedToVars(shown)}
							{@const active = seedsMatch(seed, shown)}
							<div class="flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors {active ? 'border-grn/40 bg-grn/10' : 'border-bd bg-s1'}">
								<button
									onclick={() => loadPreset(shown)}
									class="flex flex-1 cursor-pointer items-center gap-2.5 text-left transition-all hover:opacity-80"
								>
									<div class="flex gap-px rounded overflow-hidden ring-1 ring-bd">
										{#each [vars['--t-s0'], vars['--t-s5'], vars['--t-grn'], vars['--t-red'], vars['--t-blu'], vars['--t-yel']] as c}
											<div class="h-6 w-3" style="background: {c}"></div>
										{/each}
									</div>
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1.5">
											<span class="text-xs font-semibold text-tx">{preset.name}</span>
											{#if active}<Check class="h-3 w-3 text-grn" strokeWidth={2.5} />{/if}
										</div>
										<div class="text-[9px] text-g5">{shown.isDark ? 'Dark' : 'Light'}</div>
									</div>
								</button>
								<button
									onclick={() => loadPreset(shown.isDark ? preset.light : preset.dark)}
									class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-bd bg-s4 text-g6 transition-colors hover:text-tx"
									title="Switch to {shown.isDark ? 'light' : 'dark'}"
								>
									{#if shown.isDark}<Sun class="h-3.5 w-3.5" strokeWidth={1.5} />{:else}<Moon class="h-3.5 w-3.5" strokeWidth={1.5} />{/if}
								</button>
							</div>
						{/each}
					</div>
				{:else if activeSection === 'auto'}
					<div class="space-y-3">
						<div class="flex gap-1">
							<button onclick={() => (autoMode = 'one')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-[11px] font-medium transition-colors {autoMode === 'one' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">1 Color</button>
							<button onclick={() => (autoMode = 'two')} class="flex-1 cursor-pointer rounded-lg border py-1.5 text-[11px] font-medium transition-colors {autoMode === 'two' ? 'border-tx text-tx' : 'border-bd text-g6 hover:text-g9'}">2 Colors</button>
						</div>

						<div class="space-y-2">
							<div>
								<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Background</span>
								<div class="flex items-center gap-2">
									<label class="relative flex h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-bd" style="background: {autoBg}">
										<input type="color" bind:value={autoBg} class="absolute inset-0 cursor-pointer opacity-0" />
									</label>
									<input type="text" bind:value={autoBg} class="flex-1 rounded-lg border border-bd bg-s4 px-2 py-1 font-mono text-[11px] text-tx outline-none" />
									<span class="text-[9px] text-g4">{hexToHsl(autoBg).l < 50 ? 'Dark' : 'Light'}</span>
								</div>
							</div>
							<div class="flex gap-2">
								<div class="flex-1">
									<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Primary</span>
									<div class="flex items-center gap-2">
										<label class="relative flex h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-bd" style="background: {autoPrimary}">
											<input type="color" bind:value={autoPrimary} class="absolute inset-0 cursor-pointer opacity-0" />
										</label>
										<input type="text" bind:value={autoPrimary} class="flex-1 rounded-lg border border-bd bg-s4 px-2 py-1 font-mono text-[11px] text-tx outline-none" />
									</div>
								</div>
								{#if autoMode === 'two'}
									<div class="flex-1">
										<span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-g5">Accent</span>
										<div class="flex items-center gap-2">
											<label class="relative flex h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-bd" style="background: {autoAccent}">
												<input type="color" bind:value={autoAccent} class="absolute inset-0 cursor-pointer opacity-0" />
											</label>
											<input type="text" bind:value={autoAccent} class="flex-1 rounded-lg border border-bd bg-s4 px-2 py-1 font-mono text-[11px] text-tx outline-none" />
										</div>
									</div>
								{/if}
							</div>
						</div>

						{#if autoMode === 'one'}
							<div class="flex gap-0.5 rounded-lg border border-bd bg-s4 p-0.5">
								{#each harmonyOptions as opt}
									<button onclick={() => (autoHarmony = opt.value)} class="flex-1 cursor-pointer rounded-md py-1 text-[10px] font-medium transition-colors {autoHarmony === opt.value ? 'text-tx bg-s7' : 'text-g5 hover:text-g9'}">{opt.label}</button>
								{/each}
							</div>
						{/if}

						<div class="flex gap-2">
							<button onclick={generateAuto} class="flex-1 cursor-pointer rounded-lg bg-grn py-2 text-xs font-semibold text-s0 transition-all">
								<Wand2 class="mr-1 inline h-3.5 w-3.5" strokeWidth={2} />Generate
							</button>
							<button onclick={randomize} class="cursor-pointer rounded-lg border border-bd bg-s4 px-3 py-2 text-g7 transition-colors hover:text-tx">
								<Sparkles class="h-3.5 w-3.5" strokeWidth={2} />
							</button>
						</div>
					</div>
				{:else if activeSection === 'manual'}
					<div class="space-y-1.5 overflow-y-auto min-h-0 flex-1">
						{#each colorFields as field}
							{@const val = seed[field.key] as string}
							<div class="flex items-center gap-2.5 rounded-lg border border-bd bg-s1 px-3 py-2">
								<label class="relative flex h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-bd" style="background: {val}">
									<input type="color" value={val} oninput={(e) => { (seed as any)[field.key] = e.currentTarget.value; }} class="absolute inset-0 cursor-pointer opacity-0" />
								</label>
								<div class="flex-1 min-w-0">
									<div class="text-xs font-medium text-tx">{field.label}</div>
									<div class="text-[9px] text-g5">{field.desc}</div>
								</div>
								<input type="text" value={val} oninput={(e) => { (seed as any)[field.key] = e.currentTarget.value; }} class="w-[72px] rounded border border-bd bg-s4 px-1.5 py-0.5 font-mono text-[10px] text-tx outline-none" />
							</div>
						{/each}
					</div>
				{/if}

				{#if activeSection === 'background'}
					<div class="space-y-3 overflow-y-auto min-h-0 flex-1">
						<div>
							<div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-g5">Wallpaper</div>
							<div class="grid grid-cols-2 gap-1.5">
								{#each BG_PRESETS as p}
									{@const full = bgFull(p)}
									<button
										onclick={() => selectBgPreset(full)}
										class="group relative h-16 cursor-pointer overflow-hidden rounded-lg border transition-colors {bgUrl === full ? 'border-grn' : 'border-bd hover:border-g5'}"
									>
										<img src={bgThumb(p)} alt={p.name} class="h-full w-full object-cover" loading="lazy" />
										<span class="absolute inset-x-0 bottom-0 bg-s0/70 px-1.5 py-0.5 text-left text-[9px] font-medium text-tx">{p.name}</span>
										{#if bgUrl === full}
											<span class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-grn text-s0"><Check class="h-2.5 w-2.5" strokeWidth={3} /></span>
										{/if}
									</button>
								{/each}
								{#each getCustomWallpapers() as wp (wp.id)}
									<div class="group relative h-16 overflow-hidden rounded-lg border transition-colors {bgUrl === wp.url ? 'border-grn' : 'border-bd hover:border-g5'}">
										<button onclick={() => { bgUrl = wp.url; applyBg(); }} class="block h-full w-full cursor-pointer">
											<img src={wp.url} alt={wp.name} class="h-full w-full object-cover" loading="lazy" />
											<span class="absolute inset-x-0 bottom-0 bg-s0/70 px-1.5 py-0.5 text-left text-[9px] font-medium text-tx">{wp.name}</span>
											{#if bgUrl === wp.url}
												<span class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-grn text-s0"><Check class="h-2.5 w-2.5" strokeWidth={3} /></span>
											{/if}
										</button>
										<button onclick={() => { if (bgUrl === wp.url) removeBg(); removeCustomWallpaper(wp.id); }} class="absolute left-1 top-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-s0/70 text-g5 opacity-0 transition-opacity hover:text-red group-hover:opacity-100" title="Delete"><X class="h-2.5 w-2.5" strokeWidth={2.5} /></button>
									</div>
								{/each}
								<label class="flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-bd bg-s4/40 text-g5 transition-colors hover:border-g5 hover:text-tx">
									<Upload class="h-4 w-4" strokeWidth={1.5} />
									<span class="text-[9px] font-medium">{uploading ? 'Processing…' : 'Upload'}</span>
									<input type="file" accept="image/*" class="hidden" onchange={onBgFileChange} disabled={uploading} />
								</label>
							</div>
							{#if uploadError}
								<div class="mt-1 text-[10px] text-red">{uploadError}</div>
							{/if}
							{#if showUrlInput}
								<div class="mt-1.5 flex gap-1.5">
									<input type="text" bind:value={urlDraft} placeholder="Paste image URL…" onkeydown={(e) => { if (e.key === 'Enter') addUrlWallpaper(); }} class="min-w-0 flex-1 rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none" />
									<button onclick={addUrlWallpaper} class="btn-primary shrink-0 px-3 py-1.5 text-xs">Add</button>
								</div>
							{:else}
								<button onclick={() => (showUrlInput = true)} class="mt-1.5 text-[10px] text-g5 underline transition-colors hover:text-g8">or add from URL</button>
							{/if}
						</div>

						{#if bgUrl}
							<div class="space-y-2.5 rounded-lg border border-bd bg-s2 p-2.5">
								<div>
									<div class="mb-1 flex items-center justify-between text-[10px] text-g6"><span>Panel opacity</span><span class="text-g8">{Math.round(bgAlpha * 100)}%</span></div>
									<input type="range" min="0.3" max="1" step="0.02" bind:value={bgAlpha} oninput={applyBg} class="slider-input w-full" />
								</div>
								<div>
									<div class="mb-1 flex items-center justify-between text-[10px] text-g6"><span>Image dim</span><span class="text-g8">{Math.round(bgDim * 100)}%</span></div>
									<input type="range" min="0" max="0.9" step="0.02" bind:value={bgDim} oninput={applyBg} class="slider-input w-full" />
								</div>
								<div>
									<div class="mb-1 flex items-center justify-between text-[10px] text-g6"><span>Image blur</span><span class="text-g8">{bgBlur}px</span></div>
									<input type="range" min="0" max="12" step="1" bind:value={bgBlur} oninput={applyBg} class="slider-input w-full" />
								</div>
							</div>
							<button onclick={removeBg} class="btn-secondary w-full px-3 py-1.5 text-xs">Remove Background</button>
						{:else}
							<div class="rounded-lg border border-dashed border-bd bg-s4/40 px-3 py-4 text-center text-[11px] text-g5">Pick a wallpaper or paste an image URL. Panels turn translucent so it shows through.</div>
						{/if}
					</div>
				{/if}

				{#if activeSection !== 'background'}
				<div class="shrink-0">
					<div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-g5">Ramps</div>
					<div class="space-y-1.5">
						<div class="flex overflow-hidden rounded-lg ring-1 ring-bd">
							{#each surfacePreview() as c}
								<div class="h-5 flex-1" style="background: {c}"></div>
							{/each}
						</div>
						<div class="flex overflow-hidden rounded-lg ring-1 ring-bd">
							{#each grayPreview() as c}
								<div class="h-5 flex-1" style="background: {c}"></div>
							{/each}
						</div>
						<div class="flex gap-0.5">
							{#each [seed.green, seed.red, seed.yellow, seed.blue, seed.orange, seed.pink] as c}
								<div class="h-5 flex-1 rounded" style="background: {c}"></div>
							{/each}
						</div>
					</div>
				</div>
				{/if}

				<div>
					<div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-g5">Preview</div>
					<div class="rounded-lg border border-bd bg-s2 p-2.5 space-y-1.5 text-[10px]">
						<div class="flex items-center gap-2">
							<span class="w-7 font-bold text-grn">BUY</span>
							<span class="text-tx">$0.0₄1234</span>
							<span class="text-g4">15,000</span>
							<span class="ml-auto text-g4">2m ago</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="w-7 font-bold text-red">SELL</span>
							<span class="text-tx">$0.0₃5678</span>
							<span class="text-g4">7,500</span>
							<span class="rounded bg-grn/10 px-1 py-px text-[9px] text-grn">TP</span>
							<span class="ml-auto text-g4">1m ago</span>
						</div>
						<div class="flex gap-1.5 pt-1">
							<button class="flex-1 rounded bg-grn py-1.5 text-[10px] font-bold text-s0">Buy</button>
							<button class="flex-1 rounded bg-red py-1.5 text-[10px] font-bold text-s0">Sell</button>
						</div>
						<div class="flex items-center gap-1.5 pt-0.5">
							<span class="rounded bg-yel/10 px-1 py-px text-[9px] text-yel">Warning</span>
							<span class="rounded bg-blu/10 px-1 py-px text-[9px] text-blu">Info</span>
							<span class="rounded bg-org/10 px-1 py-px text-[9px] text-org">Filled</span>
							<span class="rounded bg-pnk/10 px-1 py-px text-[9px] text-pnk">Fav</span>
						</div>
					</div>
				</div>
			</div>

			<div class="shrink-0 flex gap-2 border-t border-bd px-4 py-3">
				<button onclick={apply} class="flex-1 cursor-pointer rounded-lg bg-grn py-2 text-xs font-bold text-s0 transition-all">
					<Check class="mr-1 inline h-3.5 w-3.5" strokeWidth={2.5} />Apply
				</button>
				<button onclick={cancel} class="btn-secondary px-4 py-2 text-xs">
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
