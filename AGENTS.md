# AGENTS.md

> **Keep this file up to date.** When you discover new patterns, gotchas, or architectural changes during a session, update this file before finishing. If you see any styling inconsistency while working on a task, fix it immediately.

## Project Overview

Svelte 5 + SvelteKit crypto trading terminal ("OMBRA") for Solana/ETH/BASE/BSC tokens. Deployed to **Cloudflare Workers** via `@sveltejs/adapter-cloudflare`. Backend API proxied through Vite (dev) and `hooks.server.ts` (prod).

## Commands

| Task | Command |
|------|---------|
| Dev server | `pnpm dev` |
| Build | `pnpm build` |
| Type check | `pnpm check` |
| Deploy to Cloudflare | `pnpm deploy:cf` |
| Regenerate OpenAPI types | `npx openapi-typescript ../backend/opendex.v2.openapi.yaml -o src/lib/api/v2.d.ts` |

There is **no linter configured**. Lightweight component and utility tests run
with Vitest and Testing Library via `pnpm test`; CI uses `pnpm test:ci` to emit
JUnit evidence. Typecheck with `pnpm check` after every change.

## Tech Stack

- **Svelte 5** (runes: `$state`, `$derived`, `$effect`, `$props`, `$bindable`, `{#snippet}`)
- **SvelteKit** with Cloudflare Workers adapter
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no `tailwind.config` file)
- **openapi-fetch** + **openapi-typescript** for typed API calls
- **lightweight-charts v5** for candlestick/volume charts
- **lucide-svelte** for icons, **simple-icons** for brand SVGs, `DexPaidIcon.svelte` for the dex-paid eagle
- **bs58** for Phantom wallet signature encoding
- **pnpm** as package manager

## File Structure

```
src/
├── app.css                    # Theme vars (@theme block + :root + [data-theme="light"]), global styles
├── app.html                   # HTML shell with blocking theme script
├── lib/
│   ├── api/
│   │   ├── v2.d.ts            # AUTO-GENERATED from ../backend/opendex.v2.openapi.yaml — DO NOT EDIT
│   │   ├── client.ts          # openapi-fetch client + auth/refresh middleware
│   │   └── types.ts           # Re-exports from client.ts
│   ├── components/
│   │   ├── index.ts           # Barrel export
│   │   ├── Navbar.svelte      # Top nav: search, wallet popover, theme builder trigger
│   │   ├── TokenList.svelte   # Sidebar compact token list
│   │   ├── TokenListItem.svelte
│   │   ├── TokenRow.svelte    # Scanner table row
│   │   ├── TokenTable.svelte  # Virtual-scroll scanner table
│   │   ├── TokenDetail.svelte # Token detail: chart, trades, holders, safety
│   │   ├── TokenStats.svelte  # Timeframe stats
│   │   ├── TokenChart.svelte  # TradingView chart with WS candle updates, area gradient
│   │   ├── MobileTokenCard.svelte  # Scanner mobile card with sparkline bg
│   │   ├── MemescopeCard.svelte
│   │   ├── TradePanel.svelte  # Buy/sell form
│   │   ├── PositionsPanel.svelte  # Positions, orders, history with swap lines
│   │   ├── WatchlistPanel.svelte  # Watchlist: callers, telegram, lists, wallets
│   │   ├── TwitterFeedPanel.svelte  # X feed widget below watchlist (collapse/hide via feSettings)
│   │   ├── CreateBotModal.svelte  # Bot creation/editing
│   │   ├── ThemeBuilderModal.svelte  # Theme customization modal
│   │   ├── DexPaidIcon.svelte # Reusable dex-paid eagle SVG icon
│   │   ├── TokenTabPreview.svelte # Hover mini-chart sparkline for token tabs (reads candleCache)
│   │   ├── FloatingTokenWindow.svelte # Popped-out token window (chart + header + mini buy/sell, drag/resize/z-order)
│   │   ├── MobileConnectModal.svelte  # Desktop QR for mobile connect
│   │   ├── MobileScanModal.svelte     # Phone QR scanner for mobile connect
│   │   ├── UserListModal.svelte
│   │   ├── SourcePicker.svelte
│   │   ├── ToastContainer.svelte
│   │   └── trader-analytics/     # Rankings, token trader drawer/chart, portfolio modal
│   ├── stores/
│   │   ├── auth.svelte.ts     # Wallet auth (challenge → signin), JWT refresh
│   │   ├── theme.svelte.ts    # Theme mode (dark/light/custom), custom seed, preview
│   │   ├── currency.svelte.ts # USD/native toggle
│   │   ├── feSettings.svelte.ts # FE-only settings (expandPositions, bubbleWatchlist + multiTab beta)
│   │   ├── tokenTabs.svelte.ts # Multi-tab token list + floating popout windows (z-order, focus, persistence)
│   │   ├── candleCache.svelte.ts # Shared close-price series + live mcap per token (TokenChart writes, hover preview reads)
│   │   ├── settings.svelte.ts # User settings + favourites (API-backed)
│   │   ├── trade.svelte.ts    # Trade state (+ quickBuy/quickSell for popouts, per-token loading)
│   │   ├── peg.svelte.ts      # SOL/ETH peg price via WebSocket
│   │   ├── toast.svelte.ts    # Toast notification queue
│   │   ├── tick.svelte.ts     # 1-second interval for live age display
│   │   ├── chart.svelte.ts    # Chart frame/marketcap toggle
│   │   └── traderAnalytics.svelte.ts # Shared trader drawer/modal targets
│   ├── ws/
│   │   └── client.ts          # WebSocket client (pub/sub, reconnect, auth)
│   └── utils/
│       ├── format.ts          # Number/price/time/address formatting, fmtVal/fmtPrice
│       ├── themeColors.ts     # HSL math, ramp generators, color theory, presets
│       ├── scanner-ws.ts      # Scanner WS event processing
│       └── routers.ts         # DEX platform name/icon/color mapping
└── routes/
    ├── +layout.svelte         # Root layout: Navbar, ToastContainer, mobile bottom bars, positions/watchlist sheets
    ├── +page.svelte           # Main terminal (sidebar + detail + trade)
    ├── scanner/+page.svelte   # Full scanner with filters
    ├── memescope/+page.svelte # Bonding curve tracker
    ├── autobuys/+page.svelte  # Bot management + caller leaderboard
    ├── trader-analytics/+page.svelte # Wallet performance ranking
    └── profile/+page.svelte   # User profile, wallets, settings, referrals, social
```

