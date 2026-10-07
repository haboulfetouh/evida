import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: v('ink'),
        muted: v('muted'),
        paper: v('paper'),
        surface: v('surface'),
        line: v('line'),
        brand: { DEFAULT: v('brand'), soft: v('brand-soft') },
        valid: { DEFAULT: v('valid'), soft: v('valid-soft') },
        pending: { DEFAULT: v('pending'), soft: v('pending-soft') },
        gap: { DEFAULT: v('gap'), soft: v('gap-soft') },
      },
      fontFamily: { sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] },
      fontSize: {
        // Modular scale (1.2) around a 15px body.
        xs: ['12px', '16px'], sm: ['13.5px', '20px'], base: ['15px', '23px'], lg: ['18px', '26px'], xl: ['21.5px', '28px'], '2xl': ['26px', '32px'], '3xl': ['31px', '38px'], '4xl': ['44px', '50px'],
      },
      borderRadius: { sm: '4px', DEFAULT: '6px', md: '8px', lg: '12px' },
      boxShadow: { panel: '0 1px 0 rgb(var(--line)), 0 8px 24px -16px rgb(var(--ink) / 0.25)' },
    },
  },
  plugins: [],
} satisfies Config;
