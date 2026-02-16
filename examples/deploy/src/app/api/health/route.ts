import { NextResponse } from 'next/server';

declare const globalThis: {
  __app: {
    startedAt: number;
    buildInfo: { version: string };
    workerId: string;
  };
};

export function GET() {
  const app = globalThis.__app;
  return NextResponse.json({
    status: 'ok',
    version: app.buildInfo.version,
    worker: app.workerId,
    pid: process.pid,
    uptime: Math.floor((Date.now() - app.startedAt) / 1000),
  });
}
