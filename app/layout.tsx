import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'OfficeProof Lab',
  description: 'Test the spreadsheets, documents and slides your AI generates before a customer opens them. Built on the Univer SDK.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#e3e1dc' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="op-paper">{children}</body></html>;
}
