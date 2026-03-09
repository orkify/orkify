import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node22',
    ssr: true,
    sourcemap: true,
    rollupOptions: {
      input: 'src/server.ts',
      output: {
        entryFileNames: 'server.js',
      },
      external: ['orkify', 'orkify/cache'],
    },
    outDir: 'dist',
  },
});
