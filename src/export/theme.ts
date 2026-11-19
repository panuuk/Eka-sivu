/** Esitysteemat: värit ja fontti, joita esitystila ja kaikki viennit käyttävät. */

export type Palette = 'light' | 'dark' | 'print'

export interface ThemeColors {
  bg: string
  surface: string
  surface2: string
  text: string
  muted: string
  border: string
  borderStrong: string
  accent: string
  ok: string
  danger: string
  warn: string
}

export interface Theme {
  palette: Palette
  accent: string
  font: string
}

export const FONTS: { id: string; label: string; stack: string }[] = [
  {
    id: 'system',
    label: 'Järjestelmä',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  { id: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  {
    id: 'mono',
    label: 'Tasalevyinen',
    stack: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
]

export const DEFAULT_THEME: Theme = { palette: 'light', accent: '#4f46e5', font: 'system' }

const BASE: Record<Palette, Omit<ThemeColors, 'accent'>> = {
  light: {
    bg: '#ffffff',
    surface: '#ffffff',
    surface2: '#f1f4f9',
    text: '#0f172a',
    muted: '#5b6678',
    border: '#dde3ec',
    borderStrong: '#8d99ad',
    ok: '#1b7f4b',
    danger: '#c62828',
    warn: '#9a6400',
  },
  dark: {
    bg: '#0b1120',
    surface: '#131b2e',
    surface2: '#1a2438',
    text: '#e6eaf2',
    muted: '#97a3b8',
    border: '#25324a',
    borderStrong: '#5b6b8a',
    ok: '#5bd694',
    danger: '#ff8a80',
    warn: '#f2c14e',
  },
  // Tulostukseen: valkoinen tausta, vahva kontrasti, ei värillisiä täyttöjä
  print: {
    bg: '#ffffff',
    surface: '#ffffff',
    surface2: '#eeeeee',
    text: '#000000',
    muted: '#444444',
    border: '#bbbbbb',
    borderStrong: '#222222',
    ok: '#000000',
    danger: '#000000',
    warn: '#000000',
  },
}

export function themeColors(theme: Theme): ThemeColors {
  return { ...BASE[theme.palette], accent: theme.palette === 'print' ? '#000000' : theme.accent }
}

export function fontStack(theme: Theme): string {
  return (FONTS.find((f) => f.id === theme.font) ?? FONTS[0]).stack
}

/** Hyväksyy vain #rrggbb-värit, jottei teemasta pääse SVG:hen mitään muuta. */
export function sanitizeColor(c: string, fallback = DEFAULT_THEME.accent): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback
}

export function sanitizeTheme(t: Partial<Theme> | undefined): Theme {
  const palette: Palette = t?.palette === 'dark' || t?.palette === 'print' ? t.palette : 'light'
  const font = FONTS.some((f) => f.id === t?.font) ? (t!.font as string) : DEFAULT_THEME.font
  return { palette, font, accent: sanitizeColor(t?.accent ?? DEFAULT_THEME.accent) }
}
