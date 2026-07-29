/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        // SprintRay-inspired teal/cyan accent
        accent: {
          DEFAULT: '#0AB6C4',
          hover: '#0899A6',
          light: '#E6F7F9',
          dark: '#077080'
        },
        // App background & surface
        bg: {
          DEFAULT: '#F7F9FA',
          card: '#FFFFFF',
          sidebar: '#F0F4F6'
        },
        // Text
        ink: {
          DEFAULT: '#0E1116',
          soft: '#1F2933',
          muted: '#637381',
          faint: '#A8B4BE'
        },
        // Pipeline stage accent colors (muted, distinct)
        stage: {
          disain: '#6366F1',    // indigo — design
          print: '#F59E0B',     // amber — printing
          poleeri: '#10B981',   // emerald — polishing
          puhasta: '#3B82F6',   // blue — cleaning
          varvi: '#EC4899',     // pink — paint/characterize
          valmis: '#22C55E'     // green — done
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
