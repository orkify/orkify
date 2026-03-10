import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  transpilePackages: ['@orkify/cache', '@orkify/next'],
  experimental: {
    serverSourceMaps: true,
  },
  // Generate source maps for client bundles so orkify can resolve minified
  // browser stacks. 'hidden-source-map' produces .map files on disk without
  // adding a sourceMappingURL comment, so browsers won't fetch them.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.devtool = 'hidden-source-map';
    }
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
