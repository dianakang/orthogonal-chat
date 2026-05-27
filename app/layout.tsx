import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orthogonal Chat',
  description: 'AI assistant with access to Orthogonal APIs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
