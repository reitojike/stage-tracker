import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/ui/globals.css';

export const metadata: Metadata = {
  title: 'stage-tracker',
  description: 'stage-tracker consumer bootstrap baseline',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
