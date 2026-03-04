import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    pid: process.pid,
    worker: process.env.ORKIFY_WORKER_ID ?? 'standalone',
  });
}
