import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Required for orkify deployments — produces a self-contained build
  output: 'standalone',

  // Enable 'use cache' directives (required for Next.js 16)
  cacheComponents: true,

  // Next.js 16 'use cache' directives — backed by @orkify/cache
  cacheHandlers: {
    default: require.resolve('@orkify/next/use-cache'),
  },

  // ISR / route cache — backed by @orkify/cache
  cacheHandler: require.resolve('@orkify/next/isr-cache'),

  // Disable Next.js's built-in in-memory cache (orkify handles it)
  cacheMaxMemorySize: 0,

  // Version skew protection — auto-set by `orkify deploy`, optional for `orkify up/run`
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,

  // Source maps for browser error tracking
  experimental: {
    serverSourceMaps: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.devtool = 'hidden-source-map';
    }
    return config;
  },
  // Turbopack is default in Next.js 16; empty config silences the
  // "webpack config without turbopack config" error during builds.
  turbopack: {},
};

export default nextConfig;
