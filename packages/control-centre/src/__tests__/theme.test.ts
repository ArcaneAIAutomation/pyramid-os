import { describe, it, expect } from 'vitest';
import { EGYPTIAN_THEME } from '../theme.js';

describe('EGYPTIAN_THEME', () => {
  it('should have all required color constants', () => {
    expect(EGYPTIAN_THEME.colors.sandstone).toBe('#C2B280');
    expect(EGYPTIAN_THEME.colors.gold).toBe('#FFD700');
    expect(EGYPTIAN_THEME.colors.lapis).toBe('#1E90FF');
    expect(EGYPTIAN_THEME.colors.papyrus).toBe('#F5E6C8');
    expect(EGYPTIAN_THEME.colors.obsidian).toBe('#1A1A2E');
    expect(EGYPTIAN_THEME.colors.copper).toBe('#B87333');
    expect(EGYPTIAN_THEME.colors.turquoise).toBe('#40E0D0');
    expect(EGYPTIAN_THEME.colors.hieroglyphRed).toBe('#C41E3A');
  });

  it('should have all 8 color entries', () => {
    expect(Object.keys(EGYPTIAN_THEME.colors)).toHaveLength(8);
  });

  it('should have valid hex color format for all colors', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const color of Object.values(EGYPTIAN_THEME.colors)) {
      expect(color).toMatch(hexPattern);
    }
  });

  it('should have font definitions', () => {
    expect(EGYPTIAN_THEME.fonts.heading).toBeDefined();
    expect(EGYPTIAN_THEME.fonts.body).toBeDefined();
  });

  it('should have panel styling definitions', () => {
    expect(EGYPTIAN_THEME.panels.borderStyle).toBeDefined();
    expect(EGYPTIAN_THEME.panels.cornerDecoration).toBeDefined();
  });
});
