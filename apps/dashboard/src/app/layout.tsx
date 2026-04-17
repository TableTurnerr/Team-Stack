import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/auth-context';
import { ThemeProvider } from 'next-themes';

export const metadata: Metadata = {
  title: 'CRM Tableturnerr',
  description: 'Unified CRM - Cold Call Monitoring + Instagram Outreach',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Tableturnerr',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport = {
  themeColor: '#0a0a0a',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
