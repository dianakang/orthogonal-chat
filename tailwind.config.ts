import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#0f0f10',
          1: '#18181b',
          2: '#1e1e24',
          3: '#27272f',
        },
        accent: '#6366f1',
      },
    },
  },
  plugins: [],
};

export default config;
