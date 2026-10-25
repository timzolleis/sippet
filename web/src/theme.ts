// Imported by vite.config.ts, which has no `~` alias: relative paths.
import { BRAND_ANCHORS } from "./lib/theme/brand-anchors.ts"
import type { BrandingTheme } from "./lib/theme/branding.ts"
import { brandingThemeCss } from "./lib/theme/branding-theme.ts"

/** Paprika orange on warm stone grays; red stays the destructive color. */
export const THEME: BrandingTheme = { primaryColor: "orange", baseColor: "stone", destructiveColor: "red" }

/**
 * The colors for `THEME`, run at build time (vite.config.ts). The generator anchors `orange` at Tailwind's step 600,
 * where its white label reaches only 3.5:1. Here the anchor is Tailwind's orange-700 (oklch(55.3% 0.195 38.402), LCH
 * [46.46, 91.42, 50.82]) taken down to L 42: the solid button paints its fill 15% lighter at the top, and even there the
 * label stays above 4.5:1 (the token itself: about 6:1). Everything derived from the primary follows. `brandingThemeCss`
 * only takes color names, so the anchor is set on the generator's table, in the build process; none of it ships.
 */
export function themeCss(): string {
  BRAND_ANCHORS.orange = [42, 91.42, 50.82]

  return brandingThemeCss(THEME)
}
