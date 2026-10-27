import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  transpilePackages: ['@orkify/cache', '@orkify/next'],
  experimental: {
    serverSourceMaps: true,
  },
  // Client source maps so orkify can resolve minified browser stacks.
  // `orkify deploy` moves them off the public /_next/static path after the build.
  productionBrowserSourceMaps: true,
  webpack: (config) => {
    // @orkify packages use NodeNext .js extensions on .ts source files —
    // tell webpack to try .ts/.tsx when it encounters a .js/.jsx import.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
