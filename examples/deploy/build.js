// Build script — stamps build-info.json then runs next build

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// Stamp build info into project root (read by server.mjs at startup)
writeFileSync(
  new URL('./build-info.json', import.meta.url).pathname,
  JSON.stringify(
    {
      version: pkg.version,
      builtAt: new Date().toISOString(),
      node: process.version,
    },
    null,
    2
  )
);

console.log(`Stamped build-info.json for ${pkg.name}@${pkg.version}`);

// Ensure .next/types exists so TypeScript doesn't fail before Next.js generates routes.d.ts
const typesDir = new URL('./.next/types/', import.meta.url).pathname;
mkdirSync(typesDir, { recursive: true });
writeFileSync(`${typesDir}routes.d.ts`, '// auto-generated stub\nexport {};\n');

// Run next build
execSync('npx next build', { stdio: 'inherit', cwd: import.meta.dirname });
