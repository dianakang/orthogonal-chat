import { NextResponse } from 'next/server';
import { apiHealth } from '@/lib/api-health';
import { toolCache } from '@/lib/tool-cache';

export async function GET() {
  const orthogonal = apiHealth.status('orthogonal');
  return NextResponse.json({
    status: orthogonal.healthy ? 'healthy' : 'degraded',
    services: { orthogonal },
    cache: { entries: toolCache.size() },
    timestamp: new Date().toISOString(),
  });
}
