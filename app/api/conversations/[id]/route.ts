import { query, queryOne } from '@/lib/db';
import type { Conversation } from '@/lib/db';
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
    const conversation = await queryOne<Conversation>(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ conversation });
  } catch (err) {
    console.error('[conversation GET]', err);
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [id, userId]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[conversation DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
