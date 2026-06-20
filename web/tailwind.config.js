/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Instrument Sans', 'system-ui', 'sans-serif'],
        display: ['Bricolage Grotesque', 'Instrument Sans', 'sans-serif'],
      },
      colors: {
        // Neutral tokens are CSS vars (RGB channels) so they flip in dark mode.
        page: 'rgb(var(--c-page) / <alpha-value>)',
        card: 'rgb(var(--c-card) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-faint) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--c-accent-soft) / <alpha-value>)',
        },
        brand: { red: '#E31E24', navy: '#2C2A82' },
        onaccent: 'rgb(var(--c-on-accent) / <alpha-value>)',
        up: 'rgb(var(--c-accent) / <alpha-value>)',
        down: 'rgb(var(--c-down) / <alpha-value>)',
        success: 'rgb(var(--c-success) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        warnink: 'rgb(var(--c-warn-ink) / <alpha-value>)',
      },
      borderRadius: { xl2: '0.75rem' },
      boxShadow: {
        card: '0 1px 2px rgba(28,29,51,0.05)',
        pop: '0 10px 30px rgba(28,29,51,0.14)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'pop-in': {
          '0%': { opacity: 0, transform: 'translateY(6px) scale(.98)' },
          '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'pop-in': 'pop-in .16s ease-out',
      },
    },
  },
  plugins: [],
}
