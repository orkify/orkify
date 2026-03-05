export default function Home() {
  return (
    <main>
      <h1>orkify + Next.js ISR Example</h1>
      <p>
        This app tests the ISR cache handler (<code>isr-cache.ts</code>) via route segment config —
        no <code>&apos;use cache&apos;</code>.
      </p>
      <nav>
        <ul>
          <li>
            <a href="/isr">ISR page (revalidate = 300)</a>
          </li>
          <li>
            <a href="/api/health">Health check</a>
          </li>
        </ul>
      </nav>
    </main>
  );
}
