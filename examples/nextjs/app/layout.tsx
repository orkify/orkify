import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'orkify + Next.js Cache Example',
  description: 'Demonstrates orkify cache handlers for Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>{children}</body>
    </html>
  );
}
