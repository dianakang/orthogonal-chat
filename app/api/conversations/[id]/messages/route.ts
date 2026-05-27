import { query } from '@/lib/db';
import type { Message } from '@/lib/db';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const messages = await query<Message>(
      `SELECT m.*
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = $1 AND c.user_id = $2
       ORDER BY m.created_at ASC`,
      [id, userId]
    );
    return NextResponse.json({ messages });
  } catch (err) {
    console.error('[messages GET]', err);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
