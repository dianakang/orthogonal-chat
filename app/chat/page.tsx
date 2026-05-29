import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import ChatInterface from '@/components/ChatInterface';

export default async function ChatPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-up');
  return <ChatInterface />;
}
