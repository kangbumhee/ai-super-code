/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0f1117',
          800: '#1a1b2e',
          700: '#1e1b4b',
          600: '#2a2b3d',
          500: '#374151',
        },
        accent: {
          purple: '#818cf8',
          blue: '#60a5fa',
          green: '#4ade80',
          red: '#f87171',
          yellow: '#fbbf24',
        }
      }
    }
  },
  plugins: []
};
