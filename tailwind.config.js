/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mist: '#F1F5F2',
        paper: '#FFFFFF',
        ink: { DEFAULT: '#1F2D29', soft: '#5C6E68' },
        line: '#DCE6E0',
        sage: { 50: '#F4F9F6', 100: '#E1EFE8', 200: '#C6DFD3', 500: '#4C8B7A', 600: '#3C7262', 700: '#2F5A4E' },
        owe: { DEFAULT: '#B9626E', soft: '#F7E7E9', deep: '#8A4350' },
      },
      fontFamily: { sans: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      borderRadius: { '3xl': '1.75rem' },
    },
  },
  plugins: [],
};
