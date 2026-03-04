import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable 'use cache' directives (required for Next.js 16)
  cacheComponents: true,

  // Next.js 16 'use cache' directives — backed by orkify/cache
  cacheHandlers: {
    default: require.resolve('orkify/next/use-cache'),
  },

  // ISR / route cache — backed by orkify/cache
  cacheHandler: require.resolve('orkify/next/isr-cache'),

  // Disable Next.js's built-in in-memory cache (orkify handles it)
  cacheMaxMemorySize: 0,

  // Version skew protection — auto-set by `orkify deploy`, optional for `orkify up/run`
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
};

export default nextConfig;
