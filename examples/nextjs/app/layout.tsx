import type { Metadata } from 'next';
import { OrkifyErrorCapture } from '@orkify/next/error-capture';

export const metadata: Metadata = {
  title: 'orkify + Next.js Example',
  description: 'Demonstrates orkify cache handlers and error tracking for Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        {children}
        <OrkifyErrorCapture />
      </body>
    </html>
  );
}
