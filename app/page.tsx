import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function Home() {
  const { userId } = await auth({ treatPendingAsSignedOut: true });
  redirect(userId ? '/chat' : '/sign-up');
}
