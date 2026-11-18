import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@omnitrack/ui/src/tokens.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'OmniTrack', template: '%s · OmniTrack' },
  description: 'Every Action. Every Record. Every Result.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
