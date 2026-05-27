import { query } from '@/lib/db';
import type { Conversation } from '@/lib/db';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const conversations = await query<Conversation>(
      'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100',
      [userId]
    );
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error('[conversations GET]', err);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await query('DELETE FROM conversations WHERE user_id = $1', [userId]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[conversations DELETE]', err);
    return NextResponse.json({ error: 'Failed to clear conversations' }, { status: 500 });
  }
}
