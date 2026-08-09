import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#2b2522',
        cream: '#f8f4ef',
        rose: '#b66f72',
        sand: '#dfd0c4',
      },
      boxShadow: {
        soft: '0 18px 50px rgba(79, 58, 47, 0.10)',
      },
    },
  },
  plugins: [],
} satisfies Config
