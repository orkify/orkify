'use cache';

import { cacheTag } from 'next/cache';

async function getData() {
  // Simulate a slow data fetch
  return {
    message: 'This data is cached via orkify',
    timestamp: Date.now(),
    random: Math.random(),
  };
}

export default async function CachedPage() {
  cacheTag('cached-page');

  const data = await getData();

  return (
    <main>
      <h1>Cached Page</h1>
      <p>
        This page uses <code>&apos;use cache&apos;</code> with orkify as the cache handler.
      </p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <p>Refresh the page — the timestamp should stay the same until the cache is invalidated.</p>
      <p>
        <a href="/">← Home</a>
      </p>
    </main>
  );
}
