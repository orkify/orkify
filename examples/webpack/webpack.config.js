import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  entry: './src/server.ts',
  mode: 'production',
  target: 'node',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'server.js',
    path: resolve(__dirname, 'dist'),
    module: true,
    chunkFormat: 'module',
  },
  experiments: {
    outputModule: true,
  },
  externals: {
    '@orkify/cli': '@orkify/cli',
  },
};
