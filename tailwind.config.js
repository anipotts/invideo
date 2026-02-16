/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        chalk: {
          bg: '#000000',
          surface: '#111111',
          border: '#222222',
          text: '#f1f5f9',
          accent: '#3b82f6',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
        },
      },
      backgroundColor: {
        'elevated-1': 'rgba(255,255,255,0.04)',
        'elevated-2': 'rgba(255,255,255,0.08)',
        'elevated-3': 'rgba(255,255,255,0.12)',
      },
      borderColor: {
        'subtle': 'rgba(255,255,255,0.06)',
        'hover': 'rgba(255,255,255,0.12)',
      },
      fontSize: {
        'micro': ['10px', { lineHeight: '14px' }],
        'caption': ['12px', { lineHeight: '16px' }],
        'body-sm': ['14px', { lineHeight: '20px' }],
        'body': ['16px', { lineHeight: '24px' }],
      },
      transitionDuration: {
        'micro': '150ms',
        'layout': '250ms',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
