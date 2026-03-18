import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ISR / route cache — backed by orkify/cache (no 'use cache', no cacheComponents)
  cacheHandler: require.resolve('@orkify/next/isr-cache'),

  // Disable Next.js's built-in in-memory cache (orkify handles it)
  cacheMaxMemorySize: 0,
};

export default nextConfig;
