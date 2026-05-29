import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg'],
  // Required when a custom `webpack` function is set — without this, dev/build can hang
  // or compile only the client bundle (Next.js 15).
  experimental: {
    webpackBuildWorker: true,
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules/**', '**/clerk-nextjs/**'],
    };
    return config;
  },
};

export default nextConfig;
