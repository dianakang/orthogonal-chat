import ChatInterface from '@/components/ChatInterface';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function ChatPage() {
  const { userId } = await auth({ treatPendingAsSignedOut: true });
  if (!userId) redirect('/sign-up');
  return <ChatInterface />;
}

