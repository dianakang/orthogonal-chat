import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Geist, Geist_Mono } from 'next/font/google';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Orthogonal Chat',
  description: 'AI assistant with access to Orthogonal APIs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: '#0f172a',
              colorText: '#0f172a',
              colorTextSecondary: '#64748b',
              colorBackground: '#ffffff',
              colorInputBackground: '#ffffff',
              colorInputText: '#0f172a',
              borderRadius: '16px',
              fontFamily: 'var(--font-geist-sans)',
            },
            elements: {
              card: 'rounded-3xl border border-surface-3 bg-surface-1 shadow-sm',
              headerTitle: 'text-zinc-900 dark:text-zinc-100',
              headerSubtitle: 'text-zinc-600 dark:text-zinc-400',
              socialButtonsBlockButton:
                'rounded-xl border border-surface-3 bg-surface-1 hover:bg-surface-2',
              formButtonPrimary: 'rounded-xl bg-accent hover:opacity-95',
              formFieldInput:
                'rounded-xl border border-surface-3 bg-surface-0 focus:ring-2 focus:ring-accent/20',
              footerActionLink: 'text-accent hover:opacity-90',
            },
          }}
        >
          <ThemeProvider>
            <Show when="signed-out">
              <header className="sticky top-0 z-40 h-16 border-b border-surface-3 bg-surface-1/70 backdrop-blur">
                <div className="mx-auto max-w-6xl h-full px-4 sm:px-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-surface-1 border border-surface-3 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">O</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        Orthogonal Chat
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate hidden sm:block">
                        Multi-user agentic chat
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <SignInButton mode="modal">
                      <button className="h-9 px-3 rounded-xl text-xs font-medium border border-surface-3 bg-surface-1 hover:bg-surface-2 transition-colors text-zinc-700 dark:text-zinc-200">
                        Sign in
                      </button>
                    </SignInButton>
                    <SignUpButton mode="modal">
                      <button className="h-9 px-3 rounded-xl text-xs font-medium bg-accent text-white hover:opacity-95 transition-opacity">
                        Sign up
                      </button>
                    </SignUpButton>
                  </div>
                </div>
              </header>
            </Show>

            {children}
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
