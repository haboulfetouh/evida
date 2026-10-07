import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'EVIDA — Evidence Driven Hiring',
  description: 'Every interview. Structured. Evidenced. Decided.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap"
        />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%238E2A2E'/><rect x='7' y='9' width='18' height='3' fill='white'/><rect x='7' y='15' width='12' height='3' fill='white'/><rect x='7' y='21' width='6' height='3' fill='white' opacity='.5'/></svg>" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
