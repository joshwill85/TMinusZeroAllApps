import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'SFMono-Regular', 'ui-monospace', 'monospace']
      },
      colors: {
        bg: 'var(--bg)',
        'bg-true': 'var(--bg-true)',
        'surface-0': 'var(--surface-0)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        stroke: 'var(--stroke)',
        'stroke-strong': 'var(--stroke-strong)',
        text1: 'var(--text-1)',
        text2: 'var(--text-2)',
        text3: 'var(--text-3)',
        text4: 'var(--text-4)',
        primary: 'var(--primary)',
        'primary-700': 'var(--primary-700)',
        secondary: 'var(--secondary)',
        accent: 'var(--accent)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)'
      },
      boxShadow: {
        glow: '0 10px 40px rgba(34, 211, 238, 0.12)',
        surface: '0 12px 60px rgba(0,0,0,0.35)'
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-700px 0' },
          '100%': { backgroundPosition: '700px 0' }
        },
        scrubShake: {
          '0%': { transform: 'translateX(0px) rotate(0deg)' },
          '20%': { transform: 'translateX(-2px) rotate(-0.6deg)' },
          '40%': { transform: 'translateX(2px) rotate(0.6deg)' },
          '60%': { transform: 'translateX(-1px) rotate(-0.3deg)' },
          '80%': { transform: 'translateX(1px) rotate(0.3deg)' },
          '100%': { transform: 'translateX(0px) rotate(0deg)' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite linear',
        scrubShake: 'scrubShake 0.75s ease'
      }
    }
  },
  plugins: []
};

export default config;
