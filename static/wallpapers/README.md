# Wallpapers

One wallpaper per built-in theme, bundled rather than hotlinked (the previous
Unsplash / wallpaperflare URLs broke offline, leaked referrers, and could vanish
without notice). Each is a 1920px WebP (≤ ~260KB) with a 480px thumbnail in
`thumb/` so the picker grid doesn't pull full-size images.

Pairings were chosen against each theme's seed palette in
`src/lib/utils/themeColors.ts` — dominant image colours vs the theme's background
and accent colours:

| Theme | Wallpaper | Why |
|---|---|---|
| Ombra | osaka-jade / glowing-city | black base with a jade glow ≈ the neon-green accent |
| Tomorrow | retro-82 / dusk-guardian | warm orange/red, matches `#de935f` / `#cc6666` |
| Clean | Unsplash aurora | bright, low-saturation for a light theme |
| Midnight Blue | Unsplash night sky | deep blue base `#080e1e` |
| Deep Purple | Unsplash deep space | violet field vs `#120a20` |
| Emerald | osaka-jade / shaded-entrance | `#020809`/`#06291a` vs background `#041a10` |
| Warm Sand | local (desert sunrise) | literal sand dunes; warm orange sky matches `#cc6622` / `#bb8800` |
| Arctic | Unsplash nebula | cold light blues for a light theme |
| Cyber Punk | local (856858) | neon magenta/cyan |
| DEXC | vantablack / twisted-stairs | near-pure black vs background `#010101` |
| Solarized | retro-82 / gateway | `#1a3d48` teal vs base03 `#002b36` |
| Monokai | hackerman / synth-scape | neon lime/magenta energy |
| Nord | nord / city-view | `#2e3440` is Nord's polar night, exactly |
| Dracula | tokyo-night / milad-fakurian | `#160033`/`#7e398f` purple |
| Gruvbox | gruvbox / the-backwater | warm dark `#352d29` + yellow accents |
| Catppuccin | catppuccin / waves | `#181824` is the Catppuccin base |
| Catppuccin Macho | catppuccin / blue-eye | same base, bolder subject |
| Rose Pine | tokyo-night / swirl-buck | `#4b1954`/`#862364` rose on dark (omarchy's own rose-pine backgrounds are all light, which fights our dark variant) |
| Studio Ghibli | Totoro | the theme is named for it |
| Laputa | kanagawa / the-great-wave | hand-drawn Japanese art, not a film still; `#84979b` (hue 190) matches the theme's blue accent and `#f1ead6` its background lightness |
| Hotdog Stand | procedural Mondrian | generated, not photographic — see below |

## Hotdog Stand

No photograph suits `#dd0000` + `#ffff00` + black, but that *is* Mondrian's
palette, so the wallpaper is generated: `scripts/gen-hotdog-wallpaper.py` does
recursive guillotine splits, fills a few large blocks and draws the black grid.
Re-run it to regenerate; change `SEED` to reroll the composition (21 was picked
because it keeps large calm fields, which sit better behind the UI than a busy
one). Output is ~5KB — flat colour compresses to almost nothing in WebP.

## Sources

- Most files come from [`basecamp/omarchy`](https://github.com/basecamp/omarchy)
  (`themes/<name>/backgrounds/`). The repo is MIT, but the individual wallpapers
  are third-party artwork and aren't themselves covered by that licence.
- `clean`, `midnight-blue`, `arctic`, `deep-purple` are Unsplash photos
  (Unsplash Licence — free to use, no attribution required).
- `cyber-punk` and `warm-sand` are freely-distributed wallpapers (no known
  restriction).
- `laputa` is Hokusai's *The Great Wave off Kanagawa* (1831) — public domain.
- `studio-ghibli` is fan art, so the *artist* still holds copyright on it even
  though it isn't official Studio Ghibli material.

These all ship in a public repo. Nothing here is known to be
licence-violating, but none of the non-Unsplash images carry an explicit
redistribution grant either — swap them for Unsplash/Pexels equivalents or
commissioned art if that ever needs to be airtight.
