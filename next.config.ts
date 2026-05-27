import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg'],
  experimental: {
    webpackBuildWorker: true,
  },
};

export default nextConfig;