## Theming System

### Architecture
- CSS variables defined in `app.css` under `:root` (dark) and `[data-theme="light"]`
- Tailwind v4 `@theme` block maps `--color-*` to `--t-*` variables
- Custom themes generate all 40 vars from a `ThemeSeed` (8 user colors + isDark flag)
- `themeColors.ts` has ramp generators: surfaces (10), grays (11), borders (3), accent shades
- Blocking script in `app.html` reads pre-computed vars from `ombra_custom_vars` localStorage to prevent flash
- `ThemeBuilderModal` opens from the Navbar sun/moon icon

### Theme Variables (40 total)
| Group | Vars | Purpose |
|-------|------|---------|
| Surfaces | `s0`–`s9` | Background layers, s0 = page bg |
| Borders | `bd`, `bd2`, `bd3` | Border shades, derived from surface range |
| Grays | `g1`–`g11` | Text/icon gray scale |
| Text | `tx`, `wh` | Primary text, contrast (white in dark, black in light) |
| Green | `grn`, `grn-dim`, `grn-dark`, `grn-darker` | Positive/buy/success |
| Red | `red`, `red-bright`, `red-light`, `red-light2`, `red-dark` | Negative/sell/error |
| Accents | `yel`, `yel-dark`, `blu`, `blu-light`, `org`, `pnk` | Warning, info, accent, favourite |

### localStorage Keys for Theme
- `ombra_theme` — `'dark'` | `'light'` | `'custom'`
- `ombra_custom_theme` — JSON `ThemeSeed`
- `ombra_custom_vars` — JSON of all 40 computed CSS vars (for flash-free load)
- `ombra_bg` — JSON `ThemeBg` (`{ url, dim, blur, surfaceAlpha }`) — chat-style wallpaper (independent of color theme)

