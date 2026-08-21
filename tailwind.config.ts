import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fff8e7',
          100: '#fceec6',
          200: '#f6d98e',
          300: '#edbf4f',
          400: '#dfa72b',
          500: '#d59b25',
          600: '#b98218',
          700: '#986817',
          800: '#795319',
          900: '#62451a',
          950: '#3a2912'
        },
        gray: {
          750: '#2d3748',
          850: '#1e2430'
        }
      },
      animation: {
        'slide-up': 'slideUp 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out'
      },
      keyframes: {
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' }
        }
      }
    }
  },
  plugins: []
} satisfies Config
