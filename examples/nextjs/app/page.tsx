export default function Home() {
  return (
    <main>
      <h1>orkify + Next.js Cache Example</h1>
      <p>This app demonstrates both Next.js cache handlers backed by orkify/cache.</p>
      <nav>
        <ul>
          <li>
            <a href="/cached">
              <code>&apos;use cache&apos;</code> — cached data fetching with tags
            </a>
          </li>
          <li>
            <a href="/isr">ISR — incremental static regeneration</a>
          </li>
          <li>
            <a href="/posts">Posts — tag-based caching with revalidation</a>
          </li>
          <li>
            <a href="/api/health">Health check</a>
          </li>
        </ul>
      </nav>
    </main>
  );
}
