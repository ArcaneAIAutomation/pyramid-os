/**
 * Egyptian-themed color palette and styling constants for the Control Centre dashboard.
 * Implements Canvas/A2UI theming with sandstone, gold, and lapis lazuli as primary colors.
 */

export interface ThemeColors {
  readonly sandstone: string;
  readonly gold: string;
  readonly lapis: string;
  readonly papyrus: string;
  readonly obsidian: string;
  readonly copper: string;
  readonly turquoise: string;
  readonly hieroglyphRed: string;
}

export interface ThemeFonts {
  readonly heading: string;
  readonly body: string;
}

export interface ThemePanels {
  readonly borderStyle: string;
  readonly cornerDecoration: string;
}

export interface EgyptianTheme {
  readonly colors: ThemeColors;
  readonly fonts: ThemeFonts;
  readonly panels: ThemePanels;
}

export const EGYPTIAN_THEME: EgyptianTheme = {
  colors: {
    sandstone: '#C2B280',
    gold: '#FFD700',
    lapis: '#1E90FF',
    papyrus: '#F5E6C8',
    obsidian: '#1A1A2E',
    copper: '#B87333',
    turquoise: '#40E0D0',
    hieroglyphRed: '#C41E3A',
  },
  fonts: {
    heading: 'Minecraft-inspired serif',
    body: 'Monospace for data',
  },
  panels: {
    borderStyle: 'hieroglyphic border pattern',
    cornerDecoration: 'ankh symbols',
  },
} as const;
