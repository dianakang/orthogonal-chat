'use client';

import { ClerkProvider } from '@clerk/nextjs';

const appearance = {
  variables: {
    colorPrimary: '#0f172a',
    colorText: '#0f172a',
    colorTextSecondary: '#64748b',
    colorBackground: '#ffffff',
    colorInputBackground: '#ffffff',
    colorInputText: '#0f172a',
    borderRadius: '16px',
  },
  elements: {
    card: 'rounded-3xl border border-surface-3 bg-surface-1 shadow-sm',
    formButtonPrimary: 'rounded-xl bg-accent hover:opacity-95',
    formFieldInput:
      'rounded-xl border border-surface-3 bg-surface-0 focus:ring-2 focus:ring-accent/20',
  },
};

export default function ClerkProviderClient({ children }: { children: React.ReactNode }) {
  return <ClerkProvider appearance={appearance}>{children}</ClerkProvider>;
}
