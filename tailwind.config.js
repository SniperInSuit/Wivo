/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        // Every token is `rgb(var(--x) / <alpha-value>)` so the opacity
        // modifiers used all over the app keep working while the theme swaps the
        // underlying channels. See styles/index.css for the theme definitions.
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
          light: 'rgb(var(--c-accent-light) / <alpha-value>)',
          dark: 'rgb(var(--c-accent-dark) / <alpha-value>)'
        },
        bg: {
          DEFAULT: 'rgb(var(--c-bg) / <alpha-value>)',
          card: 'rgb(var(--c-bg-card) / <alpha-value>)',
          sidebar: 'rgb(var(--c-bg-sidebar) / <alpha-value>)'
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          soft: 'rgb(var(--c-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)'
        },
        // Sidebar foreground. Separate from `ink` because in Navy Cloud the nav
        // sits on navy (needs light text) while cards stay light (need dark).
        nav: {
          DEFAULT: 'rgb(var(--c-nav) / <alpha-value>)',
          muted: 'rgb(var(--c-nav-muted) / <alpha-value>)',
          // The sidebar chrome itself. Distinct from bg-sidebar, which doubles as
          // the recessed surface for inputs inside cards and must stay light.
          bg: 'rgb(var(--c-nav-bg) / <alpha-value>)'
        },
        // Chrome — header bars sitting on the page background. In Navy Cloud
        // the headers are navy with light text; in Hele they stay white.
        chrome: {
          DEFAULT: 'rgb(var(--c-chrome) / <alpha-value>)',
          text: 'rgb(var(--c-chrome-text) / <alpha-value>)',
          muted: 'rgb(var(--c-chrome-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-chrome-faint) / <alpha-value>)'
        },
        // Pipeline stage accent colors (muted, distinct) — not themed
        stage: {
          disain: '#6366F1',
          print: '#F59E0B',
          poleeri: '#10B981',
          puhasta: '#3B82F6',
          varvi: '#EC4899',
          valmis: '#22C55E'
        }
      },
      borderRadius: {
        card: '12px',
        panel: '16px'
      },
      boxShadow: {
        card: '0 1px 4px 0 rgba(14,17,22,0.06), 0 4px 16px 0 rgba(14,17,22,0.04)',
        panel: '0 8px 40px 0 rgba(14,17,22,0.12)',
        'card-hover': '0 4px 16px 0 rgba(10,182,196,0.12), 0 1px 4px 0 rgba(14,17,22,0.08)'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif']
      }
    }
  },
  plugins: []
}
