import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'orkify + Next.js ISR Example',
  description: 'Demonstrates orkify isr-cache handler for Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>{children}</body>
    </html>
  );
}
