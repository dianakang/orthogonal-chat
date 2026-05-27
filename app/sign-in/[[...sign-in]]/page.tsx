import { auth } from '@clerk/nextjs/server';
import { SignIn } from '@clerk/nextjs';
import { redirect } from 'next/navigation';

export default async function Page() {
  const { userId } = await auth({ treatPendingAsSignedOut: true });
  if (userId) redirect('/chat');

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-6">
      <SignIn
        appearance={{
          elements: {
            card: 'rounded-3xl border border-surface-3 bg-surface-1 shadow-sm',
            formButtonPrimary: 'rounded-xl bg-accent hover:opacity-95',
            formFieldInput:
              'rounded-xl border border-surface-3 bg-surface-0 focus:ring-2 focus:ring-accent/20',
          },
        }}
      />
    </div>
  );
}

