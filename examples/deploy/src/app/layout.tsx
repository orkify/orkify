import type { Metadata } from 'next';
import { OrkifyErrorCapture } from 'orkify/next/error-capture';
import './globals.css';

export const metadata: Metadata = {
  title: 'Deploy Example',
  description: 'orkify deploy + error chaos testing app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
        <OrkifyErrorCapture />
      </body>
    </html>
  );
}
