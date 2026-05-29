import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface-0 px-6 py-10">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl="/chat"
        appearance={{
          elements: {
            card: 'rounded-3xl border border-surface-3 bg-surface-1 shadow-sm',
            formButtonPrimary: 'rounded-xl bg-accent hover:opacity-95',
            formFieldInput:
              'rounded-xl border border-surface-3 bg-surface-0 focus:ring-2 focus:ring-accent/20',
          },
        }}
      />
      <p className="mt-6 text-xs text-zinc-500">
        <Link href="/" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
          Back to home
        </Link>
      </p>
    </div>
  );
}
