import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
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
    return config;
  },
};

export default nextConfig;
