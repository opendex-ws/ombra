/**
 * Brand artwork for a chain, used where the mark is an identity badge (token
 * avatars, the token header). Anywhere the mark sits inline with text it should
 * stay monochrome via `ChainIcon`, so it inherits the surrounding colour.
 *
 * Returns null for a chain with no artwork, so callers fall back rather than
 * render a broken image.
 */
const BRAND_ART: Record<string, string> = {
	SOL: '/icons/sol.png',
	RH: '/icons/rh.webp'
};

export function chainBrandArt(chain: string | null | undefined): string | null {
	return BRAND_ART[(chain ?? '').toUpperCase()] ?? null;
}
