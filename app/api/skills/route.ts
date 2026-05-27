import { listEndpoints } from '@/lib/orthogonal';
import type { ApiEntry } from '@/lib/orthogonal';
import { NextResponse } from 'next/server';

// In-memory cache — refresh every 10 minutes
let cache: { apis: ApiEntry[]; totalEndpoints: number; fetchedAt: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

export async function GET() {
  try {
    const now = Date.now();
    if (!cache || now - cache.fetchedAt > CACHE_TTL) {
      const data = await listEndpoints(500);
      cache = {
        apis: data.apis,
        totalEndpoints: data.totalEndpoints,
        fetchedAt: now,
      };
    }
    return NextResponse.json({
      apis: cache.apis,
      totalEndpoints: cache.totalEndpoints,
      count: cache.apis.length,
    });
  } catch (err) {
    console.error('[skills]', err);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}
