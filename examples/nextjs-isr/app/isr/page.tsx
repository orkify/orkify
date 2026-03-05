export const revalidate = 300; // 5 minutes — route segment config ISR

export default function IsrPage() {
  return (
    <main>
      <h1>ISR Page</h1>
      <p>
        This page uses route segment config (<code>revalidate = 300</code>). It goes through the ISR
        cache handler (<code>isr-cache.ts</code>).
      </p>
      <p>
        Rendered at: <strong>{new Date().toISOString()}</strong>
      </p>
      <p>
        Worker: <code>{process.env.ORKIFY_WORKER_ID ?? 'standalone'}</code>
      </p>
      <p>
        <a href="/">← Home</a>
      </p>
    </main>
  );
}
