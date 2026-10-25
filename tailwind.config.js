/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'var(--c-bg)',
        surface: 'var(--c-surface)',
        ink: 'var(--c-ink)',
        mute: 'var(--c-mute)',
        line: 'var(--c-line)',
        accent: { DEFAULT: 'var(--c-accent)', dark: 'var(--c-accent-dark)', soft: 'var(--c-accent-soft)' },
      },
      fontFamily: { sans: ['Archivo', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
