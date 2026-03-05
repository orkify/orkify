import { type NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  void request.url;

  return NextResponse.json({
    ok: true,
    pid: process.pid,
    worker: process.env.ORKIFY_WORKER_ID ?? 'standalone',
  });
}
