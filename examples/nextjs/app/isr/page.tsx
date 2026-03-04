export const revalidate = 10;

export default function ISRPage() {
  return (
    <main>
      <h1>ISR Page</h1>
      <p>This page uses ISR with a 10-second revalidation interval.</p>
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