### Background wallpaper (`themeBg.svelte.ts`)
- Separate from `ThemeSeed`/color themes — works with any theme. `initThemeBg()` on layout mount; `getThemeBg`/`setThemeBg`/`clearThemeBg`.
- Applies CSS vars to `<html>`: `--bg-image`, `--bg-dim`, `--bg-blur`, `--surface-alpha`, plus `data-bg="on"` attr.
- `app.css` `html[data-bg="on"]`: `body::before` paints the image (blurred, scaled 1.06), `body::after` is the dim overlay, and `--color-s0`/`--color-s1` are overridden to `color-mix(... transparent)` so all `bg-s0`/`bg-s1` containers turn translucent automatically. Body bg goes transparent so the image shows.
- Anti-flash: `app.html` blocking script reads `ombra_bg` and applies the vars + `data-bg` pre-render (same pattern as `ombra_custom_vars`).
- UI: ThemeBuilderModal "Background" tab (wallpaper presets, custom URL, panel-opacity/dim/blur sliders). Applied live+persisted immediately (not gated by the modal's Apply/Cancel, which only handle color seed).

## Styling Rules

**These rules are mandatory. If you see violations while working on any task, fix them immediately.**

### Colors — NEVER Hardcode
- **NEVER** use hardcoded hex colors (`#00ff88`, `#ff4466`, etc.) or `rgba()` in templates
- **ALWAYS** use theme variables: `text-grn`, `bg-red`, `border-bd`, etc.
- For inline `style=` attributes use `var(--t-grn)`, `var(--t-s5)`, etc.
- Exception: QR code colors in MobileConnectModal (must be literal `#000000`/`#ffffff` for scanability)
- Conic gradients for bonding curve progress: `conic-gradient(var(--t-grn) ...deg, var(--t-bd2) ...deg)`
- Graduated token borders: `var(--t-yel)`

### Surface Hierarchy — ELEVATION LAYERS (pick by role, not by shade)
Every background maps to a semantic elevation layer. The wallpaper contract in `app.css` (`html[data-bg="on"]`) makes layers ≤ L3 translucent, L4 near-solid, and L5+ fully opaque — so using the wrong shade breaks under a wallpaper.

| Layer | Shade | Role |
|-------|-------|------|
| L0/L1 Base·Panel | `bg-s0` | page, route roots, sidebars, terminal columns, nav bars (translucent under wallpaper) |
| L2 Card | `bg-s1` | token/position cards, list-row containers, memescope cards |
| L3 Sunken | `bg-s2` | inner detail boxes, nested info panels, header stat boxes |
| L4 Control | `bg-s4` | inputs, selects, pill-group tracks, avatar placeholders (near-solid) |
| L5 Floating | `bg-s5` | **OPAQUE** — popovers, dropdowns, modals, mobile sheets, popout windows, tooltips, any `shadow-2xl`/`fixed`/`absolute` menu |
| Chip | `bg-s6`/`bg-s7` | **OPAQUE** — small badges, count chips, image-overlay badges (`bg-s6`), avatar/icon placeholders + tags (`bg-s7`) |
| Backdrop | `bg-s0/60` + `backdrop-blur-[2px]` | modal dim scrim |

**Hard rules**: anything that floats over content MUST be `bg-s5` (opaque). Inputs are always `bg-s4` (or `bg-transparent` inside a bordered wrapper). Image-overlay badges/rings are `bg-s6`/`ring-s6`, never `bg-s0`.

**Hovers — only two conventions**:
- **Rows / list items / cards** → `hover:bg-wh/5` (wallpaper-aware, subtle glass wash — the ONLY row/card hover)
- **Icon buttons / small controls** → `hover:bg-s7` (opaque; `bg-s7` chips hover to `hover:bg-s6`)
- Selected/active states keep their accent tint (`bg-grn/10`, `border-tx`, etc.)

### Minimal token vocabulary — NEVER introduce a new shade/alpha
The palette is deliberately small. Snap to the nearest existing token; do not invent new alpha values.
- **Surfaces**: only `s0 s1 s2 s4 s5 s6 s7` (no `s3/s8/s9`). Surface-alpha roles: `bg-s0/60` (backdrop scrim), `bg-s0/70` (label on image), `bg-s0/90`·`/95`·`bg-s1/95` (sticky nav bars, blurred), `bg-s1/60` (gate overlays), `bg-s4/40` (faint decorative bar/cell), `bg-s4/90` (content-covering loader).
- **Accent fills** (`grn red yel blu org pnk tx`): 3 tiers only — `/10` faint (status badge), `/20` soft (selected/hover), `/35` strong (emphasis). Solid button hover = `/90` or solid.
- **White overlays**: `bg-wh/5` (row hover), `bg-wh/10`·`/20` (selected/emphasis fills).
- **Accent borders + rings**: 2 tiers only — `/20` soft, `/40` strong.
- **Surface border**: `border-bd` (one shade); interaction-brighten via `hover:border-bd3` / `focus:border-bd3`. `bg-bd2` only for toggle-off knob track.
- The `app.css` wallpaper block boosts each accent tier once so it reads over the wallpaper — new stray values won't get boosted.

**Glass utility**: `.glass` (6px) / `.glass-strong` (12px) add `backdrop-filter: blur` and are no-ops without a wallpaper. Apply to LARGE translucent containers sitting directly on the wallpaper (watchlist sidebar, terminal columns, popout windows, slide-in drawers) so the wallpaper reads as frosted glass. Do NOT stack on nested surfaces.

**⚠ `backdrop-filter` creates a containing block for `position: fixed` descendants.** Any `fixed` popover positioned with viewport coordinates (`left: rect.left`) that lives inside a `.glass` container will be OFFSET by the container's position. Such popovers/hover-cards MUST be `use:portal`'d to `<body>` (e.g. TokenDetail calls popover, the token-tab hover preview). `absolute`-positioned menus anchored to a relative parent are unaffected.

### Modal Standards
- **Backdrop**: `bg-s0/60 backdrop-blur-[2px]`
- **Body**: `rounded-2xl border border-bd bg-s5 shadow-2xl backdrop-blur-xl`
- **Destructive modals**: `border-red/20` instead of `border-bd`
- **Close button**: `cursor-pointer text-g4 transition-colors hover:text-tx` with `<X class="h-4 w-4" />`
- **Mobile sheets (slide-up drawers)**: `glass-strong ... rounded-t-2xl border-t border-bd bg-s2` with a `bg-s0/50` scrim (no scrim blur — the sheet's own `glass-strong` frosts the content behind). Same treatment as the trader overview drawer; applies on mobile breakpoints too (the `.glass`/surface-alpha contract is NOT `@media`-gated).
- All modals use `use:portal` to render at `<body>`

### Buttons — Action Button Utilities
Four custom Tailwind utilities defined in `app.css`. Use these for all action buttons (not tabs/pills/toggles/icon-only buttons). Add sizing (`px-N py-N text-xs`) yourself.

| Utility | Style | Use for |
|---------|-------|---------|
| `btn-primary` | `rounded-lg bg-grn text-s0 font-bold` | Connect, Buy, Save, Create, Copy Trade |
| `btn-secondary` | `rounded-lg border-bd bg-s4 text-g7 hover:text-tx` | Details, Edit, View, Cancel, Close, Full Portfolio |
| `btn-danger-outline` | `rounded-lg bg-red/10 text-red ring-red/20 hover:bg-red/20` | Dismiss, Sell (inline), Delete |
| `btn-danger` | `rounded-lg bg-red text-s0 font-bold` | Sell submit (modal), Dismiss Position (confirm) |

Example: `<button class="btn-primary px-4 py-2 text-sm">Save</button>`

### Buttons — Pill Selectors (not action buttons)
- **Pill selected state (forms/modals)**: `border-tx text-tx` — NOT green
- **Pill selected state (leaderboard filters)**: `bg-grn/15 text-grn` — green is OK here
- **Pill unselected**: `border-bd text-g6 hover:text-g9`

### Toggle Switches
- Size: `h-5 w-9` (consistent everywhere)
- On: `bg-grn`
- Off: `bg-bd2` (NOT `bg-bd` or `bg-g1`)
- Knob: `h-4 w-4 rounded-full bg-wh`, `left-[18px]` (on) / `left-0.5` (off)

### Inputs
- Form inputs in modals: `rounded-lg border border-bd bg-s4 px-2.5 py-1.5 text-xs text-tx outline-none`
- Inputs inside bordered wrappers: `bg-transparent`
- Labels: `text-[10px] font-medium uppercase tracking-wider text-g5`

### Hover States
- Use `hover:bg-wh/5` or `hover:bg-s7` — NEVER `hover:bg-wh/[0.02]` or `hover:bg-wh/[0.03]`

### Icons
- UI icons: `lucide-svelte`
- Brand/social icons: `simple-icons` (`siX`, `siTelegram`, `siDiscord`)
- Dex paid eagle: `<DexPaidIcon />` component (NOT inline SVG)
- Router/chain icons: overlay on token images using `getRouterIconForChain(platformType, chain)`

### Mobile Layout
- Global bottom nav: `fixed bottom-0 h-14` — all pages
- Positions/Watchlist bar: `fixed bottom-14` — when logged in, all pages
- Terminal Buy/Sell: in the Positions/Watchlist bar via `ml-auto`, only on `/`
- Mobile height calc: `calc(100dvh - 48px - 56px - 40px)` (navbar + bottom nav + positions bar)
- All pages use `pb-24 md:pb-0` to clear mobile bottom bars

### Chart
- All chart colors must use `tc('--t-grn')`, `tc('--t-red')`, etc.
- Area gradient uses hex alpha: `color + '2E'` (18%), `color + '08'` (3%)
- Volume bars use per-point color with hex alpha: `tc('--t-grn') + '4D'`
- Chart theme `$effect` watches `getTheme()` + `getThemeVersion()` to re-apply on custom theme changes

## Architecture Patterns

### State Management
- **Svelte 5 runes only** — no `svelte/store` writable/readable stores
- Module-level reactive state with exported getter/setter functions
- Stores imported directly — no Svelte context API

### API Client
- Backend origin is configured via `PUBLIC_API_BASE`; connection mode via `PUBLIC_API_PROXY` (see `.env.example`). `src/lib/api/config.ts` centralizes this: **direct mode** (default) — the browser calls `PUBLIC_API_BASE` directly (backend must allow CORS); **proxy mode** (`PUBLIC_API_PROXY=true`) — the browser calls same-origin and the dev server (`vite.config.ts`) / production worker (`hooks.server.ts`) forward all `/v2/*` requests (REST, token images, `/v2/ws`) to `PUBLIC_API_BASE`, avoiding CORS. Use `apiUrl()`/`tokenImage()`/`wsBase()` from `config.ts` for any hand-built API URL so it honors the mode.
- `src/lib/api/client.ts` creates an `openapi-fetch` client at `apiOrigin()` (same-origin root in proxy mode, `PUBLIC_API_BASE` otherwise; SSR is always direct)
- Auth middleware attaches JWT; on 401 it calls `refreshToken()` (`POST /v2/auth/refresh`, Bearer, no body) and retries the original request **once** with the new token. The retry is marked with an `x-auth-retry` header; a 401 on the retry (or on the refresh call itself) disconnects. `request.clone()` (cast `as unknown as Request` for CF Worker types) preserves the body for the retry.
- Refresh requests are coalesced via a shared `refreshInFlight` promise in `auth.svelte.ts` (both the scheduled timer and 401-retry paths share it)
- All API types from `v2.d.ts` — regenerate from your backend's OpenAPI spec with `npx openapi-typescript <path-to>/opendex.v2.openapi.yaml -o src/lib/api/v2.d.ts`

### Auth Flow
- `POST /v2/auth/challenge` with `method: 'web3'`, `chain: 'solana'`, `signatureProtocol: 'solana_legacy'`
- Phantom signs the challenge message
- `POST /v2/auth/signin` with challengeId + signature
- JWT stored in `ombra_token`, wallet in `ombra_wallet`
- Auto-refresh scheduled 60s before JWT expiry via `parseJwtExp()` (decodes the JWT `exp` claim); `setAuthToken` reschedules on every token change, transient network failures retry in 15s, and an expired token on load refreshes ~immediately (min 1s delay)
- `initAuth()` called on layout mount to schedule refresh for existing tokens
- `onAuthTokenChange(listener)` fires on sign-in/refresh/disconnect; the root layout wires it to the WS `authenticate()` so a refreshed JWT re-auths the live socket without a reconnect
- Managed SOL withdrawals call `/v2/user/wallets/withdraw`, sign the returned opaque `transactionToSign` UTF-8 string with Phantom, hex-encode the 64-byte signature, then call `/v2/user/wallets/withdraw/confirm`
- Keep withdrawal amounts as exact decimal JSON-number text; do not round-trip them through JavaScript `Number`

### Currency Toggle
- `isUsd()` from `currency.svelte.ts` controls USD vs native display
- `fmtVal(usd, native, chain)` and `fmtPrice(usd, native, chain)` auto-select based on toggle
- Affects prices, liquidity, trade amounts, fees — NOT volume or market cap (always USD)
- Column headers should say "USD" or "Value" based on `isUsd()`

## Critical Rules

1. **Never edit `src/lib/api/v2.d.ts`** — auto-generated. Regenerate from spec.
2. **Never edit `worker-configuration.d.ts`** — auto-generated by `wrangler types`.
3. **Always run `pnpm check`** after changes.
4. **Use Svelte 5 runes** — never Svelte 4 stores API.
5. **No comments in code** unless explicitly requested.
6. **No hardcoded colors** — use theme variables everywhere. See Styling Rules above.
7. **Fix styling inconsistencies on sight** — if you see any while working on another task, fix them.
8. **Pre-existing type errors** only in `src/lib/stores/auth.svelte.ts` (4 errors about `unknown`) — ignore these.
9. **`as never` casts** in API calls are intentional workarounds for openapi-fetch type strictness.
10. **DexPaidIcon** — always use `<DexPaidIcon />` component, never inline the eagle SVG.

## Cursor Contract

- REST and WS snapshots share one tail-anchored pagination contract: `data.cursor` is the latest REST page represented by the response, `data.prevCursor` and `data.nextCursor` are adjacent pages around that tail.
- REST load more always uses `data.nextCursor`; WS replacement snapshots update the same pagination state and replace rendered rows.
- Every WS accumulated or fixed window subscribes with `{ endCursor: data.cursor }`; after a REST load-more, re-subscribe through the new `data.cursor`.
- Scanner views always use their matching category route (`new`, `trending/{timeframe}`, `top-volume/{timeframe}`, or `top-gainers/{timeframe}`). User-selected `rankBy` and `orderBy` values are sent to that same route and take precedence over its view defaults. REST bodies and WS subscriptions must repeat the selected `ScannerView`, effective `rankBy`, `orderBy`, and `timeFrame` so their cursor keys match.
- `meta.endCursor` is the subscribed window selector. The WebSocket client validates it with the acknowledged `windowId` before delivering a frame.
- `startCursor` is only required when explicitly subscribing to a fixed range.
- Cursor strings are backend-owned opaque selectors.
- Frontend code stores and forwards only `cursor`, `prevCursor`, and `nextCursor` strings returned by backend payloads.
- Never construct, encode, decode, or mutate backend cursors in frontend.

## Common Gotchas

- **Shared live stores** — `tick.svelte.ts` owns the visibility-gated clock; `peg.svelte.ts` exposes `startPegPrices`/`stopPegPrices`, and the root layout owns that subscription so Navbar or feature components do not duplicate it
- **`$page` import** — use `import { page } from '$app/state'` (Svelte 5), not `'$app/stores'`
- **TokenChart** must dynamically import `lightweight-charts` in `onMount` — SSR incompatible
- **Responsive CSS does not unmount components** — do not render duplicate REST-heavy components behind `hidden md:*`; gate desktop/mobile variants with `getIsDesktop()` from `src/lib/stores/viewport.svelte.ts` instead
- **High-churn list rows need CSS containment** — WS-updated row components (TokenRow, MemescopeCard, MobileTokenCard, TokenDetail swap feed rows) use `[contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:auto_Npx]` on their root so offscreen rows skip style/layout/paint and visible-row updates can't trigger page-wide repaints; apply the same to any new live-updating list row. **Never render a high-churn live feed as a `<table>`** — table auto-layout forces whole-table relayout on every row change AND `content-visibility` doesn't apply to `<tr>`; use a `div` CSS-grid (`grid-cols-[...]`) with per-row containment instead (the TokenDetail swaps desktop view was converted from a table for exactly this reason — it fell behind on high-vol tokens)
- **Effect-owned loads** — capture identity inputs in `$effect`, then run imperative reset/fetch/subscription work in `untrack`; a pagination setter must not read reactive pagination immediately after replacing it, or incoming REST/WS frames can retrigger the load effect
- **Multi-tab tokens (beta, feSettings `multiTab`, desktop only)** — URL (`?chain=&token=`) is the source of truth for the *active* tab; the tab list is a separate persisted store (`tokenTabs.svelte.ts`, key `ombra_token_tabs`, max 5, replace-last on overflow). Each open tab keeps ONE stable `TokenDetail` mounted (bound to its own `tabTokenData[key]` slot) — never swap instances with `{#if active}` (that remounts and kills chart/WS state); hide inactive with `opacity-0`+`inert` (NOT `invisible`/`display:none`, which breaks lightweight-charts sizing). Bindable map slots must be seeded (`tabTokenData[key] = null`) before `bind:` or Svelte throws `props_invalid_value`. Tabs are lazy (`visitedTabs` gate) and idle-evicted after 60s inactivity (unmount → `onDestroy` frees WS). The title/symbol `$effect` must guard `token.tokenAddress === selectedAddress` or it writes the previous tab's data during a switch
- **Popped-out token windows** (`FloatingTokenWindow.svelte`, rendered in `+layout.svelte` so they persist across routes) — z-order via a monotonic `z` counter (click/drag calls `focusPopout`, style `z-index: 200 + z`); `focusedPopoutId` is the redirect target: a `beforeNavigate` guard in the layout cancels token navigations to `/` (only when coming FROM a non-`/` page) and calls `setPopoutToken` instead. Main Trade panel always trades the in-view token; popouts trade via `quickBuy`/`quickSell` (explicit amount/pct, per-token loading map — never touch the shared `buyAmount`/`sellPercent` globals)
- **Shared candle cache** (`candleCache.svelte.ts`, plain Map not `$state`) — `TokenChart` writes close-price series (initial + live WS) and `TokenDetail` writes live `mcapStr` (from `TOKEN_PRICE`, valid in any chart mode); `TokenTabPreview` reads it for instant hover sparklines + polls every 1s. Survives tab eviction; only never-visited tabs do a one-off candle fetch
- **Candle render pipeline** — `TokenChart` keeps canonical candle/volume/area arrays chronological, timestamp-unique, and index-aligned behind `candleIndexByTime`. Live WS payloads coalesce latest-per-timestamp and drain once per animation frame (250ms canonical-only fallback while the document is hidden). Inactive token tabs continue canonical ingestion but must make no lightweight-charts mutations; activation performs one full projection and restores either the live edge or the saved visible time range. Every async candle/history/marker callback must retain generation or request ownership, and every chart/series/primitive mutation must remain behind the projection gate.
- **Candle cache identity** — close series are keyed by `chain:address:timeframe:mode`, bounded to the latest 120 timestamped points, and updated incrementally. Token market-cap text remains keyed only by chain/address. `TokenTabPreview` consumes exactly `15m:marketCap` and uses its REST fallback when that entry is absent; never let a price or different-timeframe chart satisfy that preview.
- **Twitter WS topics are broadcast rooms, not livecursor windows** — `twitter:feed` (public) and `twitter:personal` (auth, gated on caller's subscriptions) accept the same filter params as REST (`onlyCa`, `action`, `authorHandle`, `authorId`) via subscribe params; no windowId/cursor resume, so refetch page 1 on resubscribe (use `subscribe(..., { onSubscribed })`) to close reconnect gaps. Dedupe by `${action}:${tweetId ?? timestamp+handle}` — WS frames have `id: 0`. `unfollowTarget` is populated for both follow AND unfollow; branch on `action`. Personal-room membership updates ≤30s after subscribe/unsubscribe mutations on other instances
- **No aggregate `token:{chain}:{address}` WS topic exists** — the backend AsyncAPI spec only defines per-leaf topics (`:price` TOKEN_PRICE, `:stats` TOKEN_STATS, `:swaps` TOKEN_SWAPS, `:holders` all 4 holder events, `:top_traders`, `:migration`, `:feed`, `:candle:{tf}:{mode}`, `:safety`, `:dev_tokens`). Never subscribe to the bare `token:c:a` topic — it seeds nothing and just wastes a server sub + dispatch matching. `TokenTopicMeta` leaf topics carry no `windowId` (not window-gated); holders/feed use livecursor windows
- **WS burst coalescing** (`src/lib/utils/coalesce.ts` `createCoalescer`) — high-frequency WS handlers must buffer frames and flush once per animation frame (falls back to a 250ms timer while `document.hidden`, since rAF is paused in background). Used by TwitterFeedPanel (tweet prepend), TokenDetail (swaps prepend + price/stats latest-wins), scanner (fold frames, one `tokens=` assign). Prevents the tab-return flood where a backlog of frames each triggered a full array rebuild + re-render. `push` per frame, flush applies the whole batch; `maxBatch` caps a burst; `clear()` on resubscribe, `dispose()` on destroy
- **Layout code-splitting** — root `+layout.svelte` must not statically import WatchlistPanel, PositionsPanel, TwitterFeedPanel, FloatingTokenWindow, or trader drawers/modals. Load them with `import()` on first need (mobile sheet open, desktop watchlist open via idle callback, popout created, trader target set). Same for Navbar ThemeBuilder/MobileConnect/MobileScan, PositionsPanel `PnlShareCard`, and Watchlist CreateBot/UserList modals. Keeps layout out of the critical JS preload graph
- **Lucide icons** — always import per-icon (`import X from 'lucide-svelte/icons/x'`), never `from 'lucide-svelte'`. The barrel re-exports every icon and collapses into a huge shared chunk
- **Entity icons stay local** — use `FundingEntityIcon` for funding providers and swap execution programs. Execution programs resolve their canonical Solana program ID first, then fall back to a label; every catalogued provider resolves through `entity-icons.ts` to a bundled asset under `static/entity-icons`. Use WebP by default; intentional SVG exceptions are listed in `VECTOR_ENTITY_ICON_SLUGS`. Only unknown future labels get a deterministic monogram. Do not add runtime logo URLs to high-churn rows.
- **Async chunk preload skip** — `vite.config.ts` writes `.svelte-kit/async-chunks.json` (+ `src/lib/generated/async-chunks.ts`) from the client bundle; `scripts/inject-async-chunks.mjs` patches the SSR hooks/`_worker.js` Set after the single `vite build` so Link `modulepreload` omits those files (avoids a second full Vite pass)
- **PnL share backgrounds** — keep `$lib/assets/pnl-bg/*` as compressed JPEGs (≤~200KB each); never ship multi-MB PNGs. Lazy-load `PnlShareCard` so those assets stay off the initial route graph
- **`tick.svelte.ts` gates on visibility** — stops the 1s `now` interval while the tab is hidden, refreshes + resumes on `visibilitychange` (nothing to update in background)
- **Token holder WS snapshots are authoritative** — replace holder state entirely
- **Token swaps WS is prepend-only** — normalize and prepend, never replace; batched via coalescer (dedup across the batch, single `[...reverse(batch), ...trades].slice(0,100)`)
- **Scanner WS subscriptions** require `view`, `timeFrame`, the view's effective `rankBy`, `orderBy`, and `endCursor`; token filters are flattened into the same params object
- **Scanner WS payloads are direct** — `SCANNER_TOKENS` delivers `ScannerTokensSnapshot` directly in `data`; do not unwrap `data.snapshot`
- **WebSocket resume uses an ordered application barrier** — visible tabs send `{ type: 'ping', requestId }`; matching `pong` is processed through the same time-sliced FIFO as data, and stale socket generations are ignored
- **Reactive WebSocket diagnostics** — use `observeWsDiagnostics` for status UI updates; keep RTT monotonic and do not poll `getWsDiagnostics()` or infer one-way latency from the server timestamp
- **Cursor WebSocket subscriptions must refetch on reconnect** — pass `recovery: 'refetch'` and an `onReconnect` callback that obtains a fresh REST cursor before subscribing again
- **Trade target percent triggers**: `changePct` must be positive for both TP and SL
- **Wallet bot source strategies are independent per side** — buy supports `SOURCE_TRADE_PROPORTION` or `WALLET_BALANCE_PERCENT`; sell supports `SOURCE_TRADE_PROPORTION` or `BOT_POSITION_PERCENT`. Fixed buy plus copied sells is valid, omitted sell strategy disables copied sells, and zero is a meaningful preserved value. On update, omit `sourceStrategy` to preserve it, send `null` to clear it, or send the complete replacement object. Wallet bots must retain the source wallet's chain instead of defaulting to SOL.
- **TG chat filter `senders`/`topics`**: send `null` (not `[]`) for "unrestricted"
- **`SyncChatsResponse`** returns only newly discovered chats — re-fetch with GET after sync
- **Theme flash prevention**: `app.html` has a blocking script that reads `ombra_custom_vars` and applies them before render
- **Theme version counter**: custom theme changes bump `themeVersion` so chart `$effect` re-runs even when mode stays `'custom'`
- **`previewTheme()` must NOT bump themeVersion** — only `setCustomTheme`/`resetToBuiltin` should, to avoid infinite reactive loops
- **Stale Cloudflare output can poison checks**: if `.svelte-kit/cloudflare/_worker.js` exists, `wrangler types` may add a `GlobalProps.mainModule` import to `worker-configuration.d.ts`, causing `svelte-check` to scan generated `.svelte-kit` JS
