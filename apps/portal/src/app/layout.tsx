import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@omnitrack/ui/src/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Careers', template: '%s · Careers' },
  description: 'Open roles and applications.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
