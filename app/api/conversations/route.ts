import { query } from '@/lib/db';
import type { Conversation } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const conversations = await query<Conversation>(
      'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100'
    );
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error('[conversations GET]', err);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await query('DELETE FROM conversations');
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[conversations DELETE]', err);
    return NextResponse.json({ error: 'Failed to clear conversations' }, { status: 500 });
  }
}
